import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document as XmldomDocument, Element as XmldomElement, Node as XmldomNode } from "@xmldom/xmldom";
import JSZip from "jszip";
import type {
  ResumeBulletRewrite,
  ResumeDocxEditStats,
  ResumeDocxParagraphRole,
  ResumeEditOperation,
  ResumeEditOperationType,
  ResumeLayoutAdjustment,
  ResumeLayoutMap,
  ResumeLayoutMapParagraph,
  ResumeSkippedChange
} from "@/lib/types";

type Document = XmldomDocument;
type Element = XmldomElement;
type Node = XmldomNode;

type TailoredDocxInput =
  | ResumeBulletRewrite[]
  | {
      editOperations?: ResumeEditOperation[];
      rewrites?: ResumeBulletRewrite[];
      layoutAdjustment?: ResumeLayoutAdjustment;
    };

type NormalizedOperation = ResumeEditOperation & {
  normalizedOriginal: string;
  replacement: string;
};

type TextElementInfo = {
  element: Element;
  text: string;
  afterTab: boolean;
  protected: boolean;
};

type ParagraphNodeInfo = ResumeLayoutMapParagraph & {
  element: Element;
  textElements: TextElementInfo[];
  editableTextElements: TextElementInfo[];
  normalizedText: string;
};

type ResolvedOperationTarget = {
  node: ParagraphNodeInfo;
  repaired: boolean;
  repairNote?: string;
};

type FittedReplacement = {
  text: string;
  shortened: boolean;
};

type NormalizedDocxInput = {
  operations: NormalizedOperation[];
  layoutAdjustment: ResumeLayoutAdjustment;
};

type LayoutSnapshot = {
  paragraphCount: number;
  blankParagraphCount: number;
  maxBlankRun: number;
  sectionHeadings: string[];
  terminalSections: string[];
  dateHeaders: Array<{
    rightText: string;
    tabStopSignature: string;
  }>;
};

type ApplyDocxEditOptions = {
  layoutPressure: boolean;
  inPlaceOnly?: boolean;
};

export type TailoredDocxBuildResult = {
  buffer: Uint8Array;
  stats: ResumeDocxEditStats;
  skippedChanges: ResumeSkippedChange[];
};

const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const dateLikePattern =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b\d{4}\s*(?:-|–|—|to)\s*(?:present|\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4})\b|\b(?:present|current)\b/i;
const contactPattern = /@|linkedin\.com|github\.com|\(\d{3}\)|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i;
const sectionHeadingPattern = /^[A-Z][A-Z0-9/&+\-\s]{2,70}$/;
const terminalSectionPattern =
  /\b(PROJECTS?|CERTIFICATIONS?|PUBLICATIONS?|ACTIVITIES?|LEADERSHIP|INVOLVEMENT|AWARDS?|ORGANIZATIONS?|VOLUNTEER|ADDITIONAL)\b/i;
const maxDocxLayoutLockedOperations = 14;
const maxDocxLayoutLockedInsertions = 2;

export async function createResumeLayoutMapFromDocx(originalDocx: Buffer | ArrayBuffer | Uint8Array) {
  const zip = await JSZip.loadAsync(originalDocx);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX is missing word/document.xml.");

  const document = parseXml(await documentFile.async("string"), "word/document.xml");
  const nodes = buildParagraphNodes(document);
  const sectionNames = Array.from(new Set(nodes.map((node) => node.sectionName).filter(Boolean) as string[]));

  return {
    source: "docx",
    paragraphs: nodes.map(toLayoutParagraph),
    sectionNames,
    generatedAt: new Date().toISOString()
  } satisfies ResumeLayoutMap;
}

export async function createTailoredDocxFromOriginal(originalDocx: Buffer | ArrayBuffer | Uint8Array, input: TailoredDocxInput) {
  const result = await createTailoredDocxBuildResultFromOriginal(originalDocx, input);
  return result.buffer;
}

export async function createTailoredDocxBuildResultFromOriginal(
  originalDocx: Buffer | ArrayBuffer | Uint8Array,
  input: TailoredDocxInput
) {
  const tailoringInput = normalizeDocxInput(input);

  try {
    return await buildTailoredDocxAttempt(originalDocx, tailoringInput, { inPlaceOnly: false });
  } catch (error) {
    console.warn("DOCX layout validation failed; retrying with in-place-only edits.", error);
  }

  try {
    const retry = await buildTailoredDocxAttempt(originalDocx, tailoringInput, { inPlaceOnly: true });
    recordBuildResultSkip(
      retry,
      "Retried with in-place-only edits after layout validation failed.",
      "layout_retry"
    );
    return retry;
  } catch (error) {
    console.warn("DOCX in-place retry failed; returning original resume document.", error);
    return buildOriginalDocxFallback(originalDocx, tailoringInput, error);
  }
}

async function buildTailoredDocxAttempt(
  originalDocx: Buffer | ArrayBuffer | Uint8Array,
  tailoringInput: NormalizedDocxInput,
  options: { inPlaceOnly: boolean }
) {
  const zip = await JSZip.loadAsync(originalDocx);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX is missing word/document.xml.");

  const document = parseXml(await documentFile.async("string"), "word/document.xml");
  const nodes = buildParagraphNodes(document);
  const originalSnapshot = createLayoutSnapshot(nodes);
  const layoutLockedOperations = prepareLayoutLockedDocxOperations(tailoringInput.operations, nodes, options);
  const layoutPressure = estimateDocxLayoutPressure(nodes, layoutLockedOperations, tailoringInput.layoutAdjustment);
  const operationResult = applyDocxParagraphEdits(document, nodes, layoutLockedOperations, {
    layoutPressure,
    inPlaceOnly: options.inPlaceOnly
  });

  scaleFontSizesInDocument(document, tailoringInput.layoutAdjustment.fontScale);

  const editedSnapshot = createLayoutSnapshot(buildParagraphNodes(document));
  validateLayoutPreservation(originalSnapshot, editedSnapshot);

  zip.file("word/document.xml", serializeXml(document));

  const stylesFile = zip.file("word/styles.xml");
  if (stylesFile && tailoringInput.layoutAdjustment.fontScale < 0.995) {
    const stylesDocument = parseXml(await stylesFile.async("string"), "word/styles.xml");
    scaleFontSizesInDocument(stylesDocument, tailoringInput.layoutAdjustment.fontScale);
    zip.file("word/styles.xml", serializeXml(stylesDocument));
  }

  const buffer = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });

  const stats: ResumeDocxEditStats = {
    ...operationResult.stats,
    skippedEdits: operationResult.skippedChanges.length,
    fontScale: tailoringInput.layoutAdjustment.fontScale,
    validationStatus: "not_generated"
  };

  try {
    await validateDocxBuffer(buffer, { extractText: true });
    stats.validationStatus = "valid";
  } catch (error) {
    stats.validationStatus = "failed";
    throw error;
  }

  if (stats.appliedEdits + stats.insertedBullets + stats.removedLines < 4) {
    stats.warning = "Only a light tailoring was possible from resume-backed evidence.";
  }

  return {
    buffer,
    stats,
    skippedChanges: operationResult.skippedChanges
  } satisfies TailoredDocxBuildResult;
}

async function buildOriginalDocxFallback(
  originalDocx: Buffer | ArrayBuffer | Uint8Array,
  tailoringInput: NormalizedDocxInput,
  error: unknown
) {
  const buffer = toUint8Array(originalDocx);
  const stats = createDocxStats();
  stats.skippedByReason = {
    layout_retry: 1,
    visual_gap_risk: tailoringInput.operations.length
  };
  stats.skippedEdits = tailoringInput.operations.length + 1;
  stats.validationStatus = "valid";
  stats.warning = "Layout validation could not guarantee an apply-ready DOCX, so Stealth returned the original resume.";

  try {
    await validateDocxBuffer(buffer, { extractText: true });
  } catch {
    stats.validationStatus = "failed";
  }

  const skippedChanges: ResumeSkippedChange[] = [
    {
      skipReason: `Returned original DOCX after layout validation failed${error instanceof Error ? `: ${error.message}` : "."}`,
      skipCategory: "layout_retry"
    },
    ...tailoringInput.operations.map((operation) => ({
      ...operation,
      skipReason: "Skipped because layout validation could not guarantee an apply-ready document.",
      skipCategory: "visual_gap_risk"
    }))
  ];

  return {
    buffer,
    stats,
    skippedChanges
  } satisfies TailoredDocxBuildResult;
}

