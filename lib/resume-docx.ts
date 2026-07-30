import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document as XmldomDocument, Element as XmldomElement, Node as XmldomNode } from "@xmldom/xmldom";
import JSZip from "jszip";
import { selectCompleteReplacementCandidate } from "./resume-fit.ts";
import type {
  ResumeBulletRewrite,
  ResumeAppliedChange,
  ResumeDocxEditStats,
  ResumeDocxParagraphRole,
  ResumeEditOperation,
  ResumeEditOperationType,
  ResumeFitSkillPruneCandidate,
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
      approvedRemovalParagraphIds?: string[];
      approvedSkillPrunes?: ResumeFitSkillPruneCandidate[];
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
  candidateIndex: number;
  failureCategory?: "protected_content" | "replacement_did_not_fit";
};

type NormalizedDocxInput = {
  operations: NormalizedOperation[];
  layoutAdjustment: ResumeLayoutAdjustment;
  approvedRemovalParagraphIds: string[];
  approvedSkillPrunes: ResumeFitSkillPruneCandidate[];
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
  appliedChanges: ResumeAppliedChange[];
  skippedChanges: ResumeSkippedChange[];
  removedParagraphIds: string[];
  prunedSkills: ResumeFitSkillPruneCandidate[];
  bodyFontScale: number;
  scaledParagraphIds: string[];
};

const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const dateLikePattern =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b\d{4}\s*(?:-|–|—|to)\s*(?:present|\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4})\b|\b(?:present|current)\b/i;
const contactPattern = /@|linkedin\.com|github\.com|\(\d{3}\)|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i;
const sectionHeadingPattern = /^[A-Z][A-Z0-9/&+\-\s]{2,70}$/;
const terminalSectionPattern =
  /\b(PROJECTS?|CERTIFICATIONS?|PUBLICATIONS?|ACTIVITIES?|LEADERSHIP|INVOLVEMENT|AWARDS?|ORGANIZATIONS?|VOLUNTEER|ADDITIONAL)\b/i;
const maxDocxLayoutLockedOperations = 14;
const maxFitRemovals = 4;
const maxFitRemovalsPerSection = 2;

export async function createResumeLayoutMapFromDocx(originalDocx: Buffer | ArrayBuffer | Uint8Array) {
  const zip = await JSZip.loadAsync(originalDocx);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX is missing word/document.xml.");

  const document = parseXml(await documentFile.async("string"), "word/document.xml");
  const nodes = buildParagraphNodes(document);
  const sectionNames = Array.from(new Set(nodes.map((node) => node.sectionName).filter(Boolean) as string[]));
  const stylesFile = zip.file("word/styles.xml");
  const stylesDocument = stylesFile ? parseXml(await stylesFile.async("string"), "word/styles.xml") : null;

  return {
    source: "docx",
    paragraphs: nodes.map(toLayoutParagraph),
    sectionNames,
    page: extractDocxPageGeometry(document),
    defaultFont: stylesDocument ? extractDocxDefaultFont(stylesDocument) : undefined,
    defaultFontSizePt: stylesDocument ? extractDocxDefaultFontSize(stylesDocument) : undefined,
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
  if (
    !tailoringInput.operations.length &&
    !tailoringInput.approvedRemovalParagraphIds.length &&
    !tailoringInput.approvedSkillPrunes.length &&
    tailoringInput.layoutAdjustment.fontScale >= 1
  ) {
    const buffer = toUint8Array(originalDocx);
    await validateDocxBuffer(buffer, { extractText: true });
    return {
      buffer,
      stats: {
        ...createDocxStats(),
        validationStatus: "valid"
      },
      appliedChanges: [],
      skippedChanges: [],
      removedParagraphIds: [],
      prunedSkills: [],
      bodyFontScale: 1,
      scaledParagraphIds: []
    } satisfies TailoredDocxBuildResult;
  }

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
  const originalStructureDocument = document.cloneNode(true) as Document;
  const nodes = buildParagraphNodes(document);
  const stylesFile = zip.file("word/styles.xml");
  const stylesDocument = stylesFile
    ? parseXml(await stylesFile.async("string"), "word/styles.xml")
    : null;
  const defaultFontSizePt = stylesDocument
    ? extractDocxDefaultFontSize(stylesDocument) ?? 10
    : 10;
  const originalSnapshot = createLayoutSnapshot(nodes);
  const layoutLockedOperations = prepareLayoutLockedDocxOperations(tailoringInput.operations, nodes, options);
  const layoutPressure = estimateDocxLayoutPressure(nodes, layoutLockedOperations, tailoringInput.layoutAdjustment);
  const operationResult = applyDocxParagraphEdits(document, nodes, layoutLockedOperations, {
    layoutPressure,
    inPlaceOnly: options.inPlaceOnly
  });
  const skillPruneResult = applyApprovedSkillPrunes(
    nodes,
    tailoringInput.approvedSkillPrunes
  );
  const removalResult = applyApprovedParagraphRemovals(
    nodes,
    tailoringInput.approvedRemovalParagraphIds,
    operationResult.acceptedImprovementSections
  );
  const scaledParagraphIds = applyEligibleBodyFontScale(
    nodes,
    tailoringInput.layoutAdjustment.fontScale,
    defaultFontSizePt
  );

  const editedSnapshot = createLayoutSnapshot(buildParagraphNodes(document));
  validateLayoutPreservation(originalSnapshot, editedSnapshot, removalResult.removedParagraphIds.length);
  validateDocumentStructureSignature(
    createDocumentStructureSignature(
      originalStructureDocument,
      removalResult.removedParagraphIds,
      tailoringInput.layoutAdjustment.fontScale < 1
    ),
    document,
    tailoringInput.layoutAdjustment.fontScale < 1
  );

  zip.file("word/document.xml", serializeXml(document));

  const buffer = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });

  const stats: ResumeDocxEditStats = {
    ...operationResult.stats,
    removedLines: removalResult.removedParagraphIds.length,
    removedForFit: removalResult.removedParagraphIds.length,
    removedParagraphIds: removalResult.removedParagraphIds,
    skillsPruned: skillPruneResult.prunedSkills.length,
    prunedSkills: skillPruneResult.prunedSkills.map((item) => item.skill),
    fontScaleApplied: tailoringInput.layoutAdjustment.fontScale,
    skippedByReason: mergeCountRecords(
      operationResult.stats.skippedByReason,
      removalResult.skippedByReason,
      skillPruneResult.skippedByReason
    ),
    skippedEdits:
      operationResult.skippedChanges.length +
      removalResult.skippedChanges.length +
      skillPruneResult.skippedChanges.length,
    fontScale: tailoringInput.layoutAdjustment.fontScale,
    validationStatus: "not_generated"
  };

  try {
    await validateDocxBuffer(buffer, { extractText: true });
    await validateExactDocxPackageFidelity(originalDocx, buffer, {
      removedParagraphIds: removalResult.removedParagraphIds,
      bodyFontScale: tailoringInput.layoutAdjustment.fontScale,
      scaledParagraphIds
    });
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
    appliedChanges: operationResult.appliedChanges,
    skippedChanges: [
      ...operationResult.skippedChanges,
      ...removalResult.skippedChanges,
      ...skillPruneResult.skippedChanges
    ],
    removedParagraphIds: removalResult.removedParagraphIds,
    prunedSkills: skillPruneResult.prunedSkills,
    bodyFontScale: tailoringInput.layoutAdjustment.fontScale,
    scaledParagraphIds
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
    appliedChanges: [],
    skippedChanges,
    removedParagraphIds: [],
    prunedSkills: [],
    bodyFontScale: 1,
    scaledParagraphIds: []
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
    layoutAdjustment: normalizeLayoutAdjustment(Array.isArray(input) ? undefined : input.layoutAdjustment),
    approvedSkillPrunes: Array.isArray(input)
      ? []
      : normalizeApprovedSkillPrunes(input.approvedSkillPrunes),
    approvedRemovalParagraphIds: Array.isArray(input)
      ? []
      : Array.from(
          new Set(
            (input.approvedRemovalParagraphIds ?? [])
              .filter((id): id is string => typeof id === "string")
              .map((id) => id.trim())
              .filter((id) => /^p\d{3,5}$/.test(id))
          )
        ).slice(0, maxFitRemovals)
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
  return {
    fontScale:
      typeof value?.fontScale === "number" && Number.isFinite(value.fontScale)
        ? Math.max(0.94, Math.min(1, value.fontScale))
        : 1,
    reason:
      value?.reason ||
      "Protected typography is locked; eligible body text may scale for verified fit."
  };
}

