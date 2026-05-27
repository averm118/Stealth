import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document as XmldomDocument, Element as XmldomElement, Node as XmldomNode } from "@xmldom/xmldom";
import JSZip from "jszip";
import type {
  ResumeBulletRewrite,
  ResumeDocxEditStats,
  ResumeDocxParagraphRole,
  ResumeEditOperation,
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

type NormalizedDocxInput = {
  operations: NormalizedOperation[];
  layoutAdjustment: ResumeLayoutAdjustment;
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
  const zip = await JSZip.loadAsync(originalDocx);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX is missing word/document.xml.");

  const tailoringInput = normalizeDocxInput(input);
  const document = parseXml(await documentFile.async("string"), "word/document.xml");
  const nodes = buildParagraphNodes(document);
  const operationResult = applyDocxParagraphEdits(document, nodes, tailoringInput.operations);

  normalizeBlankSpacing(document);
  scaleFontSizesInDocument(document, tailoringInput.layoutAdjustment.fontScale);
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
        const hasMappedTarget = Boolean(operation.paragraphId || operation.insertAfterParagraphId);
        const hasFallbackText = operation.normalizedOriginal.length > 8;
        const allowsEmptyReplacement = operation.type === "remove_low_priority_paragraph";
        return (hasMappedTarget || hasFallbackText) && (allowsEmptyReplacement || operation.replacement.length > 0);
      })
      .slice(0, 28),
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

function buildParagraphNodes(document: Document): ParagraphNodeInfo[] {
  const paragraphs = getElementsByLocalName(document, "p");
  let currentSection = "";

  return paragraphs.map((paragraph, index) => {
    const textElements = getTextElementInfos(paragraph);
    const text = textElements.map((item) => item.text).join("");
    const role = classifyParagraph(paragraph, text, textElements, currentSection);

    if (role === "section_heading") {
      currentSection = normalizeSectionName(text);
    }

    const editableTextElements = getEditableTextElements(role, textElements);
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
      hasLockedDate: Boolean(lockedText && dateLikePattern.test(lockedText)),
      isBullet,
      canEdit: canEditRole(role, editableTextElements),
      canInsertAfter: role === "bullet" || role === "role_header" || role === "body" || role === "activity_line",
      canRemove: role === "bullet" || role === "activity_line" || role === "body",
      element: paragraph,
      textElements,
      editableTextElements,
      normalizedText
    } satisfies ParagraphNodeInfo;
  });
}

function toLayoutParagraph(node: ParagraphNodeInfo): ResumeLayoutMapParagraph {
  return {
    id: node.id,
    role: node.role,
    sectionName: node.sectionName,
    text: node.text,
    editableText: node.editableText,
    lockedText: node.lockedText,
    hasLockedDate: node.hasLockedDate,
    isBullet: node.isBullet,
    canEdit: node.canEdit,
    canInsertAfter: node.canInsertAfter,
    canRemove: node.canRemove
  };
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
  if (hasRightAlignedDate(textElements)) return "role_header";
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

function getEditableTextElements(role: ResumeDocxParagraphRole, textElements: TextElementInfo[]) {
  if (role === "contact_header" || role === "section_heading" || role === "divider" || role === "blank") {
    return [];
  }
  return textElements.filter((item) => !item.protected);
}

function canEditRole(role: ResumeDocxParagraphRole, editableTextElements: TextElementInfo[]) {
  if (!editableTextElements.length) return false;
  return role !== "contact_header" && role !== "section_heading" && role !== "divider" && role !== "blank";
}

function applyDocxParagraphEdits(document: Document, nodes: ParagraphNodeInfo[], operations: NormalizedOperation[]) {
  const stats = {
    appliedEdits: 0,
    insertedBullets: 0,
    removedLines: 0
  };
  const skippedChanges: ResumeSkippedChange[] = [];
  if (!operations.length) return { stats, skippedChanges };

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const usedFallbackNodeIds = new Set<string>();

  operations.forEach((operation) => {
    const target = resolveOperationTarget(operation, nodes, nodeById, usedFallbackNodeIds);
    if (!target) {
      skippedChanges.push({ ...operation, skipReason: "Could not map this edit to a safe DOCX paragraph." });
      return;
    }

    if (operation.type === "insert_bullet_after") {
      const inserted = insertBulletAfter(target, operation.replacement, nodes);
      if (!inserted) {
        skippedChanges.push({ ...operation, skipReason: "Could not find a nearby bullet style to clone." });
        return;
      }
      stats.insertedBullets += 1;
      return;
    }

    if (operation.type === "remove_low_priority_paragraph") {
      if (!target.canRemove || isProtectedParagraph(target.text)) {
        skippedChanges.push({ ...operation, skipReason: "This paragraph is protected from removal." });
        return;
      }
      target.element.parentNode?.removeChild(target.element);
      stats.removedLines += 1;
      return;
    }

    if (!target.canEdit) {
      skippedChanges.push({ ...operation, skipReason: "This paragraph is protected from editing." });
      return;
    }

    const replacement = buildReplacementText(target, operation);
    if (!replacement) {
      skippedChanges.push({ ...operation, skipReason: "The replacement text was empty after layout protection." });
      return;
    }

    if (!replaceParagraphEditableText(target, replacement)) {
      skippedChanges.push({ ...operation, skipReason: "The edit could not be applied without touching protected text." });
      return;
    }

    stats.appliedEdits += 1;
  });

  return { stats, skippedChanges };
}

function resolveOperationTarget(
  operation: NormalizedOperation,
  nodes: ParagraphNodeInfo[],
  nodeById: Map<string, ParagraphNodeInfo>,
  usedFallbackNodeIds: Set<string>
): ParagraphNodeInfo | null {
  const mappedId = operation.type === "insert_bullet_after" ? operation.insertAfterParagraphId || operation.paragraphId : operation.paragraphId;
  if (mappedId && nodeById.has(mappedId)) return nodeById.get(mappedId) ?? null;

  const fallback = findBestParagraphNode(operation, nodes, usedFallbackNodeIds);
  if (fallback) usedFallbackNodeIds.add(fallback.id);
  return fallback;
}

function findBestParagraphNode(
  operation: NormalizedOperation,
  nodes: ParagraphNodeInfo[],
  usedNodeIds: Set<string>
): ParagraphNodeInfo | null {
  if (!operation.normalizedOriginal) return null;

  let bestNode: ParagraphNodeInfo | null = null;
  let bestScore = 0;
  nodes.forEach((node) => {
    if (usedNodeIds.has(node.id) || !node.canEdit) return;
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
  });

  return bestNode;
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
  return cleanDocxReplacementText(removeProtectedTextsFromReplacement(replacement, protectedTexts));
}

function replaceParagraphEditableText(paragraph: ParagraphNodeInfo, replacement: string) {
  if (!paragraph.editableTextElements.length) return false;
  applyReplacementToEditableTextElements(paragraph.editableTextElements, replacement);
  paragraph.text = getTextElementInfos(paragraph.element)
    .map((item) => item.text)
    .join("");
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