function recordBuildResultSkip(result: TailoredDocxBuildResult, skipReason: string, skipCategory: string) {
  result.skippedChanges.push({ skipReason, skipCategory });
  result.stats.skippedByReason = result.stats.skippedByReason ?? {};
  result.stats.skippedByReason[skipCategory] = (result.stats.skippedByReason[skipCategory] ?? 0) + 1;
  result.stats.skippedEdits = result.skippedChanges.length;
}

function toUint8Array(value: Buffer | ArrayBuffer | Uint8Array) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  return new Uint8Array(value);
}

export async function createTailoredDocxArrayBuffer(originalDocx: ArrayBuffer | Uint8Array, input: TailoredDocxInput) {
  const result = await createTailoredDocxBuildResultFromOriginal(originalDocx, input);
  const arrayBuffer = new ArrayBuffer(result.buffer.byteLength);
  new Uint8Array(arrayBuffer).set(result.buffer);
  return arrayBuffer;
}

function normalizeDocxInput(input: TailoredDocxInput): NormalizedDocxInput {
  const rawOperations = Array.isArray(input)
    ? input.map((rewrite) => rewriteToOperation(rewrite))
    : input.editOperations?.length
      ? input.editOperations
      : input.rewrites?.map((rewrite) => rewriteToOperation(rewrite)) ?? [];

  return {
    operations: rawOperations
      .map((operation) => {
        const original = cleanDocxReplacementText(operation.original);
        const replacement =
          operation.type === "remove_low_priority_paragraph"
            ? cleanDocxReplacementText(operation.replacement ?? "")
            : cleanDocxReplacementText(operation.replacement);
        return {
          ...operation,
          original,
          replacement,
          normalizedOriginal: normalizeForMatch(original)
        };
      })
      .filter((operation) => {
        const hasMappedTarget = Boolean(
          operation.paragraphId ||
            operation.insertAfterParagraphId ||
            operation.contentHash ||
            operation.fallbackParagraphIds?.length
        );
        const hasFallbackText = operation.normalizedOriginal.length > 8;
        const allowsEmptyReplacement = operation.type === "remove_low_priority_paragraph";
        return (hasMappedTarget || hasFallbackText) && (allowsEmptyReplacement || operation.replacement.length > 0);
      })
      .slice(0, 36),
    layoutAdjustment: normalizeLayoutAdjustment(Array.isArray(input) ? undefined : input.layoutAdjustment)
  };
}

function rewriteToOperation(rewrite: ResumeBulletRewrite): ResumeEditOperation {
  return {
    type: "replace_line",
    original: rewrite.original,
    replacement: rewrite.rewrite,
    keywords: [],
    reason: rewrite.reason
  };
}

function normalizeLayoutAdjustment(value?: ResumeLayoutAdjustment): ResumeLayoutAdjustment {
  const fontScale = typeof value?.fontScale === "number" && Number.isFinite(value.fontScale) ? value.fontScale : 1;
  return {
    fontScale: Math.max(0.9, Math.min(1, fontScale)),
    reason: value?.reason || "No layout adjustment applied."
  };
}

function prepareLayoutLockedDocxOperations(
  operations: NormalizedOperation[],
  nodes: ParagraphNodeInfo[],
  options: { inPlaceOnly: boolean }
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const usedFallbackNodeIds = new Set<string>();
  const insertionCounts = {
    total: 0,
    bySection: new Map<string, number>()
  };
  const hasInsertionSlack = !options.inPlaceOnly && hasClearDocxInsertionSlack(nodes);
  const prepared: NormalizedOperation[] = [];

  sortOperationsForDocx(operations).forEach((operation) => {
    const resolved = resolveOperationTarget(operation, nodes, nodeById, usedFallbackNodeIds, {
      layoutPressure: false,
      inPlaceOnly: options.inPlaceOnly
    });
    const target = resolved?.node;

    if (operation.type === "remove_low_priority_paragraph") {
      if (!target) {
        prepared.push(operation);
        return;
      }
      const converted = convertDocxRemovalOperationToInPlace(operation, target);
      prepared.push(converted ?? operation);
      return;
    }

    if (operation.type === "insert_bullet_after") {
      if (!target) {
        prepared.push(operation);
        return;
      }

      const sectionKey = getDocxPairingKey(target);
      const sectionInsertions = insertionCounts.bySection.get(sectionKey) ?? 0;
      const canInsert =
        hasInsertionSlack &&
        insertionCounts.total < maxDocxLayoutLockedInsertions &&
        sectionInsertions < 1 &&
        target.canInsertAfter &&
        Boolean(operation.replacement.trim());

      if (canInsert) {
        insertionCounts.total += 1;
        insertionCounts.bySection.set(sectionKey, sectionInsertions + 1);
        prepared.push(operation);
        return;
      }

      const converted = convertDocxInsertionOperationToInPlace(operation, target, nodes, nodeById);
      prepared.push(converted ?? operation);
      return;
    }

    prepared.push(operation);
  });

  return prepared.slice(0, maxDocxLayoutLockedOperations);
}

function convertDocxRemovalOperationToInPlace(operation: NormalizedOperation, target: ParagraphNodeInfo): NormalizedOperation | null {
  const current = (target.editableText || target.leftText || target.text).trim();
  const replacement = cleanDocxReplacementText(operation.replacement);
  if (!target.canEdit || !current || !replacement) return null;
  if (normalizeForMatch(current) === normalizeForMatch(replacement)) return null;

  const convertedType: ResumeEditOperationType =
    replacement.length < current.length ? "shorten_paragraph" : target.isBullet ? "replace_bullet" : "replace_paragraph_text";

  return {
    ...operation,
    type: convertedType,
    paragraphId: target.id,
    insertAfterParagraphId: undefined,
    original: target.editableText || target.text || operation.original,
    replacement,
    normalizedOriginal: normalizeForMatch(target.editableText || target.text || operation.original),
    reason: `${operation.reason} Converted from removal to preserve layout.`
  };
}

function convertDocxInsertionOperationToInPlace(
  operation: NormalizedOperation,
  target: ParagraphNodeInfo,
  nodes: ParagraphNodeInfo[],
  nodeById: Map<string, ParagraphNodeInfo>
): NormalizedOperation | null {
  const foldTarget = findDocxInsertionFoldTarget(operation, target, nodes, nodeById);
  if (!foldTarget?.canEdit) return null;

  const current = (foldTarget.editableText || foldTarget.leftText || foldTarget.text).trim();
  const detail = stripDocxBulletPrefix(operation.replacement);
  if (!current || !detail) return null;

  const replacement = fitFoldedDocxDetail(foldTarget, current, detail, operation.maxChars);
  if (!replacement || normalizeForMatch(current) === normalizeForMatch(replacement)) return null;

  return {
    ...operation,
    type: foldTarget.isBullet ? "replace_bullet" : "append_to_paragraph",
    paragraphId: foldTarget.id,
    insertAfterParagraphId: undefined,
    original: foldTarget.editableText || foldTarget.text,
    replacement,
    normalizedOriginal: normalizeForMatch(foldTarget.editableText || foldTarget.text),
    reason: `${operation.reason} Converted from insertion to in-place edit to preserve layout.`
  };
}

function findDocxInsertionFoldTarget(
  operation: NormalizedOperation,
  target: ParagraphNodeInfo,
  nodes: ParagraphNodeInfo[],
  nodeById: Map<string, ParagraphNodeInfo>
) {
  const candidateIds = [
    target.id,
    ...(target.nearbyBulletIds ?? []),
    ...(target.fallbackIds ?? []),
    ...(operation.fallbackParagraphIds ?? [])
  ];

  for (const id of candidateIds) {
    const candidate = nodeById.get(id);
    if (candidate?.canEdit && candidate.role !== "section_heading" && candidate.role !== "blank" && candidate.role !== "divider") {
      return candidate;
    }
  }

  return nodes.find((candidate) => {
    if (!candidate.canEdit) return false;
    if ((candidate.sectionName || "") !== (target.sectionName || "")) return false;
    return candidate.role === "bullet" || candidate.role === "body" || candidate.role === "skills_line";
  }) ?? null;
}

function fitFoldedDocxDetail(
  target: ParagraphNodeInfo,
  current: string,
  detail: string,
  requestedMaxChars?: number
) {
  const layoutBudget = target.maxReplacementChars ?? target.editableCharBudget;
  const operationBudget =
    typeof requestedMaxChars === "number" && Number.isFinite(requestedMaxChars)
      ? Math.max(24, Math.min(900, Math.round(requestedMaxChars)))
      : undefined;
  const budget = layoutBudget && operationBudget ? Math.min(layoutBudget, operationBudget) : layoutBudget ?? operationBudget;
  const separator = /[.;:]$/.test(current) ? " " : "; ";
  const combined = cleanDocxReplacementText(`${current}${separator}${detail}`);
  if (!budget || combined.length <= budget) return combined;

  const available = budget - current.length - separator.length;
  if (available < 24) return "";
  const shortenedDetail = detail.slice(0, available).replace(/\s+\S*$/, "").trim();
  return shortenedDetail ? cleanDocxReplacementText(`${current}${separator}${shortenedDetail}`) : "";
}