function normalizeApprovedSkillPrunes(
  value?: ResumeFitSkillPruneCandidate[]
) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const key = `${candidate.paragraphId}:${candidate.skill
        .toLowerCase()
        .trim()}`;
      if (
        !/^p\d{3,5}$/.test(candidate.paragraphId) ||
        !candidate.skill.trim() ||
        seen.has(key)
      ) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 12)
    .map((candidate) => ({ ...candidate }));
}

function prepareLayoutLockedDocxOperations(
  operations: NormalizedOperation[],
  nodes: ParagraphNodeInfo[],
  options: { inPlaceOnly: boolean }
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const usedFallbackNodeIds = new Set<string>();
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

  const replacement = fitFoldedDocxDetail(foldTarget, current, operation);
  if (!replacement || normalizeForMatch(current) === normalizeForMatch(replacement)) return null;

  return {
    ...operation,
    type: foldTarget.isBullet ? "replace_bullet" : "append_to_paragraph",
    paragraphId: foldTarget.id,
    insertAfterParagraphId: undefined,
    original: foldTarget.editableText || foldTarget.text,
    replacement,
    replacementCandidates: [replacement],
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
  operation: NormalizedOperation
) {
  const layoutBudget = target.maxReplacementChars ?? target.editableCharBudget;
  const operationBudget =
    typeof operation.maxChars === "number" && Number.isFinite(operation.maxChars)
      ? Math.max(24, Math.min(900, Math.round(operation.maxChars)))
      : undefined;
  const budget = layoutBudget && operationBudget ? Math.min(layoutBudget, operationBudget) : layoutBudget ?? operationBudget;
  const separator = /[.;:]$/.test(current) ? " " : "; ";
  const details = [
    stripDocxBulletPrefix(operation.replacement),
    ...(operation.replacementCandidates ?? []).map(stripDocxBulletPrefix)
  ];
  const combined = details.map((detail) => cleanDocxReplacementText(`${current}${separator}${detail}`));
  return (
    selectCompleteReplacementCandidate({
      replacement: combined[0] ?? "",
      replacementCandidates: combined.slice(1),
      maxChars: budget
    })?.text ?? ""
  );
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
      format: extractDocxParagraphFormat(paragraph),
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
    groupId: node.groupId,
    bulletIndex: node.bulletIndex,
    bulletCount: node.bulletCount,
    format: node.format,
    hasLockedDate: node.hasLockedDate,
    isBullet: node.isBullet,
    canEdit: node.canEdit,
    canInsertAfter: node.canInsertAfter,
    canRemove: node.canRemove
  };
}

