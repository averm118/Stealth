import JSZip from "jszip";
import type { ResumeBulletRewrite, ResumeEditOperation, ResumeLayoutAdjustment } from "@/lib/types";

type TailoredDocxInput =
  | ResumeBulletRewrite[]
  | {
      editOperations?: ResumeEditOperation[];
      rewrites?: ResumeBulletRewrite[];
      layoutAdjustment?: ResumeLayoutAdjustment;
    };

type XmlTextNode = {
  start: number;
  end: number;
  text: string;
};

export async function createTailoredDocxFromOriginal(originalDocx: Buffer | ArrayBuffer | Uint8Array, input: TailoredDocxInput) {
  const zip = await JSZip.loadAsync(originalDocx);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX is missing word/document.xml.");

  const tailoringInput = normalizeDocxInput(input);
  const documentXml = await documentFile.async("string");
  const nextXml = scaleFontSizesInXml(
    applyDocxParagraphEdits(documentXml, tailoringInput.operations),
    tailoringInput.layoutAdjustment.fontScale
  );
  zip.file("word/document.xml", nextXml);

  const stylesFile = zip.file("word/styles.xml");
  if (stylesFile && tailoringInput.layoutAdjustment.fontScale < 0.995) {
    const stylesXml = await stylesFile.async("string");
    zip.file("word/styles.xml", scaleFontSizesInXml(stylesXml, tailoringInput.layoutAdjustment.fontScale));
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

export async function createTailoredDocxArrayBuffer(originalDocx: ArrayBuffer | Uint8Array, input: TailoredDocxInput) {
  const zip = await JSZip.loadAsync(originalDocx);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("DOCX is missing word/document.xml.");

  const tailoringInput = normalizeDocxInput(input);
  const documentXml = await documentFile.async("string");
  const nextXml = scaleFontSizesInXml(
    applyDocxParagraphEdits(documentXml, tailoringInput.operations),
    tailoringInput.layoutAdjustment.fontScale
  );
  zip.file("word/document.xml", nextXml);

  const stylesFile = zip.file("word/styles.xml");
  if (stylesFile && tailoringInput.layoutAdjustment.fontScale < 0.995) {
    const stylesXml = await stylesFile.async("string");
    zip.file("word/styles.xml", scaleFontSizesInXml(stylesXml, tailoringInput.layoutAdjustment.fontScale));
  }

  return zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

function normalizeDocxInput(input: TailoredDocxInput) {
  const rawOperations = Array.isArray(input)
    ? input.map((rewrite) => rewriteToOperation(rewrite))
    : input.editOperations?.length
      ? input.editOperations
      : input.rewrites?.map((rewrite) => rewriteToOperation(rewrite)) ?? [];

  return {
    operations: rawOperations
      .map((operation) => ({
        ...operation,
        original: cleanDocxReplacementText(operation.original),
        replacement: cleanDocxReplacementText(operation.replacement)
      }))
      .filter((operation) => normalizeForMatch(operation.original).length > 8 && operation.replacement.length > 0)
      .slice(0, 18),
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

function normalizeLayoutAdjustment(value?: ResumeLayoutAdjustment) {
  const fontScale = typeof value?.fontScale === "number" && Number.isFinite(value.fontScale) ? value.fontScale : 1;
  return {
    fontScale: Math.max(0.9, Math.min(1, fontScale)),
    reason: value?.reason || "No layout adjustment applied."
  };
}

function applyDocxParagraphEdits(documentXml: string, operations: ResumeEditOperation[]) {
  const safeOperations = operations
    .map((operation) => ({
      ...operation,
      normalizedOriginal: normalizeForMatch(operation.original),
      replacement: cleanDocxReplacementText(operation.replacement)
    }))
    .filter((operation) => operation.normalizedOriginal.length > 8 && operation.replacement.length > 0);

  if (!safeOperations.length) return documentXml;

  const usedOperationIndexes = new Set<number>();

  return documentXml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    const textNodes = getTextNodes(paragraphXml);
    if (!textNodes.length) return paragraphXml;

    const paragraphText = textNodes.map((node) => node.text).join("");
    const normalizedParagraph = normalizeForMatch(paragraphText);
    const editIndex = findBestOperationIndex(
      normalizedParagraph,
      safeOperations.map((operation) => ({
        normalizedOriginal: operation.normalizedOriginal,
        type: operation.type
      })),
      usedOperationIndexes
    );

    if (editIndex === -1) return paragraphXml;

    usedOperationIndexes.add(editIndex);
    return replaceParagraphText(paragraphXml, textNodes, safeOperations[editIndex].replacement);
  });
}

function findBestOperationIndex(
  normalizedParagraph: string,
  operations: Array<{ normalizedOriginal: string; type: ResumeEditOperation["type"] }>,
  usedOperationIndexes: Set<number>
) {
  let bestIndex = -1;
  let bestScore = 0;

  operations.forEach((operation, index) => {
    if (usedOperationIndexes.has(index)) return;
    const score = getMatchScore(normalizedParagraph, operation.normalizedOriginal);
    const threshold = operation.type === "append_to_line" ? 0.38 : 0.48;
    if (score >= threshold && score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestIndex;
}

function getTextNodes(paragraphXml: string): XmlTextNode[] {
  const nodes: XmlTextNode[] = [];
  const textNodePattern = /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null;

  while ((match = textNodePattern.exec(paragraphXml))) {
    const fullMatch = match[0];
    const textStart = match.index + fullMatch.indexOf(">") + 1;
    const textEnd = match.index + fullMatch.lastIndexOf("</w:t>");
    nodes.push({
      start: textStart,
      end: textEnd,
      text: unescapeXml(match[2] ?? "")
    });
  }

  return nodes;
}

function replaceParagraphText(paragraphXml: string, textNodes: XmlTextNode[], replacement: string) {
  let nextXml = paragraphXml;
  const protectedNodeIndexes = getProtectedNodeIndexes(textNodes);
  const firstReplacementNodeIndex = textNodes.findIndex((_, index) => !protectedNodeIndexes.has(index));
  const protectedTexts = textNodes.filter((_, index) => protectedNodeIndexes.has(index)).map((node) => node.text);
  const cleanedReplacement = removeProtectedTextsFromReplacement(replacement, protectedTexts);

  for (let index = textNodes.length - 1; index >= 0; index -= 1) {
    const node = textNodes[index];
    if (protectedNodeIndexes.has(index)) continue;
    const nextText = index === firstReplacementNodeIndex ? escapeXml(cleanedReplacement) : "";
    nextXml = `${nextXml.slice(0, node.start)}${nextText}${nextXml.slice(node.end)}`;
  }

  return nextXml;
}

function normalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/^[\-•*]\s*/, "")
    .replace(/[^\w+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMatchScore(normalizedParagraph: string, normalizedOriginal: string) {
  if (!normalizedParagraph || !normalizedOriginal) return 0;
  if (normalizedParagraph === normalizedOriginal) return 1;

  const containsScore = normalizedParagraph.includes(normalizedOriginal)
    ? Math.min(0.92, 0.58 + normalizedOriginal.length / Math.max(normalizedParagraph.length, 1) * 0.32)
    : 0;
  const reverseContainsScore = normalizedOriginal.includes(normalizedParagraph)
    ? Math.min(0.86, 0.52 + normalizedParagraph.length / Math.max(normalizedOriginal.length, 1) * 0.28)
    : 0;
  const tokenScore = getTokenDiceScore(normalizedParagraph, normalizedOriginal);

  return Math.max(containsScore, reverseContainsScore, tokenScore);
}

function getTokenDiceScore(first: string, second: string) {
  const firstTokens = new Set(first.split(" ").filter((token) => token.length > 2));
  const secondTokens = new Set(second.split(" ").filter((token) => token.length > 2));
  if (!firstTokens.size || !secondTokens.size) return 0;

  let intersection = 0;
  secondTokens.forEach((token) => {
    if (firstTokens.has(token)) intersection += 1;
  });

  return (2 * intersection) / (firstTokens.size + secondTokens.size);
}

function cleanDocxReplacementText(value: string) {
  return value.replace(/^\s*(?:[-*•]\s*)?/, "").replace(/\s+/g, " ").trim();
}

function getProtectedNodeIndexes(textNodes: XmlTextNode[]) {
  const protectedIndexes = new Set<number>();
  textNodes.forEach((node, index) => {
    if (isProtectedResumeText(node.text)) protectedIndexes.add(index);
  });
  return protectedIndexes;
}

function isProtectedResumeText(value: string) {
  const text = value.trim();
  if (!text) return false;
  return (
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/i.test(text) ||
    /\b\d{4}\s*[-–—]\s*(?:\d{4}|present|current)\b/i.test(text) ||
    /\bgpa\s*:?\s*\d(?:\.\d+)?\b/i.test(text)
  );
}

function removeProtectedTextsFromReplacement(replacement: string, protectedTexts: string[]) {
  return protectedTexts
    .reduce((text, protectedText) => text.replace(protectedText, "").replace(normalizeDash(protectedText), ""), replacement)
    .replace(/\s{2,}/g, " ")
    .replace(/\s+[-–—]\s*$/g, "")
    .trim();
}

function normalizeDash(value: string) {
  return value.replace(/[–—]/g, "-");
}

function scaleFontSizesInXml(xml: string, fontScale: number) {
  if (fontScale >= 0.995) return xml;
  const minimumHalfPoints = 15;

  return xml.replace(/(<w:sz(?:Cs)?\b[^>]*\bw:val=")(\d+)("[^>]*\/>)/g, (_match, prefix: string, rawValue: string, suffix: string) => {
    const current = Number(rawValue);
    if (!Number.isFinite(current) || current <= 0) return `${prefix}${rawValue}${suffix}`;
    const next = Math.max(minimumHalfPoints, Math.round(current * fontScale));
    return `${prefix}${next}${suffix}`;
  });
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