function stripDocxBulletPrefix(value: string) {
  return cleanDocxReplacementText(value.replace(/^\s*(?:[-*•●▪‣]\s*)?/, ""));
}

function hasClearDocxInsertionSlack(nodes: ParagraphNodeInfo[]) {
  const meaningfulNodes = nodes.filter((node) => node.text.trim() && node.role !== "blank" && node.role !== "divider");
  const characterCount = meaningfulNodes.reduce((sum, node) => sum + node.text.length, 0);
  const bulletCount = meaningfulNodes.filter((node) => node.isBullet).length;
  return characterCount < 3000 && meaningfulNodes.length < 46 && bulletCount < 28;
}

function buildParagraphNodes(document: Document): ParagraphNodeInfo[] {
  const paragraphs = getElementsByLocalName(document, "p");
  let currentSection = "";

  const nodes = paragraphs.map((paragraph, index) => {
    const textElements = getTextElementInfos(paragraph);
    const text = textElements.map((item) => item.text).join("");
    const role = classifyParagraph(paragraph, text, textElements, currentSection);

    if (role === "section_heading") {
      currentSection = normalizeSectionName(text);
    }

    const editableTextElements = getEditableTextElements(role, textElements);
    const { leftText, rightText } = splitTextByTab(textElements);
    const hasTabStop = hasRightAlignedDate(textElements) || hasLiteralTab(paragraph);
    const tabStopSignature = hasTabStop ? getTabStopSignature(paragraph) : undefined;
    const lockedText = textElements
      .filter((item) => item.protected)
      .map((item) => item.text)
      .join("")
      .trim();
    const normalizedText = normalizeForMatch(text);
    const isBullet = role === "bullet";

    return {
      id: `p${String(index + 1).padStart(3, "0")}`,
      role,
      sectionName: currentSection || undefined,
      text,
      editableText: editableTextElements.map((item) => item.text).join("").trim(),
      lockedText: lockedText || undefined,
      leftText: leftText || undefined,
      rightText: rightText || undefined,
      hasTabStop,
      tabStopSignature,
      isTerminalSection: isTerminalSectionName(currentSection || text),
      editableCharBudget: computeEditableCharBudget(role, leftText || text, editableTextElements.map((item) => item.text).join("").trim()),
      hasLockedDate: Boolean(lockedText && dateLikePattern.test(lockedText)),
      isBullet,
      canEdit: canEditRole(role, editableTextElements),
      canInsertAfter: canInsertAfterRole(role),
      canRemove: canRemoveRole(role),
      element: paragraph,
      textElements,
      editableTextElements,
      normalizedText
    } satisfies ParagraphNodeInfo;
  });

  return enrichParagraphNodes(nodes);
}

function toLayoutParagraph(node: ParagraphNodeInfo): ResumeLayoutMapParagraph {
  return {
    id: node.id,
    role: node.role,
    sectionName: node.sectionName,
    text: node.text,
    editableText: node.editableText,
    lockedText: node.lockedText,
    leftText: node.leftText,
    rightText: node.rightText,
    hasTabStop: node.hasTabStop,
    tabStopSignature: node.tabStopSignature,
    isTerminalSection: node.isTerminalSection,
    editableCharBudget: node.editableCharBudget,
    contentHash: node.contentHash,
    semanticTags: node.semanticTags,
    safeOperations: node.safeOperations,
    fallbackIds: node.fallbackIds,
    insertAnchorIds: node.insertAnchorIds,
    nearbyBulletIds: node.nearbyBulletIds,
    maxReplacementChars: node.maxReplacementChars,
    lockedRegions: node.lockedRegions,
    hasLockedDate: node.hasLockedDate,
    isBullet: node.isBullet,
    canEdit: node.canEdit,
    canInsertAfter: node.canInsertAfter,
    canRemove: node.canRemove
  };
}

function enrichParagraphNodes(nodes: ParagraphNodeInfo[]) {
  return nodes.map((node, index) => ({
    ...node,
    contentHash: hashResumeContent(node.editableText || node.leftText || node.text),
    semanticTags: getSemanticTags(node),
    safeOperations: getSafeOperations(node),
    fallbackIds: findFallbackIds(node, nodes, index),
    insertAnchorIds: findInsertAnchorIds(node, nodes, index),
    nearbyBulletIds: findNearbyBulletIds(node, nodes, index),
    maxReplacementChars: node.editableCharBudget,
    lockedRegions: getLockedRegions(node)
  }));
}

function hashResumeContent(value: string) {
  const normalized = normalizeForMatch(value);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getSafeOperations(node: ParagraphNodeInfo): ResumeEditOperationType[] {
  const operations: ResumeEditOperationType[] = [];
  if (node.canEdit) {
    operations.push("replace_paragraph_text", "replace_line", "shorten_paragraph", "shorten_line");
    if (node.role === "bullet") operations.push("replace_bullet");
    if (node.role === "skills_line" || node.role === "education_line" || node.role === "body") {
      operations.push("append_to_paragraph", "append_to_line");
    }
  }
  if (node.canInsertAfter) operations.push("insert_bullet_after");
  if (node.canRemove && !node.hasTabStop && !node.hasLockedDate && !node.isTerminalSection) {
    operations.push("remove_low_priority_paragraph");
  }
  return Array.from(new Set(operations));
}

function getSemanticTags(node: ParagraphNodeInfo) {
  const tags = new Set<string>([node.role]);
  const text = normalizeForMatch(`${node.sectionName ?? ""} ${node.text}`);
  if (node.sectionName) tags.add(`section:${normalizeForMatch(node.sectionName)}`);
  if (text.includes("skill") || node.role === "skills_line") tags.add("skills");
  if (text.includes("coursework") || node.role === "education_line") tags.add("coursework");
  if (text.includes("project")) tags.add("project");
  if (text.includes("experience") || node.role === "bullet") tags.add("experience");
  if (node.hasTabStop) tags.add("date-row");
  if (node.isBullet) tags.add("bullet");
  return Array.from(tags);
}

function getLockedRegions(node: ParagraphNodeInfo) {
  const regions: string[] = [];
  if (node.lockedText) regions.push(node.lockedText);
  if (node.rightText) regions.push(node.rightText);
  if (node.hasTabStop) regions.push("right-aligned date/tab stop");
  if (!node.canEdit) regions.push("protected paragraph");
  return regions;
}

function findFallbackIds(node: ParagraphNodeInfo, nodes: ParagraphNodeInfo[], index: number) {
  const ids: string[] = [];
  const section = node.sectionName || "";
  for (const offset of [-2, -1, 1, 2]) {
    const candidate = nodes[index + offset];
    if (candidate?.canEdit && candidate.sectionName === section) ids.push(candidate.id);
  }
  return ids.slice(0, 5);
}

function findInsertAnchorIds(node: ParagraphNodeInfo, nodes: ParagraphNodeInfo[], index: number) {
  const ids: string[] = [];
  const section = node.sectionName || "";
  if (node.canInsertAfter) ids.push(node.id);
  for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
    const candidate = nodes[index + offset];
    if (candidate?.canInsertAfter && candidate.sectionName === section && !ids.includes(candidate.id)) ids.push(candidate.id);
  }
  return ids.slice(0, 6);
}

function findNearbyBulletIds(node: ParagraphNodeInfo, nodes: ParagraphNodeInfo[], index: number) {
  const ids: string[] = [];
  const section = node.sectionName || "";
  for (const offset of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const candidate = nodes[index + offset];
    if (candidate?.isBullet && candidate.sectionName === section && !ids.includes(candidate.id)) ids.push(candidate.id);
  }
  return ids.slice(0, 6);
}

function classifyParagraph(
  paragraph: Element,
  text: string,
  textElements: TextElementInfo[],
  currentSection: string
): ResumeDocxParagraphRole {
  const trimmed = text.trim();
  if (!trimmed) return hasParagraphBorder(paragraph) ? "divider" : "blank";
  if (isLikelyContactParagraph(trimmed)) return "contact_header";
  if (isSectionHeadingParagraph(trimmed, paragraph)) return "section_heading";
  if (hasRightAlignedDate(textElements)) return "date_locked_header";
  if (isBulletParagraph(paragraph, trimmed)) return "bullet";

  const normalizedSection = normalizeForMatch(currentSection);
  const normalizedText = normalizeForMatch(trimmed);
  if (normalizedSection.includes("skill") || looksLikeSkillsLine(trimmed)) return "skills_line";
  if (normalizedSection.includes("education")) return "education_line";
  if (
    normalizedSection.includes("activity") ||
    normalizedSection.includes("leadership") ||
    normalizedSection.includes("involvement")
  ) {
    return "activity_line";
  }
  if (normalizedText.includes("coursework")) return "education_line";

  return "body";
}