function enrichParagraphNodes(nodes: ParagraphNodeInfo[]) {
  const groupedNodes = annotateParagraphGroups(nodes);
  return groupedNodes.map((node, index) => ({
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

function annotateParagraphGroups(nodes: ParagraphNodeInfo[]) {
  const groupByNodeId = new Map<string, string>();
  let activeSection = "";
  let activeGroup = "resume:root";

  nodes.forEach((node, index) => {
    const section = normalizeForMatch(node.sectionName || activeSection || "resume") || "resume";
    if (section !== activeSection) {
      activeSection = section;
      activeGroup = `${section}:root`;
    }

    const nextNode = nodes[index + 1];
    const beginsBulletGroup =
      node.role === "date_locked_header" ||
      node.role === "role_header" ||
      (!node.isBullet &&
        Boolean(node.text.trim()) &&
        nextNode?.isBullet === true &&
        node.role !== "section_heading" &&
        node.role !== "contact_header");
    if (beginsBulletGroup) activeGroup = `${section}:${node.id}`;
    groupByNodeId.set(node.id, activeGroup);
  });

  const bulletCounts = new Map<string, number>();
  nodes.forEach((node) => {
    if (!node.isBullet) return;
    const groupId = groupByNodeId.get(node.id) ?? "resume:root";
    bulletCounts.set(groupId, (bulletCounts.get(groupId) ?? 0) + 1);
  });

  const bulletIndexes = new Map<string, number>();
  return nodes.map((node) => {
    const groupId = groupByNodeId.get(node.id) ?? "resume:root";
    const bulletIndex = node.isBullet ? bulletIndexes.get(groupId) ?? 0 : undefined;
    if (node.isBullet) bulletIndexes.set(groupId, (bulletIndex ?? 0) + 1);
    return {
      ...node,
      groupId,
      bulletIndex,
      bulletCount: node.isBullet ? bulletCounts.get(groupId) ?? 0 : undefined
    };
  });
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
  if (
    role === "contact_header" ||
    role === "section_heading" ||
    role === "divider" ||
    role === "blank" ||
    role === "role_header" ||
    role === "date_locked_header"
  ) {
    return [];
  }
  return textElements.filter((item) => !item.protected);
}

function canEditRole(role: ResumeDocxParagraphRole, editableTextElements: TextElementInfo[]) {
  if (!editableTextElements.length) return false;
  return (
    role !== "contact_header" &&
    role !== "section_heading" &&
    role !== "divider" &&
    role !== "blank" &&
    role !== "role_header" &&
    role !== "date_locked_header"
  );
}

function applyDocxParagraphEdits(
  _document: Document,
  nodes: ParagraphNodeInfo[],
  operations: NormalizedOperation[],
  options: ApplyDocxEditOptions
) {
  const stats = createDocxStats();
  const skippedChanges: ResumeSkippedChange[] = [];
  const appliedChanges: ResumeAppliedChange[] = [];
  if (!operations.length) {
    return {
      stats,
      appliedChanges,
      skippedChanges,
      acceptedImprovementSections: new Set<string>()
    };
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const usedFallbackNodeIds = new Set<string>();
  const acceptedImprovementCounts = new Map<string, number>();

  sortOperationsForDocx(operations).forEach((operation) => {
    const resolved = resolveOperationTarget(operation, nodes, nodeById, usedFallbackNodeIds, options);
    const target = resolved?.node;
    if (!target) {
      recordDocxSkip(skippedChanges, stats, operation, "Could not map this edit to a safe resume line.", "mapping");
      return;
    }

    if (operation.type === "insert_bullet_after") {
      const converted = convertDocxInsertionOperationToInPlace(operation, target, nodes, nodeById);
      const convertedTarget = converted?.paragraphId ? nodeById.get(converted.paragraphId) ?? null : null;
      if (!converted || !convertedTarget?.canEdit) {
        recordDocxSkip(
          skippedChanges,
          stats,
          operation,
          "Insertion skipped because exact layout mode cannot add paragraphs.",
          "unsafe_insertion"
        );
        return;
      }

      const fitted = fitReplacementToParagraphBudget(convertedTarget, converted);
      if (!fitted.text) {
        recordDocxSkip(
          skippedChanges,
          stats,
          operation,
          fitted.failureCategory === "protected_content"
            ? "Every complete fitting candidate changed a locked metric or added an unsupported number."
            : "No complete replacement candidate fit the target line.",
          fitted.failureCategory ?? "replacement_did_not_fit"
        );
        return;
      }

      if (!preservesLockedMetrics(convertedTarget.editableText, fitted.text)) {
        recordDocxSkip(
          skippedChanges,
          stats,
          operation,
          "Converted insertion changed a locked metric or added an unsupported number.",
          "protected_content"
        );
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
      if (fitted.candidateIndex >= 0 && converted.replacementCandidates?.length) {
        stats.selectedCandidateCount = (stats.selectedCandidateCount ?? 0) + 1;
      }
      stats.appliedEdits += 1;
      appliedChanges.push({
        ...converted,
        replacement: fitted.text,
        matchedText: convertedTarget.text,
        repairNote: "Converted insertion to an in-place edit."
      });
      recordAcceptedDocxImprovement(acceptedImprovementCounts, convertedTarget);
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

        if (!preservesLockedMetrics(target.editableText, converted.text)) {
          recordDocxSkip(
            skippedChanges,
            stats,
            operation,
            "Removal replacement changed a locked metric or added an unsupported number.",
            "protected_content"
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
        appliedChanges.push({
          ...operation,
          type: converted.type,
          replacement: converted.text,
          matchedText: target.text,
          repairNote: "Converted removal request to an in-place edit."
        });
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

    const fitted = fitReplacementToParagraphBudget(target, operation);
    if (!fitted.text) {
      recordDocxSkip(
        skippedChanges,
        stats,
        operation,
        fitted.failureCategory === "protected_content"
          ? "Every complete fitting candidate changed a locked metric or added an unsupported number."
          : "No complete replacement candidate fit the target line.",
        fitted.failureCategory ?? "replacement_did_not_fit"
      );
      return;
    }

    if (!preservesLockedMetrics(target.editableText, fitted.text)) {
      recordDocxSkip(
        skippedChanges,
        stats,
        operation,
        "The replacement changed a locked metric or added an unsupported number.",
        "protected_content"
      );
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
      stats.shortenedForFit = (stats.shortenedForFit ?? 0) + 1;
    } else if (operation.type === "shorten_line" || operation.type === "shorten_paragraph") {
      stats.shortenedEdits = (stats.shortenedEdits ?? 0) + 1;
    }
    if (fitted.candidateIndex >= 0 && operation.replacementCandidates?.length) {
      stats.selectedCandidateCount = (stats.selectedCandidateCount ?? 0) + 1;
    }
    stats.appliedEdits += 1;
    appliedChanges.push({
      ...operation,
      replacement: fitted.text,
      matchedText: target.text,
      repairNote: resolved.repaired ? resolved.repairNote : undefined
    });
    if (isDocxPairingImprovementOperation(operation.type)) {
      recordAcceptedDocxImprovement(acceptedImprovementCounts, target);
    }
  });

  return {
    stats,
    appliedChanges,
    skippedChanges,
    acceptedImprovementSections: new Set(
      [...acceptedImprovementCounts.entries()]
        .filter(([, count]) => count > 0)
        .map(([section]) => section)
    )
  };
}

function applyApprovedSkillPrunes(
  nodes: ParagraphNodeInfo[],
  approved: ResumeFitSkillPruneCandidate[]
) {
  const prunedSkills: ResumeFitSkillPruneCandidate[] = [];
  const skippedChanges: ResumeSkippedChange[] = [];
  const skippedByReason: Record<string, number> = {};
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const totalSkills = nodes
    .filter((node) => node.role === "skills_line")
    .reduce((sum, node) => sum + parseSkillsPayload(node.text).skills.length, 0);
  const overallLimit = Math.max(0, Math.floor(totalSkills * 0.2));
  const perParagraph = new Map<string, number>();

  const skip = (candidate: ResumeFitSkillPruneCandidate, reason: string) => {
    skippedChanges.push({
      paragraphId: candidate.paragraphId,
      original: candidate.originalText,
      replacement: candidate.originalText,
      reason: candidate.reason,
      skipReason: reason,
      skipCategory: "skill_prune_guard"
    });
    skippedByReason.skill_prune_guard =
      (skippedByReason.skill_prune_guard ?? 0) + 1;
  };

  for (const candidate of approved) {
    if (prunedSkills.length >= overallLimit) {
      skip(candidate, "Skill pruning stopped at the 20% overall limit.");
      continue;
    }
    const node = nodeById.get(candidate.paragraphId);
    if (
      !node ||
      node.role !== "skills_line" ||
      !node.canEdit ||
      (candidate.contentHash && node.contentHash !== candidate.contentHash)
    ) {
      skip(candidate, "The skill line no longer matched its verified source.");
      continue;
    }
    if ((perParagraph.get(node.id) ?? 0) >= 2) {
      skip(candidate, "No more than two skills may be pruned from one line.");
      continue;
    }

    const parsed = parseSkillsPayload(node.editableText || node.text);
    if (parsed.skills.length <= 3) {
      skip(candidate, "Every skill category must retain at least three skills.");
      continue;
    }
    const targetKey = normalizeForMatch(candidate.skill);
    const index = parsed.skills.findIndex(
      (skill) => normalizeForMatch(skill) === targetKey
    );
    if (index < 0) {
      skip(candidate, "The selected skill was not present in the final line.");
      continue;
    }

    const remaining = parsed.skills.filter((_, skillIndex) => skillIndex !== index);
    const replacement = `${parsed.label}${
      parsed.label ? " " : ""
    }${remaining.join(", ")}`.trim();
    if (!replaceParagraphEditableText(node, replacement)) {
      skip(candidate, "The skill could not be removed without changing its label formatting.");
      continue;
    }
    perParagraph.set(node.id, (perParagraph.get(node.id) ?? 0) + 1);
    prunedSkills.push(candidate);
  }

  return { prunedSkills, skippedChanges, skippedByReason };
}

function parseSkillsPayload(value: string) {
  const separatorIndex = value.indexOf(":");
  const label =
    separatorIndex >= 0 ? value.slice(0, separatorIndex + 1).trim() : "";
  const body = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value;
  return {
    label,
    skills: body
      .split(/[,;|]/)
      .map((skill) => skill.trim())
      .filter(Boolean)
  };
}

function applyEligibleBodyFontScale(
  nodes: ParagraphNodeInfo[],
  requestedScale: number,
  defaultFontSizePt: number
) {
  const scale = Math.max(0.94, Math.min(1, requestedScale));
  if (scale >= 0.999) return [];
  const scaledParagraphIds: string[] = [];

  nodes.forEach((node) => {
    if (!isBodyFontScaleEligible(node) || !node.element.parentNode) return;
    let changed = false;
    getElementsByLocalName(node.element, "r").forEach((run) => {
      const text = getElementsByLocalName(run, "t")
        .map((element) => element.textContent ?? "")
        .join("");
      if (!text.trim()) return;
      const runProperties = ensureRunProperties(run);
      const size = getElementsByLocalName(runProperties, "sz")[0];
      const explicitHalfPoints = size
        ? Number(getWordAttribute(size, "val"))
        : Number.NaN;
      const originalPt =
        Number.isFinite(explicitHalfPoints) && explicitHalfPoints > 0
          ? explicitHalfPoints / 2
          : node.format?.fontSizePt ?? defaultFontSizePt;
      const targetPt = Math.max(9, Math.round(originalPt * scale * 2) / 2);
      if (targetPt >= originalPt - 0.01) return;
      setRunFontSize(runProperties, targetPt * 2);
      changed = true;
    });
    if (changed) scaledParagraphIds.push(node.id);
  });

  return scaledParagraphIds;
}

function isBodyFontScaleEligible(node: ParagraphNodeInfo) {
  return (
    node.role === "body" ||
    node.role === "bullet" ||
    node.role === "skills_line" ||
    node.role === "education_line" ||
    node.role === "activity_line"
  );
}

function ensureRunProperties(run: Element) {
  const existing = getElementsByLocalName(run, "rPr")[0];
  if (existing) return existing;
  const document = run.ownerDocument;
  if (!document) throw new Error("DOCX run has no owner document.");
  const properties = document.createElementNS(wordNamespace, "w:rPr");
  run.insertBefore(properties, run.firstChild);
  return properties;
}

function setRunFontSize(runProperties: Element, halfPoints: number) {
  const document = runProperties.ownerDocument;
  if (!document) throw new Error("DOCX run properties have no owner document.");
  const value = String(Math.max(18, Math.round(halfPoints)));
  for (const localName of ["sz", "szCs"]) {
    let element = getElementsByLocalName(runProperties, localName)[0];
    if (!element) {
      element = document.createElementNS(wordNamespace, `w:${localName}`);
      runProperties.appendChild(element);
    }
    setWordAttribute(element, "val", value);
  }
}

function applyApprovedParagraphRemovals(
  nodes: ParagraphNodeInfo[],
  approvedParagraphIds: string[],
  acceptedImprovementSections: Set<string>
) {
  const removedParagraphIds: string[] = [];
  const skippedChanges: ResumeSkippedChange[] = [];
  const skippedByReason: Record<string, number> = {};
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIndexes = new Map(nodes.map((node, index) => [node.id, index]));
  const removedPerSection = new Map<string, number>();
  const removedGroups = new Set<string>();
  const removedIndexes = new Set<number>();

  const skip = (node: ParagraphNodeInfo | undefined, reason: string, category: string) => {
    skippedChanges.push({
      paragraphId: node?.id,
      sectionName: node?.sectionName,
      original: node?.text,
      skipReason: reason,
      skipCategory: category
    });
    skippedByReason[category] = (skippedByReason[category] ?? 0) + 1;
  };

  for (const paragraphId of approvedParagraphIds.slice(0, maxFitRemovals)) {
    const node = nodesById.get(paragraphId);
    if (!node) {
      skip(undefined, "The approved fit-removal paragraph could not be found.", "mapping");
      continue;
    }

    const sectionKey = getDocxPairingKey(node);
    const groupId = node.groupId || `${sectionKey}:root`;
    const nodeIndex = nodeIndexes.get(node.id) ?? -10;
    const sectionRemovalCount = removedPerSection.get(sectionKey) ?? 0;
    const remainingGroupBullets = (node.bulletCount ?? 0) - (removedGroups.has(groupId) ? 1 : 0);
    const eligibleSection =
      /\b(experience|employment|work|project|leadership|activity|activities|involvement|volunteer|organization|award)\b/i.test(
        node.sectionName || ""
      );

    if (
      !eligibleSection ||
      !node.isBullet ||
      !node.canRemove ||
      node.hasLockedDate ||
      node.hasTabStop ||
      isProtectedParagraph(node.text) ||
      getLockedMetricTokens(node.text).length > 0
    ) {
      skip(node, "This paragraph is protected from fit removal.", "protected_layout");
      continue;
    }
    if (!acceptedImprovementSections.has(sectionKey)) {
      skip(node, "Fit removal requires an accepted higher-value edit in the same section.", "group_balance");
      continue;
    }
    if ((node.bulletIndex ?? 0) === 0 || remainingGroupBullets <= 2) {
      skip(node, "The first bullet and groups with two or fewer remaining bullets are protected.", "group_balance");
      continue;
    }
    if (sectionRemovalCount >= maxFitRemovalsPerSection || removedGroups.has(groupId)) {
      skip(node, "Removal limits protect this section and content group.", "group_balance");
      continue;
    }
    if (removedIndexes.has(nodeIndex - 1) || removedIndexes.has(nodeIndex + 1)) {
      skip(node, "Adjacent bullet removals are not allowed.", "group_balance");
      continue;
    }
    if (!node.element.parentNode) {
      skip(node, "The bullet could not be removed without changing its container.", "protected_layout");
      continue;
    }

    node.element.parentNode.removeChild(node.element);
    removedParagraphIds.push(node.id);
    removedPerSection.set(sectionKey, sectionRemovalCount + 1);
    removedGroups.add(groupId);
    removedIndexes.add(nodeIndex);
  }

  return {
    removedParagraphIds,
    skippedChanges,
    skippedByReason
  };
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
    selectedCandidateCount: 0,
    shortenedForFit: 0,
    removedForFit: 0,
    rejectedForFit: 0,
    removedParagraphIds: [],
    skippedByReason: {},
    validationStatus: "not_generated",
    fontScale: 1
  };
}

function mergeCountRecords(
  ...records: Array<Record<string, number> | undefined>
) {
  const merged: Record<string, number> = {};
  records.forEach((record) => {
    Object.entries(record ?? {}).forEach(([key, value]) => {
      merged[key] = (merged[key] ?? 0) + value;
    });
  });
  return merged;
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
  if (skipCategory === "replacement_did_not_fit") {
    stats.rejectedForFit = (stats.rejectedForFit ?? 0) + 1;
  }
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
  operation: NormalizedOperation
): FittedReplacement {
  const candidates = [
    operation.replacement,
    ...(operation.replacementCandidates ?? [])
  ].map((candidate) =>
    buildReplacementText(target, {
      ...operation,
      replacement: candidate,
      replacementCandidates: undefined
    })
  );
  const selection = selectCompleteReplacementCandidate({
    replacement: candidates[0] ?? "",
    replacementCandidates: candidates.slice(1),
    transform: (candidate) => {
      let safeReplacement = cleanDocxReplacementText(candidate);
      if (target.role === "date_locked_header") {
        safeReplacement = safeReplacement.replace(/\t.*/, "").trim();
        if (target.rightText) {
          safeReplacement = safeReplacement
            .replace(new RegExp(`${escapeRegExp(target.rightText)}\\s*$`, "i"), "")
            .trim();
        }
      }
      return safeReplacement;
    },
    accept: (candidate) => preservesLockedMetrics(target.editableText, candidate)
  });

  if (!selection) {
    const hadCompleteButProtectedCandidate = candidates.some((candidate) => {
      const cleaned = cleanDocxReplacementText(candidate);
      return (
        Boolean(cleaned) &&
        !preservesLockedMetrics(target.editableText, cleaned)
      );
    });
    return {
      text: "",
      shortened: false,
      candidateIndex: -1,
      failureCategory: hadCompleteButProtectedCandidate
        ? "protected_content"
        : "replacement_did_not_fit"
    };
  }

  return {
    text: selection.text,
    shortened: selection.usedAlternative,
    candidateIndex: selection.candidateIndex
  };
}

function convertDocxRemovalToReplacement(target: ParagraphNodeInfo, operation: NormalizedOperation) {
  const current = (target.editableText || target.leftText || target.text).trim();
  const replacement = cleanDocxReplacementText(operation.replacement);
  if (!target.canEdit || !current || !replacement) return null;

  const fitted = fitReplacementToParagraphBudget(target, {
    ...operation,
    replacement: protectLayoutText(target, replacement),
    replacementCandidates: operation.replacementCandidates?.map((candidate) =>
      protectLayoutText(target, candidate)
    )
  });
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

  const distributed = distributeReplacementAcrossTextElements(editableTextElements, finalReplacement);
  editableTextElements.forEach((info, index) => {
    const nextText = distributed[index] ?? "";
    setTextElementContent(info.element, nextText);
    info.text = nextText;
  });
}

function distributeReplacementAcrossTextElements(editableTextElements: TextElementInfo[], replacement: string) {
  if (editableTextElements.length <= 1) return [replacement];

  const originalText = editableTextElements.map((item) => item.text).join("");
  const originalWords = getIndexedWords(originalText);
  const replacementWords = getIndexedWords(replacement);
  if (!replacementWords.length) return editableTextElements.map(() => "");

  const elementRanges: Array<{ start: number; end: number }> = [];
  let elementOffset = 0;
  editableTextElements.forEach((item) => {
    elementRanges.push({
      start: elementOffset,
      end: elementOffset + item.text.length
    });
    elementOffset += item.text.length;
  });

  const originalElementIndexes = originalWords.map((word) => {
    const center = word.start + Math.max(0, Math.floor((word.end - word.start) / 2));
    const index = elementRanges.findIndex((range) => center >= range.start && center < range.end);
    return index >= 0 ? index : Math.max(0, editableTextElements.length - 1);
  });
  const matches = getWordLcsMatches(originalWords, replacementWords);
  const matchedReplacementIndexes = new Map(matches.map((match) => [match.replacementIndex, originalElementIndexes[match.originalIndex] ?? 0]));
  const assignedIndexes: number[] = [];

  replacementWords.forEach((_word, replacementIndex) => {
    const matchedIndex = matchedReplacementIndexes.get(replacementIndex);
    if (typeof matchedIndex === "number") {
      assignedIndexes.push(matchedIndex);
      return;
    }

    const previousMatch = findNearestMatchedIndex(matchedReplacementIndexes, replacementIndex, -1);
    const nextMatch = findNearestMatchedIndex(matchedReplacementIndexes, replacementIndex, 1);
    let selectedIndex: number;

    if (previousMatch && nextMatch) {
      const previousDistance = replacementIndex - previousMatch.replacementIndex;
      const nextDistance = nextMatch.replacementIndex - replacementIndex;
      selectedIndex = previousDistance < nextDistance ? previousMatch.elementIndex : nextMatch.elementIndex;
    } else if (previousMatch) {
      selectedIndex = previousMatch.elementIndex;
    } else if (nextMatch) {
      selectedIndex = nextMatch.elementIndex;
    } else {
      const proportionalIndex = Math.floor(
        (replacementIndex / Math.max(1, replacementWords.length - 1)) * Math.max(0, originalElementIndexes.length - 1)
      );
      selectedIndex = originalElementIndexes[proportionalIndex] ?? 0;
    }

    assignedIndexes.push(selectedIndex);
  });

  for (let index = 1; index < assignedIndexes.length; index += 1) {
    assignedIndexes[index] = Math.max(assignedIndexes[index - 1] ?? 0, assignedIndexes[index] ?? 0);
  }

  const output = editableTextElements.map(() => "");
  replacementWords.forEach((word, index) => {
    const elementIndex = Math.min(editableTextElements.length - 1, assignedIndexes[index] ?? 0);
    if (index === 0) {
      output[elementIndex] += `${replacement.slice(0, word.start)}${word.text}`;
      return;
    }

    const previousWord = replacementWords[index - 1];
    const previousElementIndex = Math.min(
      editableTextElements.length - 1,
      assignedIndexes[index - 1] ?? elementIndex
    );
    output[previousElementIndex] += replacement.slice(previousWord?.end ?? word.start, word.start);
    output[elementIndex] += word.text;
  });
  const lastWord = replacementWords[replacementWords.length - 1];
  const lastElementIndex = Math.min(
    editableTextElements.length - 1,
    assignedIndexes[assignedIndexes.length - 1] ?? 0
  );
  output[lastElementIndex] += replacement.slice(lastWord?.end ?? replacement.length);
  return output;
}

function getIndexedWords(value: string) {
  const words: Array<{ text: string; normalized: string; start: number; end: number }> = [];
  const expression = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(value))) {
    const text = match[0];
    words.push({
      text,
      normalized: normalizeForMatch(text),
      start: match.index,
      end: match.index + text.length
    });
  }

  return words;
}

function getWordLcsMatches(
  originalWords: Array<{ normalized: string }>,
  replacementWords: Array<{ normalized: string }>
) {
  const rows = originalWords.length + 1;
  const columns = replacementWords.length + 1;
  const matrix = Array.from({ length: rows }, () => new Uint16Array(columns));

  for (let originalIndex = 1; originalIndex < rows; originalIndex += 1) {
    for (let replacementIndex = 1; replacementIndex < columns; replacementIndex += 1) {
      matrix[originalIndex][replacementIndex] =
        originalWords[originalIndex - 1]?.normalized === replacementWords[replacementIndex - 1]?.normalized
          ? (matrix[originalIndex - 1]?.[replacementIndex - 1] ?? 0) + 1
          : Math.max(
              matrix[originalIndex - 1]?.[replacementIndex] ?? 0,
              matrix[originalIndex]?.[replacementIndex - 1] ?? 0
            );
    }
  }

  const matches: Array<{ originalIndex: number; replacementIndex: number }> = [];
  let originalIndex = originalWords.length;
  let replacementIndex = replacementWords.length;

  while (originalIndex > 0 && replacementIndex > 0) {
    if (originalWords[originalIndex - 1]?.normalized === replacementWords[replacementIndex - 1]?.normalized) {
      matches.push({
        originalIndex: originalIndex - 1,
        replacementIndex: replacementIndex - 1
      });
      originalIndex -= 1;
      replacementIndex -= 1;
    } else if (
      (matrix[originalIndex - 1]?.[replacementIndex] ?? 0) >=
      (matrix[originalIndex]?.[replacementIndex - 1] ?? 0)
    ) {
      originalIndex -= 1;
    } else {
      replacementIndex -= 1;
    }
  }

  return matches.reverse();
}

function findNearestMatchedIndex(
  matchedIndexes: Map<number, number>,
  startIndex: number,
  direction: -1 | 1
) {
  const lastMatchedIndex = Math.max(-1, ...matchedIndexes.keys());
  let index = startIndex + direction;
  while (index >= 0 && (direction === -1 || index <= lastMatchedIndex)) {
    const elementIndex = matchedIndexes.get(index);
    if (typeof elementIndex === "number") return { replacementIndex: index, elementIndex };
    index += direction;
  }
  return null;
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

function validateLayoutPreservation(
  original: LayoutSnapshot,
  edited: LayoutSnapshot,
  approvedRemovalCount = 0
) {
  if (edited.paragraphCount !== original.paragraphCount - approvedRemovalCount) {
    throw new Error("Generated DOCX changed the paragraph count outside approved fit removals.");
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

export async function validateExactDocxPackageFidelity(
  originalDocx: Buffer | ArrayBuffer | Uint8Array,
  editedDocx: Buffer | ArrayBuffer | Uint8Array,
  options?: {
    removedParagraphIds?: string[];
    bodyFontScale?: number;
    scaledParagraphIds?: string[];
  }
) {
  const [originalZip, editedZip] = await Promise.all([JSZip.loadAsync(originalDocx), JSZip.loadAsync(editedDocx)]);
  const originalFiles = Object.values(originalZip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  const editedFiles = Object.values(editedZip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();

  if (originalFiles.join("\n") !== editedFiles.join("\n")) {
    throw new Error("Generated DOCX changed the document package structure.");
  }

  for (const fileName of originalFiles) {
    if (fileName === "word/document.xml") continue;
    const originalFile = originalZip.file(fileName);
    const editedFile = editedZip.file(fileName);
    if (!originalFile || !editedFile) throw new Error("Generated DOCX is missing an original document part.");
    const [originalBytes, editedBytes] = await Promise.all([
      originalFile.async("uint8array"),
      editedFile.async("uint8array")
    ]);
    if (!equalBytes(originalBytes, editedBytes)) {
      throw new Error(`Generated DOCX changed protected document part ${fileName}.`);
    }
  }

  const originalDocumentFile = originalZip.file("word/document.xml");
  const editedDocumentFile = editedZip.file("word/document.xml");
  if (!originalDocumentFile || !editedDocumentFile) {
    throw new Error("DOCX is missing word/document.xml.");
  }
  const [originalXml, editedXml] = await Promise.all([
    originalDocumentFile.async("string"),
    editedDocumentFile.async("string")
  ]);
  const originalDocument = parseXml(originalXml, "original word/document.xml");
  const editedDocument = parseXml(editedXml, "edited word/document.xml");
  const bodyFontScale = Math.max(
    0.94,
    Math.min(1, options?.bodyFontScale ?? 1)
  );
  const allowBodyFontScaling = bodyFontScale < 0.999;
  if (allowBodyFontScaling) {
    const stylesFile = originalZip.file("word/styles.xml");
    const stylesDocument = stylesFile
      ? parseXml(await stylesFile.async("string"), "word/styles.xml")
      : null;
    validateApprovedBodyFontScaling(originalDocument, editedDocument, {
      removedParagraphIds: options?.removedParagraphIds ?? [],
      scaledParagraphIds: options?.scaledParagraphIds ?? [],
      bodyFontScale,
      defaultFontSizePt: stylesDocument
        ? extractDocxDefaultFontSize(stylesDocument) ?? 10
        : 10
    });
  }
  validateDocumentStructureSignature(
    createDocumentStructureSignature(
      originalDocument,
      options?.removedParagraphIds ?? [],
      allowBodyFontScaling
    ),
    editedDocument,
    allowBodyFontScaling
  );

  return {
    packagePartsChecked: originalFiles.length,
    textNodeCount: getElementsByLocalName(editedDocument, "t").length,
    removedParagraphsVerified: options?.removedParagraphIds?.length ?? 0,
    scaledParagraphsVerified: options?.scaledParagraphIds?.length ?? 0,
    bodyFontScale
  };
}

function createDocumentStructureSignature(
  document: Document,
  removedParagraphIds: string[] = [],
  ignoreRunFontSizes = false
) {
  const clone = document.cloneNode(true) as Document;
  const removedIndexes = new Set(
    removedParagraphIds
      .map((id) => Number(id.replace(/^p/, "")) - 1)
      .filter((index) => Number.isInteger(index) && index >= 0)
  );
  if (removedIndexes.size) {
    getElementsByLocalName(clone, "p").forEach((paragraph, index) => {
      if (removedIndexes.has(index)) paragraph.parentNode?.removeChild(paragraph);
    });
  }
  if (ignoreRunFontSizes) {
    removeRunFontSizes(clone);
  }
  getElementsByLocalName(clone, "t").forEach((element) => {
    while (element.firstChild) element.removeChild(element.firstChild);
  });
  return serializeXml(clone);
}

function validateDocumentStructureSignature(
  originalSignature: string,
  editedDocument: Document,
  ignoreRunFontSizes = false
) {
  const editedSignature = createDocumentStructureSignature(
    editedDocument,
    [],
    ignoreRunFontSizes
  );
  if (editedSignature !== originalSignature) {
    throw new Error("Generated DOCX changed formatting, runs, tabs, or paragraph structure outside approved text.");
  }
}

function removeRunFontSizes(document: Document) {
  for (const localName of ["sz", "szCs"]) {
    getElementsByLocalName(document, localName).forEach((element) => {
      if (getLocalName(element.parentNode as Element) === "rPr") {
        element.parentNode?.removeChild(element);
      }
    });
  }
  getElementsByLocalName(document, "rPr").forEach((properties) => {
    const hasElementChildren = Array.from(properties.childNodes).some(
      (child) => child.nodeType === 1
    );
    if (!hasElementChildren && !(properties.textContent ?? "").trim()) {
      properties.parentNode?.removeChild(properties);
    }
  });
}

function validateApprovedBodyFontScaling(
  originalDocument: Document,
  editedDocument: Document,
  options: {
    removedParagraphIds: string[];
    scaledParagraphIds: string[];
    bodyFontScale: number;
    defaultFontSizePt: number;
  }
) {
  const removedIndexes = new Set(
    options.removedParagraphIds
      .map((id) => Number(id.replace(/^p/, "")) - 1)
      .filter((index) => Number.isInteger(index) && index >= 0)
  );
  const scaledIds = new Set(options.scaledParagraphIds);
  const originalParagraphs = getElementsByLocalName(originalDocument, "p");
  const editedParagraphs = getElementsByLocalName(editedDocument, "p");
  const originalNodes = buildParagraphNodes(originalDocument);
  const surviving = originalParagraphs
    .map((paragraph, index) => ({ paragraph, index, node: originalNodes[index] }))
    .filter(({ index }) => !removedIndexes.has(index));

  if (surviving.length !== editedParagraphs.length) {
    throw new Error("Generated DOCX changed paragraph structure while scaling body text.");
  }

  surviving.forEach(({ paragraph, index, node }, editedIndex) => {
    const editedParagraph = editedParagraphs[editedIndex];
    if (!editedParagraph || !node) {
      throw new Error("Generated DOCX could not verify body font scaling.");
    }
    const paragraphId = node.id;
    const originalRuns = getElementsByLocalName(paragraph, "r");
    const editedRuns = getElementsByLocalName(editedParagraph, "r");
    if (originalRuns.length !== editedRuns.length) {
      throw new Error("Generated DOCX changed run structure while scaling body text.");
    }

    if (!scaledIds.has(paragraphId)) {
      if (createRunFontSizeSignature(paragraph) !== createRunFontSizeSignature(editedParagraph)) {
        throw new Error(
          `Generated DOCX changed protected typography in ${paragraphId}; approved scaled paragraphs: ${[
            ...scaledIds
          ].join(", ") || "none"}.`
        );
      }
      return;
    }
    if (!isBodyFontScaleEligible(node)) {
      throw new Error(`Generated DOCX attempted to scale protected paragraph ${paragraphId}.`);
    }

    originalRuns.forEach((originalRun, runIndex) => {
      const editedRun = editedRuns[runIndex];
      if (!editedRun) {
        throw new Error(`Generated DOCX changed run structure in ${paragraphId}.`);
      }
      const text = getElementsByLocalName(originalRun, "t")
        .map((element) => element.textContent ?? "")
        .join("");
      if (!text.trim()) {
        if (createRunFontSizeSignature(originalRun) !== createRunFontSizeSignature(editedRun)) {
          throw new Error(`Generated DOCX scaled a non-text run in ${paragraphId}.`);
        }
        return;
      }

      const originalProperties = getElementsByLocalName(originalRun, "rPr")[0];
      const originalSize = originalProperties
        ? getElementsByLocalName(originalProperties, "sz")[0]
        : undefined;
      const explicitHalfPoints = originalSize
        ? Number(getWordAttribute(originalSize, "val"))
        : Number.NaN;
      const originalPt =
        Number.isFinite(explicitHalfPoints) && explicitHalfPoints > 0
          ? explicitHalfPoints / 2
          : node.format?.fontSizePt ?? options.defaultFontSizePt;
      const expectedHalfPoints = Math.max(
        18,
        Math.round(originalPt * options.bodyFontScale * 2)
      );
      const originalHalfPoints = Math.round(originalPt * 2);

      if (expectedHalfPoints >= originalHalfPoints) {
        if (createRunFontSizeSignature(originalRun) !== createRunFontSizeSignature(editedRun)) {
          throw new Error(`Generated DOCX changed typography below the 9pt floor in ${paragraphId}.`);
        }
        return;
      }

      const editedProperties = getElementsByLocalName(editedRun, "rPr")[0];
      const editedSize = editedProperties
        ? getElementsByLocalName(editedProperties, "sz")[0]
        : undefined;
      const editedComplexSize = editedProperties
        ? getElementsByLocalName(editedProperties, "szCs")[0]
        : undefined;
      if (
        Number(getWordAttribute(editedSize, "val")) !== expectedHalfPoints ||
        Number(getWordAttribute(editedComplexSize, "val")) !== expectedHalfPoints
      ) {
        throw new Error(`Generated DOCX applied an unapproved font size in ${paragraphId}.`);
      }
    });
  });

  const actualScaledIds = new Set(
    surviving
      .filter(({ paragraph }, editedIndex) => {
        const editedParagraph = editedParagraphs[editedIndex];
        return (
          Boolean(editedParagraph) &&
          createRunFontSizeSignature(paragraph) !==
            createRunFontSizeSignature(editedParagraph!)
        );
      })
      .map(({ node, index }) => node?.id ?? `p${String(index + 1).padStart(3, "0")}`)
  );
  if (
    actualScaledIds.size !== scaledIds.size ||
    [...actualScaledIds].some((id) => !scaledIds.has(id))
  ) {
    throw new Error("Generated DOCX font scaling did not match the approved paragraph set.");
  }
}

function createRunFontSizeSignature(element: Element) {
  return getElementsByLocalName(element, "r").map((run) => {
    const properties = getElementsByLocalName(run, "rPr")[0];
    if (!properties) return "-/-";
    const size = getElementsByLocalName(properties, "sz")[0];
    const complexSize = getElementsByLocalName(properties, "szCs")[0];
    return `${getWordAttribute(size, "val") ?? "-"}/${
      getWordAttribute(complexSize, "val") ?? "-"
    }`;
  }).join("|");
}

function equalBytes(first: Uint8Array, second: Uint8Array) {
  if (first.byteLength !== second.byteLength) return false;
  for (let index = 0; index < first.byteLength; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
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

function extractDocxPageGeometry(document: Document): NonNullable<ResumeLayoutMap["page"]> {
  const sectionProperties = getElementsByLocalName(document, "sectPr");
  const section = sectionProperties[sectionProperties.length - 1];
  const pageSize = section ? getElementsByLocalName(section, "pgSz")[0] : undefined;
  const pageMargins = section ? getElementsByLocalName(section, "pgMar")[0] : undefined;
  const widthTwips = getPositiveWordNumber(pageSize, "w", 12_240);
  const heightTwips = getPositiveWordNumber(pageSize, "h", 15_840);

  return {
    widthPt: widthTwips / 20,
    heightPt: heightTwips / 20,
    marginTopPt: getPositiveWordNumber(pageMargins, "top", 720) / 20,
    marginRightPt: getPositiveWordNumber(pageMargins, "right", 720) / 20,
    marginBottomPt: getPositiveWordNumber(pageMargins, "bottom", 720) / 20,
    marginLeftPt: getPositiveWordNumber(pageMargins, "left", 720) / 20
  };
}

function extractDocxDefaultFont(stylesDocument: Document) {
  const defaults = getElementsByLocalName(stylesDocument, "docDefaults")[0];
  const fonts = defaults ? getElementsByLocalName(defaults, "rFonts")[0] : undefined;
  const value = fonts
    ? getWordAttribute(fonts, "ascii") ?? getWordAttribute(fonts, "hAnsi") ?? getWordAttribute(fonts, "cs")
    : undefined;
  const cleaned = value?.replace(/[^\p{L}\p{N} ._-]+/gu, "").trim();
  return cleaned ? cleaned.slice(0, 80) : undefined;
}

function extractDocxDefaultFontSize(stylesDocument: Document) {
  const defaults = getElementsByLocalName(stylesDocument, "docDefaults")[0];
  const size = defaults ? getElementsByLocalName(defaults, "sz")[0] : undefined;
  const halfPoints = size ? Number(getWordAttribute(size, "val")) : Number.NaN;
  return Number.isFinite(halfPoints) && halfPoints > 0 ? halfPoints / 2 : undefined;
}

function extractDocxParagraphFormat(paragraph: Element): ResumeLayoutMapParagraph["format"] {
  const paragraphProperties = getElementsByLocalName(paragraph, "pPr")[0];
  const alignmentElement = paragraphProperties ? getElementsByLocalName(paragraphProperties, "jc")[0] : undefined;
  const spacingElement = paragraphProperties ? getElementsByLocalName(paragraphProperties, "spacing")[0] : undefined;
  const indentElement = paragraphProperties ? getElementsByLocalName(paragraphProperties, "ind")[0] : undefined;
  const run = getElementsByLocalName(paragraph, "r").find((candidate) =>
    getElementsByLocalName(candidate, "t").some((textElement) => Boolean(textElement.textContent?.trim()))
  );
  const runProperties = run ? getElementsByLocalName(run, "rPr")[0] : undefined;
  const fontElement = runProperties ? getElementsByLocalName(runProperties, "rFonts")[0] : undefined;
  const sizeElement = runProperties ? getElementsByLocalName(runProperties, "sz")[0] : undefined;
  const boldElement = runProperties ? getElementsByLocalName(runProperties, "b")[0] : undefined;
  const italicElement = runProperties ? getElementsByLocalName(runProperties, "i")[0] : undefined;
  const alignment = normalizeDocxAlignment(alignmentElement ? getWordAttribute(alignmentElement, "val") : undefined);
  const lineRule = spacingElement ? getWordAttribute(spacingElement, "lineRule") : undefined;
  const lineValue = spacingElement ? Number(getWordAttribute(spacingElement, "line")) : Number.NaN;
  const fontFamily = fontElement
    ? (getWordAttribute(fontElement, "ascii") ?? getWordAttribute(fontElement, "hAnsi"))
        ?.replace(/[^\p{L}\p{N} ._-]+/gu, "")
        .trim()
        .slice(0, 80)
    : undefined;
  const halfPoints = sizeElement ? Number(getWordAttribute(sizeElement, "val")) : Number.NaN;

  return {
    alignment,
    spacingBeforePt: getOptionalTwipPoints(spacingElement, "before"),
    spacingAfterPt: getOptionalTwipPoints(spacingElement, "after"),
    lineSpacing:
      Number.isFinite(lineValue) && lineValue > 0
        ? lineRule === "auto" || !lineRule
          ? Math.max(0.7, Math.min(3, lineValue / 240))
          : Math.max(0.7, Math.min(3, lineValue / 20 / 12))
        : undefined,
    leftIndentPt: getOptionalTwipPoints(indentElement, "left"),
    rightIndentPt: getOptionalTwipPoints(indentElement, "right"),
    firstLineIndentPt: getOptionalTwipPoints(indentElement, "firstLine"),
    hangingIndentPt: getOptionalTwipPoints(indentElement, "hanging"),
    fontFamily: fontFamily || undefined,
    fontSizePt: Number.isFinite(halfPoints) && halfPoints > 0 ? halfPoints / 2 : undefined,
    bold: readDocxBoolean(boldElement),
    italic: readDocxBoolean(italicElement)
  };
}

function normalizeDocxAlignment(
  value?: string | null
): NonNullable<ResumeLayoutMapParagraph["format"]>["alignment"] {
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "both" || value === "distribute" || value === "thaiDistribute") return "justify";
  if (value === "left" || value === "start") return "left";
  return undefined;
}

function getOptionalTwipPoints(element: Element | undefined, name: string) {
  const value = element ? Number(getWordAttribute(element, name)) : Number.NaN;
  return Number.isFinite(value) ? Math.max(-360, Math.min(720, value / 20)) : undefined;
}

function readDocxBoolean(element: Element | undefined) {
  if (!element) return undefined;
  const value = getWordAttribute(element, "val");
  return value === "0" || value === "false" || value === "off" ? false : true;
}

function getPositiveWordNumber(element: Element | undefined, name: string, fallback: number) {
  const value = element ? Number(getWordAttribute(element, name)) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

function getLocalName(element: Element | Node | null | undefined) {
  if (!element) return "";
  return element.localName || element.nodeName.split(":").pop() || element.nodeName;
}

function getWordAttribute(element: Element | null | undefined, name: string) {
  if (!element) return null;
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

function preservesLockedMetrics(original: string, replacement: string) {
  const originalMetrics = getLockedMetricTokens(original);
  const replacementMetrics = getLockedMetricTokens(replacement);
  return (
    originalMetrics.every((metric) => replacementMetrics.includes(metric)) &&
    replacementMetrics.every((metric) => originalMetrics.includes(metric))
  );
}

function getLockedMetricTokens(value: string) {
  const matches =
    value.match(
      /(?:[$€£]\s?\d[\d,.]*(?:\s?[kmb])?|\b~?\d+(?:\.\d+)?%|\b~?\d+\+|\b\d+(?:\.\d+)?\s?(?:hours?|minutes?|days?|weeks?|months?|years?|users?|sessions?|pages?|records?|clients?|teams?|companies?|roles?|projects?)\b|\b\d+\s*(?:-|–|—|to)\s*\d+\b)/gi
    ) ?? [];
  return [...new Set(matches.map((match) => match.toLowerCase().replace(/\s+/g, " ").trim()))].sort();
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