function isSectionHeadingParagraph(text: string, paragraph: Element) {
  const normalized = text.trim();
  if (!sectionHeadingPattern.test(normalized)) return false;
  if (dateLikePattern.test(normalized) || contactPattern.test(normalized)) return false;
  if (normalized.split(/\s+/).length > 7) return false;

  const style = getParagraphStyle(paragraph);
  return style.includes("heading") || style.includes("section") || normalized === normalized.toUpperCase();
}

function isBulletParagraph(paragraph: Element, text: string) {
  if (/^[•●▪‣\-*]\s+/.test(text.trim())) return true;
  if (getElementsByLocalName(paragraph, "numPr").length > 0) return true;
  const style = getParagraphStyle(paragraph);
  return style.includes("bullet") || style.includes("list");
}

function looksLikeSkillsLine(text: string) {
  return /^(programming|technical|tools|frameworks|analytics|methods|languages|supply chain|cloud|design|machine learning|skills)\b/i.test(
    text.trim()
  );
}

function hasRightAlignedDate(textElements: TextElementInfo[]) {
  return textElements.some((item) => item.afterTab && dateLikePattern.test(item.text));
}

function hasLiteralTab(paragraph: Element) {
  return getElementsByLocalName(paragraph, "tab").length > 0;
}

function splitTextByTab(textElements: TextElementInfo[]) {
  return {
    leftText: textElements
      .filter((item) => !item.afterTab)
      .map((item) => item.text)
      .join("")
      .trim(),
    rightText: textElements
      .filter((item) => item.afterTab)
      .map((item) => item.text)
      .join("")
      .trim()
  };
}

function getTabStopSignature(paragraph: Element) {
  const signatures: string[] = [];
  getElementsByLocalName(paragraph, "tab").forEach((element) => {
    signatures.push("run-tab");
  });
  getElementsByLocalName(paragraph, "tabs").forEach((tabsElement) => {
    getElementsByLocalName(tabsElement, "tab").forEach((tabElement) => {
      const val = getWordAttribute(tabElement, "val") ?? "";
      const pos = getWordAttribute(tabElement, "pos") ?? "";
      const leader = getWordAttribute(tabElement, "leader") ?? "";
      signatures.push(`stop:${val}:${pos}:${leader}`);
    });
  });
  return signatures.join("|") || "none";
}

function computeEditableCharBudget(role: ResumeDocxParagraphRole, leftText: string, editableText: string) {
  const baseline = Math.max(leftText.trim().length, editableText.trim().length, 20);
  if (role === "date_locked_header") return Math.max(32, Math.floor(baseline * 1.08));
  if (role === "bullet") return Math.max(90, Math.floor(baseline * 1.16));
  if (role === "skills_line" || role === "education_line") return Math.max(110, Math.floor(baseline * 1.2));
  return Math.max(80, Math.floor(baseline * 1.14));
}

function canInsertAfterRole(role: ResumeDocxParagraphRole) {
  return role === "bullet" || role === "role_header" || role === "date_locked_header" || role === "body" || role === "activity_line";
}

function canRemoveRole(role: ResumeDocxParagraphRole) {
  return role === "bullet" || role === "activity_line" || role === "body";
}

function getEditableTextElements(role: ResumeDocxParagraphRole, textElements: TextElementInfo[]) {
  if (role === "contact_header" || role === "section_heading" || role === "divider" || role === "blank") {
    return [];
  }
  if (role === "date_locked_header") {
    return textElements.filter((item) => !item.protected && !item.afterTab);
  }
  return textElements.filter((item) => !item.protected);
}

function canEditRole(role: ResumeDocxParagraphRole, editableTextElements: TextElementInfo[]) {
  if (!editableTextElements.length) return false;
  return role !== "contact_header" && role !== "section_heading" && role !== "divider" && role !== "blank";
}

function applyDocxParagraphEdits(
  _document: Document,
  nodes: ParagraphNodeInfo[],
  operations: NormalizedOperation[],
  options: ApplyDocxEditOptions
) {
  const stats = createDocxStats();
  const skippedChanges: ResumeSkippedChange[] = [];
  if (!operations.length) return { stats, skippedChanges };

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const usedFallbackNodeIds = new Set<string>();
  const acceptedImprovementCounts = new Map<string, number>();
  const insertionCounts = {
    total: 0,
    bySection: new Map<string, number>()
  };
  const hasInsertionSlack = !options.inPlaceOnly && hasClearDocxInsertionSlack(nodes);

  sortOperationsForDocx(operations).forEach((operation) => {
    const resolved = resolveOperationTarget(operation, nodes, nodeById, usedFallbackNodeIds, options);
    const target = resolved?.node;
    if (!target) {
      recordDocxSkip(skippedChanges, stats, operation, "Could not map this edit to a safe resume line.", "mapping");
      return;
    }

    if (operation.type === "insert_bullet_after") {
      const sectionKey = getDocxPairingKey(target);
      const sectionInsertions = insertionCounts.bySection.get(sectionKey) ?? 0;
      const canInsert =
        hasInsertionSlack &&
        insertionCounts.total < maxDocxLayoutLockedInsertions &&
        sectionInsertions < 1 &&
        target.canInsertAfter &&
        Boolean(operation.replacement.trim());

      if (!canInsert) {
        const converted = convertDocxInsertionOperationToInPlace(operation, target, nodes, nodeById);
        const convertedTarget = converted?.paragraphId ? nodeById.get(converted.paragraphId) ?? null : null;
        if (!converted || !convertedTarget?.canEdit) {
          recordDocxSkip(
            skippedChanges,
            stats,
            operation,
            "Insertion skipped because there was not enough layout slack for a new bullet.",
            "unsafe_insertion"
          );
          return;
        }

        const fitted = fitReplacementToParagraphBudget(convertedTarget, buildReplacementText(convertedTarget, converted), converted.maxChars);
        if (!fitted.text) {
          recordDocxSkip(skippedChanges, stats, operation, "Converted insertion was too long for the target line.", "visual_gap_risk");
          return;
        }

        if (!replaceParagraphEditableText(convertedTarget, fitted.text)) {
          recordDocxSkip(
            skippedChanges,
            stats,
            operation,
            "Converted insertion could not be applied without touching protected text.",
            "protected_layout"
          );
          return;
        }

        stats.convertedEdits = (stats.convertedEdits ?? 0) + 1;
        if (fitted.shortened) {
          stats.autoShortenedEdits = (stats.autoShortenedEdits ?? 0) + 1;
          stats.shortenedEdits = (stats.shortenedEdits ?? 0) + 1;
        }
        stats.appliedEdits += 1;
        recordAcceptedDocxImprovement(acceptedImprovementCounts, convertedTarget);
        return;
      }

      const insertTarget = target.canInsertAfter ? resolved : findSafeInsertAnchor(operation, target, nodes, nodeById);
      if (!insertTarget?.node.canInsertAfter) {
        recordDocxSkip(skippedChanges, stats, operation, "Could not find a safe bullet anchor in this section.", "protected_layout");
        return;
      }
      const inserted = insertBulletAfter(insertTarget.node, operation.replacement, nodes);
      if (!inserted) {
        recordDocxSkip(skippedChanges, stats, operation, "Could not find a nearby bullet style to clone.", "protected_layout");
        return;
      }
      if (resolved.repaired || insertTarget.repaired) stats.repairedEdits = (stats.repairedEdits ?? 0) + 1;
      stats.insertedBullets += 1;
      insertionCounts.total += 1;
      insertionCounts.bySection.set(sectionKey, sectionInsertions + 1);
      recordAcceptedDocxImprovement(acceptedImprovementCounts, insertTarget.node);
      return;
    }

    if (operation.type === "remove_low_priority_paragraph") {
      if (operation.replacement.trim()) {
        const converted = convertDocxRemovalToReplacement(target, operation);
        if (!converted) {
          recordDocxSkip(
            skippedChanges,
            stats,
            operation,
            "Removal replacement was empty or could not safely edit this line.",
            "content"
          );
          return;
        }

        if (!replaceParagraphEditableText(target, converted.text)) {
          recordDocxSkip(
            skippedChanges,
            stats,
            operation,
            "Removal replacement could not be applied without touching protected text.",
            "protected_layout"
          );
          return;
        }

        stats.convertedEdits = (stats.convertedEdits ?? 0) + 1;
        if (converted.shortened) stats.shortenedEdits = (stats.shortenedEdits ?? 0) + 1;
        if (converted.type !== "shorten_paragraph") recordAcceptedDocxImprovement(acceptedImprovementCounts, target);
        if (resolved.repaired) stats.repairedEdits = (stats.repairedEdits ?? 0) + 1;
        stats.appliedEdits += 1;
        return;
      }

      recordDocxSkip(
        skippedChanges,
        stats,
        operation,
        "Removal skipped because DOCX layout lock does not allow physical line deletion.",
        "layout_locked_removal"
      );
      return;
    }

    if (!isTargetSafeForOperation(operation, target, options)) {
      recordDocxSkip(skippedChanges, stats, operation, "This line is protected from editing.", "protected_layout");
      return;
    }

    const fitted = fitReplacementToParagraphBudget(target, buildReplacementText(target, operation), operation.maxChars);
    if (!fitted.text) {
      recordDocxSkip(skippedChanges, stats, operation, "The replacement text was empty after layout protection.", "content");
      return;
    }

    if (!replaceParagraphEditableText(target, fitted.text)) {
      recordDocxSkip(skippedChanges, stats, operation, "The edit could not be applied without touching protected text.", "protected_layout");
      return;
    }

    if (resolved.repaired) stats.repairedEdits = (stats.repairedEdits ?? 0) + 1;
    if (fitted.shortened) {
      stats.autoShortenedEdits = (stats.autoShortenedEdits ?? 0) + 1;
      stats.shortenedEdits = (stats.shortenedEdits ?? 0) + 1;
    } else if (operation.type === "shorten_line" || operation.type === "shorten_paragraph") {
      stats.shortenedEdits = (stats.shortenedEdits ?? 0) + 1;
    }
    stats.appliedEdits += 1;
    if (isDocxPairingImprovementOperation(operation.type)) {
      recordAcceptedDocxImprovement(acceptedImprovementCounts, target);
    }
  });

  return { stats, skippedChanges };
}

function createDocxStats(): ResumeDocxEditStats {
  return {
    appliedEdits: 0,
    insertedBullets: 0,
    removedLines: 0,
    skippedEdits: 0,
    repairedEdits: 0,
    convertedEdits: 0,
    autoShortenedEdits: 0,
    shortenedEdits: 0,
    skippedByReason: {},
    validationStatus: "not_generated",
    fontScale: 1
  };
}

function recordDocxSkip(
  skippedChanges: ResumeSkippedChange[],
  stats: ResumeDocxEditStats,
  operation: NormalizedOperation,
  skipReason: string,
  skipCategory: string
) {
  skippedChanges.push({ ...operation, skipReason, skipCategory });
  stats.skippedByReason = stats.skippedByReason ?? {};
  stats.skippedByReason[skipCategory] = (stats.skippedByReason[skipCategory] ?? 0) + 1;
}

function isDocxPairingImprovementOperation(type: ResumeEditOperationType) {
  return (
    type === "replace_line" ||
    type === "append_to_line" ||
    type === "replace_paragraph_text" ||
    type === "append_to_paragraph" ||
    type === "replace_bullet" ||
    type === "insert_bullet_after"
  );
}

function recordAcceptedDocxImprovement(acceptedImprovementCounts: Map<string, number>, node: ParagraphNodeInfo) {
  const sectionKey = getDocxPairingKey(node);
  acceptedImprovementCounts.set(sectionKey, (acceptedImprovementCounts.get(sectionKey) ?? 0) + 1);
}

function hasAvailableDocxImprovement(acceptedImprovementCounts: Map<string, number>, sectionKey: string) {
  return (acceptedImprovementCounts.get(sectionKey) ?? 0) > 0;
}

function consumeDocxImprovement(acceptedImprovementCounts: Map<string, number>, sectionKey: string) {
  const count = acceptedImprovementCounts.get(sectionKey) ?? 0;
  if (count <= 0) return false;
  acceptedImprovementCounts.set(sectionKey, count - 1);
  return true;
}

function getDocxPairingKey(node: ParagraphNodeInfo) {
  return normalizeForMatch(node.sectionName || "resume") || "resume";
}

function sortOperationsForDocx(operations: NormalizedOperation[]) {
  const order: Record<ResumeEditOperationType, number> = {
    replace_line: 1,
    replace_paragraph_text: 1,
    replace_bullet: 1,
    append_to_line: 2,
    append_to_paragraph: 2,
    insert_bullet_after: 3,
    shorten_line: 4,
    shorten_paragraph: 4,
    remove_low_priority_paragraph: 5
  };

  return [...operations].sort((a, b) => {
    const stageDifference = (order[a.type] ?? 10) - (order[b.type] ?? 10);
    if (stageDifference !== 0) return stageDifference;

    const priorityA = typeof a.priority === "number" ? a.priority : 3;
    const priorityB = typeof b.priority === "number" ? b.priority : 3;
    if (priorityA !== priorityB) return priorityB - priorityA;
    return normalizeForMatch(a.original).localeCompare(normalizeForMatch(b.original));
  });
}

function resolveOperationTarget(
  operation: NormalizedOperation,
  nodes: ParagraphNodeInfo[],
  nodeById: Map<string, ParagraphNodeInfo>,
  usedFallbackNodeIds: Set<string>,
  options: ApplyDocxEditOptions
): ResolvedOperationTarget | null {
  const mappedId = operation.type === "insert_bullet_after" ? operation.insertAfterParagraphId || operation.paragraphId : operation.paragraphId;
  const directTarget = mappedId ? nodeById.get(mappedId) ?? null : null;
  if (directTarget && isTargetSafeForOperation(operation, directTarget, options)) {
    return { node: directTarget, repaired: false };
  }

  const repaired = findRepairTargetForOperation(operation, nodes, nodeById, usedFallbackNodeIds, options);
  if (repaired) return repaired;

  const fallback = findBestParagraphNode(operation, nodes, usedFallbackNodeIds, options);
  if (fallback) usedFallbackNodeIds.add(fallback.id);
  return fallback ? { node: fallback, repaired: true, repairNote: "Mapped by resume text similarity." } : null;
}

function findBestParagraphNode(
  operation: NormalizedOperation,
  nodes: ParagraphNodeInfo[],
  usedNodeIds: Set<string>,
  options: ApplyDocxEditOptions
): ParagraphNodeInfo | null {
  if (!operation.normalizedOriginal) return null;

  let bestNode: ParagraphNodeInfo | null = null;
  let bestScore = 0;
  for (const node of nodes) {
    if (usedNodeIds.has(node.id) || !isTargetSafeForOperation(operation, node, options)) continue;
    const sectionBoost =
      operation.targetSection && node.sectionName && normalizeForMatch(node.sectionName).includes(normalizeForMatch(operation.targetSection))
        ? 0.05
        : 0;
    const score = getMatchScore(node.normalizedText, operation.normalizedOriginal) + sectionBoost;
    const threshold = operation.type === "append_to_line" || operation.type === "append_to_paragraph" ? 0.34 : 0.46;
    if (score >= threshold && score > bestScore) {
      bestNode = node;
      bestScore = score;
    }
  }

  return bestNode;
}

function findRepairTargetForOperation(
  operation: NormalizedOperation,
  nodes: ParagraphNodeInfo[],
  nodeById: Map<string, ParagraphNodeInfo>,
  usedNodeIds: Set<string>,
  options: ApplyDocxEditOptions
): ResolvedOperationTarget | null {
  const candidates = getCandidateTargetIds(operation)
    .map((id) => nodeById.get(id))
    .filter(Boolean) as ParagraphNodeInfo[];

  const hashTarget = operation.contentHash ? findNodeByContentHash(operation.contentHash, nodes) : null;
  if (hashTarget) candidates.push(hashTarget);

  for (const candidate of candidates) {
    if (!usedNodeIds.has(candidate.id) && isTargetSafeForOperation(operation, candidate, options)) {
      usedNodeIds.add(candidate.id);
      return { node: candidate, repaired: true, repairNote: "Mapped through fallback layout metadata." };
    }
  }

  const sectionTarget = findSemanticRepairTarget(operation, nodes, usedNodeIds, options);
  if (sectionTarget) {
    usedNodeIds.add(sectionTarget.id);
    return { node: sectionTarget, repaired: true, repairNote: "Moved to a safe line in the same resume section." };
  }

  return null;
}

function getCandidateTargetIds(operation: NormalizedOperation) {
  return Array.from(
    new Set(
      [
        operation.paragraphId,
        operation.insertAfterParagraphId,
        ...(operation.fallbackParagraphIds ?? [])
      ].filter(Boolean) as string[]
    )
  );
}

function findNodeByContentHash(contentHash: string, nodes: ParagraphNodeInfo[]) {
  return nodes.find((node) => node.contentHash === contentHash) ?? null;
}

function findSemanticRepairTarget(
  operation: NormalizedOperation,
  nodes: ParagraphNodeInfo[],
  usedNodeIds: Set<string>,
  options: ApplyDocxEditOptions
) {
  const targetSection = normalizeForMatch(operation.sectionName || operation.targetSection || "");
  const normalizedOriginal = operation.normalizedOriginal;
  const targetKeywords = (operation.targetKeywords ?? operation.keywords ?? []).map(normalizeForMatch).filter(Boolean);

  let bestNode: ParagraphNodeInfo | null = null;
  let bestScore = 0;

  for (const node of nodes) {
    if (usedNodeIds.has(node.id) || !isTargetSafeForOperation(operation, node, options)) continue;
    const sectionScore =
      targetSection && node.sectionName && normalizeForMatch(node.sectionName).includes(targetSection) ? 0.3 : 0;
    const roleScore = getOperationRoleScore(operation, node);
    const keywordScore = targetKeywords.some((keyword) => normalizeForMatch(node.text).includes(keyword)) ? 0.18 : 0;
    const textScore = normalizedOriginal ? getMatchScore(node.normalizedText, normalizedOriginal) * 0.5 : 0;
    const score = sectionScore + roleScore + keywordScore + textScore;
    if (score > bestScore) {
      bestNode = node;
      bestScore = score;
    }
  }

  return bestScore >= 0.24 ? bestNode : null;
}

function getOperationRoleScore(operation: NormalizedOperation, node: ParagraphNodeInfo) {
  if (operation.type === "replace_bullet" && node.role === "bullet") return 0.32;
  if ((operation.type === "append_to_line" || operation.type === "append_to_paragraph") && node.role === "skills_line") return 0.32;
  if ((operation.type === "shorten_line" || operation.type === "shorten_paragraph") && node.canEdit) return 0.2;
  if (operation.type === "insert_bullet_after" && node.canInsertAfter) return 0.26;
  return node.canEdit ? 0.08 : 0;
}

function isTargetSafeForOperation(operation: NormalizedOperation, target: ParagraphNodeInfo, options: ApplyDocxEditOptions) {
  if (operation.type === "insert_bullet_after") return target.canInsertAfter;
  if (operation.type === "remove_low_priority_paragraph") {
    return options.layoutPressure ? canRemoveParagraphUnderPressure(target, []) || target.canEdit : target.canEdit;
  }
  if (!target.canEdit || isProtectedParagraph(target.text)) return false;
  const safeOperations = target.safeOperations ?? getSafeOperations(target);
  if (!safeOperations.includes(operation.type)) {
    if (operation.type === "replace_line" && safeOperations.includes("replace_paragraph_text")) return true;
    if (operation.type === "replace_paragraph_text" && safeOperations.includes("replace_line")) return true;
    if (operation.type === "append_to_line" && safeOperations.includes("append_to_paragraph")) return true;
    if (operation.type === "append_to_paragraph" && safeOperations.includes("append_to_line")) return true;
    if (operation.type === "shorten_line" && safeOperations.includes("shorten_paragraph")) return true;
    if (operation.type === "shorten_paragraph" && safeOperations.includes("shorten_line")) return true;
    return false;
  }
  return true;
}

function findSafeInsertAnchor(
  operation: NormalizedOperation,
  target: ParagraphNodeInfo,
  nodes: ParagraphNodeInfo[],
  nodeById: Map<string, ParagraphNodeInfo>
): ResolvedOperationTarget | null {
  const anchorIds = [
    ...(target.insertAnchorIds ?? []),
    ...(target.nearbyBulletIds ?? []),
    ...(operation.fallbackParagraphIds ?? [])
  ];
  for (const id of anchorIds) {
    const candidate = nodeById.get(id);
    if (candidate?.canInsertAfter) {
      return { node: candidate, repaired: true, repairNote: "Moved inserted bullet to a safe nearby anchor." };
    }
  }

  const template = findNearestBulletTemplate(target, nodes);
  return template ? { node: template, repaired: true, repairNote: "Moved inserted bullet to nearest bullet in section." } : null;
}

function buildReplacementText(target: ParagraphNodeInfo, operation: NormalizedOperation) {
  if (operation.type === "append_to_line" || operation.type === "append_to_paragraph") {
    if (operation.replacement && normalizeForMatch(operation.replacement) !== normalizeForMatch(operation.original)) {
      return protectLayoutText(target, operation.replacement);
    }

    const keywords = operation.keywords?.map(cleanDocxReplacementText).filter(Boolean) ?? [];
    if (!keywords.length) return "";
    const existing = target.editableText || target.text;
    const newKeywords = keywords.filter((keyword) => !normalizeForMatch(existing).includes(normalizeForMatch(keyword)));
    if (!newKeywords.length) return "";
    return protectLayoutText(target, `${existing.replace(/[.;,\s]*$/, "")}, ${newKeywords.join(", ")}`);
  }

  return protectLayoutText(target, operation.replacement);
}

function protectLayoutText(target: ParagraphNodeInfo, replacement: string) {
  const protectedTexts = target.textElements.filter((item) => item.protected).map((item) => item.text);
  if (target.role === "date_locked_header" && target.rightText) protectedTexts.push(target.rightText);
  return cleanDocxReplacementText(removeProtectedTextsFromReplacement(replacement, protectedTexts));
}

function fitReplacementToParagraphBudget(
  target: ParagraphNodeInfo,
  replacement: string,
  requestedMaxChars?: number
): FittedReplacement {
  let safeReplacement = cleanDocxReplacementText(replacement);
  if (!safeReplacement) return { text: "", shortened: false };

  if (target.role === "date_locked_header") {
    safeReplacement = safeReplacement.replace(/\t.*/, "").trim();
    if (target.rightText) {
      safeReplacement = safeReplacement.replace(new RegExp(`${escapeRegExp(target.rightText)}\\s*$`, "i"), "").trim();
    }
  }

  const layoutBudget = target.maxReplacementChars ?? target.editableCharBudget;
  const operationBudget =
    typeof requestedMaxChars === "number" && Number.isFinite(requestedMaxChars)
      ? Math.max(24, Math.min(900, Math.round(requestedMaxChars)))
      : undefined;
  const budget = layoutBudget && operationBudget ? Math.min(layoutBudget, operationBudget) : layoutBudget ?? operationBudget;
  if (!budget || safeReplacement.length <= budget) return { text: safeReplacement, shortened: false };

  const shortened = safeReplacement.slice(0, Math.max(24, budget - 1)).replace(/\s+\S*$/, "").trim();
  return {
    text: shortened || safeReplacement.slice(0, budget).trim(),
    shortened: true
  };
}

function convertDocxRemovalToReplacement(target: ParagraphNodeInfo, operation: NormalizedOperation) {
  const current = (target.editableText || target.leftText || target.text).trim();
  const replacement = cleanDocxReplacementText(operation.replacement);
  if (!target.canEdit || !current || !replacement) return null;

  const fitted = fitReplacementToParagraphBudget(target, protectLayoutText(target, replacement), operation.maxChars);
  if (!fitted.text || normalizeForMatch(fitted.text) === normalizeForMatch(current)) return null;

  return {
    text: fitted.text,
    type: fitted.text.length < current.length ? "shorten_paragraph" : target.isBullet ? "replace_bullet" : "replace_paragraph_text",
    shortened: fitted.shortened || fitted.text.length < current.length
  } satisfies { text: string; type: "shorten_paragraph" | "replace_bullet" | "replace_paragraph_text"; shortened: boolean };
}

function canRemoveParagraphUnderPressure(target: ParagraphNodeInfo, nodes: ParagraphNodeInfo[]) {
  if (!target.canRemove || isProtectedParagraph(target.text)) return false;
  if (target.role !== "bullet" && target.role !== "activity_line") return false;
  if (target.hasLockedDate || target.hasTabStop || target.isTerminalSection) return false;
  if (isLastMeaningfulParagraphInSection(target, nodes)) return false;
  return true;
}

function isLastMeaningfulParagraphInSection(target: ParagraphNodeInfo, nodes: ParagraphNodeInfo[]) {
  const section = target.sectionName || "";
  const peers = nodes.filter((node) => {
    if (node.id === target.id) return false;
    if ((node.sectionName || "") !== section) return false;
    if (node.role === "blank" || node.role === "divider" || node.role === "section_heading") return false;
    return Boolean(node.text.trim());
  });
  return peers.length === 0;
}

function replaceParagraphEditableText(paragraph: ParagraphNodeInfo, replacement: string) {
  if (!paragraph.editableTextElements.length) return false;
  applyReplacementToEditableTextElements(paragraph.editableTextElements, replacement);
  paragraph.textElements = getTextElementInfos(paragraph.element);
  paragraph.editableTextElements = getEditableTextElements(paragraph.role, paragraph.textElements);
  paragraph.text = paragraph.textElements.map((item) => item.text).join("");
  paragraph.normalizedText = normalizeForMatch(paragraph.text);
  paragraph.editableText = paragraph.editableTextElements.map((item) => item.text).join("").trim();
  return true;
}

function insertBulletAfter(target: ParagraphNodeInfo, replacement: string, nodes: ParagraphNodeInfo[]) {
  const cleanReplacement = cleanDocxReplacementText(replacement);
  if (!cleanReplacement) return false;

  const template = findNearestBulletTemplate(target, nodes);
  if (!template) return false;

  const clone = template.element.cloneNode(true) as Element;
  const cloneTextElements = getTextElementInfos(clone).filter((item) => !item.protected);
  if (!cloneTextElements.length) return false;
  applyReplacementToEditableTextElements(cloneTextElements, cleanReplacement);

  const parent = target.element.parentNode;
  if (!parent) return false;
  parent.insertBefore(clone, target.element.nextSibling);
  return true;
}

function findNearestBulletTemplate(target: ParagraphNodeInfo, nodes: ParagraphNodeInfo[]) {
  if (target.role === "bullet") return target;

  const targetIndex = nodes.findIndex((node) => node.id === target.id);
  for (let index = targetIndex; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node?.role === "bullet" && (!target.sectionName || node.sectionName === target.sectionName)) return node;
  }
  for (let index = targetIndex + 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node?.role === "bullet" && (!target.sectionName || node.sectionName === target.sectionName)) return node;
  }
  return nodes.find((node) => node.role === "bullet") ?? null;
}

function applyReplacementToEditableTextElements(editableTextElements: TextElementInfo[], replacement: string) {
  const firstEditable = editableTextElements[0];
  if (!firstEditable) return;

  const firstText = firstEditable.text;
  const labelPrefix = getLabelPrefix(firstText);
  const bulletPrefix = getBulletPrefix(firstText);
  const normalizedReplacement = replacement.replace(/^\s*(?:[-*•●▪‣]\s*)?/, "");
  const startsWithLabel =
    Boolean(labelPrefix) && normalizedReplacement.toLowerCase().startsWith(labelPrefix.trim().toLowerCase());
  const finalReplacement =
    labelPrefix && !startsWithLabel
      ? `${labelPrefix}${normalizedReplacement.replace(new RegExp(`^${escapeRegExp(labelPrefix.trim())}`, "i"), "").trimStart()}`
      : `${bulletPrefix}${normalizedReplacement}`;

  if (labelPrefix && editableTextElements.length > 1) {
    const rest = finalReplacement.replace(new RegExp(`^\\s*${escapeRegExp(labelPrefix.trim())}\\s*`, "i"), "").trimStart();
    editableTextElements.forEach((info, index) => {
      if (index === 0) {
        setTextElementContent(info.element, preserveWhitespaceAround(info.text, labelPrefix));
        info.text = labelPrefix;
        return;
      }
      if (index === 1) {
        setTextElementContent(info.element, preserveWhitespaceAround(info.text, rest));
        info.text = rest;
        return;
      }
      setTextElementContent(info.element, "");
      info.text = "";
    });
    return;
  }

  editableTextElements.forEach((info, index) => {
    setTextElementContent(info.element, index === 0 ? preserveWhitespaceAround(info.text, finalReplacement) : "");
    info.text = index === 0 ? finalReplacement : "";
  });
}

function getLabelPrefix(text: string) {
  const match = text.match(/^(\s*[^:]{2,42}:\s*)/);
  if (!match) return "";
  if (dateLikePattern.test(match[1]) || contactPattern.test(match[1])) return "";
  return match[1];
}

function getBulletPrefix(text: string) {
  const match = text.match(/^(\s*[•●▪‣\-*]\s*)/);
  return match?.[1] ?? "";
}

function normalizeBlankSpacing(document: Document) {
  const paragraphs = getElementsByLocalName(document, "p");
  let blankRun = 0;

  paragraphs.forEach((paragraph) => {
    const isBlank = isBlankParagraphElement(paragraph);
    if (!isBlank) {
      blankRun = 0;
      return;
    }

    blankRun += 1;
    if (blankRun > 1) {
      paragraph.parentNode?.removeChild(paragraph);
    }
  });
}

function isBlankParagraphElement(paragraph: Element) {
  if (hasParagraphBorder(paragraph)) return false;
  const text = getTextElementInfos(paragraph)
    .map((item) => item.text)
    .join("")
    .trim();
  return !text;
}

function estimateDocxLayoutPressure(
  nodes: ParagraphNodeInfo[],
  operations: NormalizedOperation[],
  layoutAdjustment: ResumeLayoutAdjustment
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  let insertedBullets = 0;
  let positiveGrowth = 0;
  let shortening = 0;
  let hasShorteningOperation = false;

  operations.forEach((operation) => {
    const targetId = operation.type === "insert_bullet_after" ? operation.insertAfterParagraphId || operation.paragraphId : operation.paragraphId;
    const target = targetId ? nodeById.get(targetId) : null;
    const originalLength = target?.editableText.length || operation.original.length;
    const replacementLength = operation.replacement.length;

    if (operation.type === "insert_bullet_after") {
      insertedBullets += 1;
      positiveGrowth += replacementLength + 14;
      return;
    }

    if (operation.type === "remove_low_priority_paragraph") return;

    if (operation.type === "shorten_line" || operation.type === "shorten_paragraph") hasShorteningOperation = true;
    const delta = replacementLength - originalLength;
    if (delta > 0) positiveGrowth += delta;
    if (delta < 0) shortening += Math.abs(delta);
  });

  const originalCharacterCount = nodes.reduce((sum, node) => sum + node.text.length, 0);
  const originalParagraphCount = nodes.filter((node) => node.text.trim()).length;
  const denseOriginal = originalCharacterCount > 3600 || originalParagraphCount > 58;
  const hasMeaningfulAdds = insertedBullets > 0 || positiveGrowth > 160;
  const hasFitAttempt = layoutAdjustment.fontScale < 0.98 || hasShorteningOperation || shortening > 120;

  return hasMeaningfulAdds && hasFitAttempt && (denseOriginal || insertedBullets > 1 || positiveGrowth > 280);
}

function createLayoutSnapshot(nodes: ParagraphNodeInfo[]): LayoutSnapshot {
  const blankRunStats = getBlankRunStats(nodes);
  const sectionHeadings = nodes
    .filter((node) => node.role === "section_heading")
    .map((node) => normalizeForMatch(node.text));
  const terminalSections = nodes
    .filter((node) => node.role === "section_heading" && isTerminalSectionName(node.text))
    .map((node) => normalizeForMatch(node.text));
  const dateHeaders = nodes
    .filter((node) => node.role === "date_locked_header")
    .map((node) => ({
      rightText: normalizeForMatch(node.rightText || node.lockedText || ""),
      tabStopSignature: node.tabStopSignature || ""
    }));

  return {
    paragraphCount: nodes.length,
    blankParagraphCount: blankRunStats.blankParagraphCount,
    maxBlankRun: blankRunStats.maxBlankRun,
    sectionHeadings,
    terminalSections,
    dateHeaders
  };
}

function validateLayoutPreservation(original: LayoutSnapshot, edited: LayoutSnapshot) {
  if (edited.paragraphCount < original.paragraphCount) {
    throw new Error("Generated DOCX removed resume paragraphs.");
  }

  if (edited.blankParagraphCount > original.blankParagraphCount) {
    throw new Error("Generated DOCX introduced new blank paragraphs.");
  }

  if (edited.maxBlankRun > Math.max(original.maxBlankRun, 1)) {
    throw new Error("Generated DOCX introduced a large blank gap.");
  }

  if (edited.sectionHeadings.length !== original.sectionHeadings.length) {
    throw new Error("Generated DOCX changed the resume section structure.");
  }

  const originalSections = original.sectionHeadings.join("|");
  const editedSections = edited.sectionHeadings.join("|");
  if (originalSections !== editedSections) {
    throw new Error("Generated DOCX changed one or more section headings.");
  }

  const missingTerminalSection = original.terminalSections.find((section) => !edited.terminalSections.includes(section));
  if (missingTerminalSection) {
    throw new Error("Generated DOCX removed an end resume section.");
  }

  if (edited.dateHeaders.length !== original.dateHeaders.length) {
    throw new Error("Generated DOCX changed the number of right-aligned date rows.");
  }

  for (let index = 0; index < original.dateHeaders.length; index += 1) {
    const before = original.dateHeaders[index];
    const after = edited.dateHeaders[index];
    if (!after || before.rightText !== after.rightText) {
      throw new Error("Generated DOCX changed a locked date value.");
    }
    if (before.tabStopSignature !== after.tabStopSignature) {
      throw new Error("Generated DOCX changed a tab stop used for date alignment.");
    }
  }
}

function getBlankRunStats(nodes: ParagraphNodeInfo[]) {
  let blankParagraphCount = 0;
  let currentRun = 0;
  let maxBlankRun = 0;

  nodes.forEach((node) => {
    const isBlank = node.role === "blank" || !node.text.trim();
    if (!isBlank) {
      currentRun = 0;
      return;
    }

    blankParagraphCount += 1;
    currentRun += 1;
    maxBlankRun = Math.max(maxBlankRun, currentRun);
  });

  return { blankParagraphCount, maxBlankRun };
}

function getTextElementInfos(paragraph: Element): TextElementInfo[] {
  const infos: TextElementInfo[] = [];
  let afterTab = false;
  const paragraphTextParts: string[] = [];

  walkElements(paragraph, (element) => {
    const localName = getLocalName(element);
    if (localName === "tab") {
      afterTab = true;
      paragraphTextParts.push("\t");
      return;
    }

    if (localName !== "t") return;

    const text = element.textContent ?? "";
    paragraphTextParts.push(text);
    infos.push({
      element,
      text,
      afterTab,
      protected: false
    });
  });

  const paragraphText = paragraphTextParts.join("");
  const contactParagraph = isLikelyContactParagraph(paragraphText);

  return infos.map((info) => ({
    ...info,
    protected: info.afterTab || contactParagraph || isProtectedResumeText(info.text)
  }));
}

function scaleFontSizesInDocument(document: Document, fontScale: number) {
  if (fontScale >= 0.995) return;

  getElementsByLocalName(document, "sz").forEach((element) => {
    const value = getWordAttribute(element, "val");
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;

    const nextValue = Math.max(16, Math.round(numericValue * fontScale));
    setWordAttribute(element, "val", String(nextValue));
  });

  getElementsByLocalName(document, "szCs").forEach((element) => {
    const value = getWordAttribute(element, "val");
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;

    const nextValue = Math.max(16, Math.round(numericValue * fontScale));
    setWordAttribute(element, "val", String(nextValue));
  });
}

async function validateDocxBuffer(buffer: Uint8Array | ArrayBuffer, options: { extractText: boolean }) {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("Generated DOCX is missing word/document.xml.");
  const documentXml = await documentFile.async("string");
  const document = parseXml(documentXml, "generated word/document.xml");
  if (!getElementsByLocalName(document, "body").length) {
    throw new Error("Generated DOCX has no Word document body.");
  }

  const canRunNodeMammoth = typeof window === "undefined" && typeof Buffer !== "undefined";

  if (options.extractText && canRunNodeMammoth) {
    const mammoth = await import("mammoth");
    const nodeBuffer = Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);
    const result = await mammoth.extractRawText({ buffer: nodeBuffer });
    if (!result.value.trim()) {
      throw new Error("Generated DOCX did not produce readable text.");
    }
  }
}

function parseXml(xml: string, fileName: string) {
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level === "warning") return;
      throw new Error(`${fileName} XML parse error: ${message}`);
    }
  });

  const document = parser.parseFromString(xml, "application/xml");
  if (getElementsByLocalName(document, "parsererror").length) {
    throw new Error(`${fileName} XML parse error.`);
  }
  return document;
}

function serializeXml(document: Document) {
  return new XMLSerializer().serializeToString(document);
}

function getElementsByLocalName(root: Document | Element, localName: string) {
  const matches: Element[] = [];
  walkElements(root, (element) => {
    if (getLocalName(element) === localName) matches.push(element);
  });
  return matches;
}

function walkElements(root: Document | Element, visitor: (element: Element) => void) {
  const node = "documentElement" in root ? root.documentElement : root;
  if (!node) return;

  const visit = (current: Node) => {
    if (current.nodeType === 1) {
      const element = current as Element;
      visitor(element);
      for (let index = 0; index < element.childNodes.length; index += 1) {
        const child = element.childNodes.item(index);
        if (child) visit(child);
      }
    }
  };

  visit(node);
}

function getLocalName(element: Element) {
  return element.localName || element.nodeName.split(":").pop() || element.nodeName;
}

function getWordAttribute(element: Element, name: string) {
  return element.getAttributeNS(wordNamespace, name) ?? element.getAttribute(`w:${name}`) ?? element.getAttribute(name);
}

function setWordAttribute(element: Element, name: string, value: string) {
  if (element.hasAttributeNS(wordNamespace, name)) {
    element.setAttributeNS(wordNamespace, `w:${name}`, value);
    return;
  }
  if (element.hasAttribute(`w:${name}`)) {
    element.setAttribute(`w:${name}`, value);
    return;
  }
  element.setAttribute(`w:${name}`, value);
}

function setTextElementContent(element: Element, value: string) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  const ownerDocument = element.ownerDocument;
  if (!ownerDocument) return;
  element.appendChild(ownerDocument.createTextNode(value));
  if (/^\s|\s$/.test(value)) {
    element.setAttribute("xml:space", "preserve");
  }
}

function getParagraphStyle(paragraph: Element) {
  const styleElement = getElementsByLocalName(paragraph, "pStyle")[0];
  return (styleElement ? getWordAttribute(styleElement, "val") ?? "" : "").toLowerCase();
}

function hasParagraphBorder(paragraph: Element) {
  return getElementsByLocalName(paragraph, "pBdr").length > 0;
}

function isProtectedParagraph(text: string) {
  const normalized = normalizeForMatch(text);
  if (!normalized) return true;
  if (isLikelyContactParagraph(text)) return true;
  if (sectionHeadingPattern.test(text.trim())) return true;
  return false;
}

function isLikelyContactParagraph(text: string) {
  return contactPattern.test(text) && text.length < 180;
}

function isProtectedResumeText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (dateLikePattern.test(trimmed) && trimmed.length <= 40) return true;
  if (/^\d(?:\.\d{1,2})?\s*GPA$/i.test(trimmed) || /^GPA:?\s*\d(?:\.\d{1,2})?$/i.test(trimmed)) return true;
  return false;
}

function normalizeSectionName(text: string) {
  return text
    .trim()
    .replace(/[^a-z0-9/&+\-\s]/gi, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function isTerminalSectionName(text: string) {
  return terminalSectionPattern.test(text.trim());
}

function cleanDocxReplacementText(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function preserveWhitespaceAround(original: string, replacement: string) {
  const leading = original.match(/^\s*/)?.[0] ?? "";
  const trailing = original.match(/\s*$/)?.[0] ?? "";
  return `${leading}${replacement.trim()}${trailing}`;
}

function removeProtectedTextsFromReplacement(replacement: string, protectedTexts: string[]) {
  let safeReplacement = replacement;
  protectedTexts.forEach((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    safeReplacement = safeReplacement.replace(new RegExp(escapeRegExp(trimmed), "gi"), "").replace(/\s+\t\s+/g, "\t");
  });
  return safeReplacement.trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMatchScore(a: string, b: string) {
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 1;
  return Math.max(getTokenDiceScore(a, b), getCharacterDiceScore(a, b));
}

function getTokenDiceScore(a: string, b: string) {
  const aTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length > 2));
  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  aTokens.forEach((token) => {
    if (bTokens.has(token)) overlap += 1;
  });

  return (2 * overlap) / (aTokens.size + bTokens.size);
}

function getCharacterDiceScore(a: string, b: string) {
  const aBigrams = getBigrams(a);
  const bBigrams = getBigrams(b);
  if (!aBigrams.size || !bBigrams.size) return 0;

  let overlap = 0;
  aBigrams.forEach((count, bigram) => {
    overlap += Math.min(count, bBigrams.get(bigram) ?? 0);
  });

  const aCount = Array.from(aBigrams.values()).reduce((sum, count) => sum + count, 0);
  const bCount = Array.from(bBigrams.values()).reduce((sum, count) => sum + count, 0);
  return (2 * overlap) / (aCount + bCount);
}

function getBigrams(value: string) {
  const normalized = value.replace(/\s+/g, "");
  const bigrams = new Map<string, number>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const bigram = normalized.slice(index, index + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  return bigrams;
}
