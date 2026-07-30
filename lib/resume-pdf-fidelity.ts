import "server-only";

import type {
  ResumePdfFidelityFailureReason,
  ResumePdfFidelityReport
} from "@/lib/types";

const geometryTolerancePt = 0.25;
const anchorTolerancePt = 0.5;
const typographyTolerancePt = 0.25;
const visualDpi = 200;
const pixelDifferenceTolerance = 28;
const maxChangedPixelRatio = 0.001;

type PdfLine = {
  page: number;
  text: string;
  normalized: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type PdfLayout = {
  pages: Array<{
    width: number;
    height: number;
  }>;
  lines: PdfLine[];
};

export async function validateResumePdfFidelity(
  originalPdf: Buffer | Uint8Array,
  tailoredPdf: Buffer | Uint8Array,
  options?: {
    packageIntegrityPreserved?: boolean;
    compactMode?: boolean;
    balancedMode?: boolean;
    removedParagraphCount?: number;
    expectedReplacementTexts?: string[];
    bodyFontScale?: number;
  }
): Promise<ResumePdfFidelityReport> {
  const [original, tailored] = await Promise.all([extractPdfLayout(originalPdf), extractPdfLayout(tailoredPdf)]);
  const compactMode = options?.compactMode === true;
  const bodyFontScale = Math.max(0.94, Math.min(1, options?.bodyFontScale ?? 1));
  const fontScalingRequested = bodyFontScale < 0.999;
  const balancedMode =
    options?.balancedMode === true || compactMode || fontScalingRequested;
  const pageGeometryPreserved =
    original.pages.length === tailored.pages.length &&
    original.pages.every((page, index) => {
      const candidate = tailored.pages[index];
      return (
        Boolean(candidate) &&
        Math.abs(page.width - candidate.width) <= geometryTolerancePt &&
        Math.abs(page.height - candidate.height) <= geometryTolerancePt
      );
    });
  const protectedOriginalLines = original.lines.filter((line) => isProtectedResumeLine(line.text));
  const protectedMatches = matchStableLines(protectedOriginalLines, tailored.lines);
  const stableMatches = matchStableLines(
    original.lines.filter((line) => line.normalized.length >= 4),
    tailored.lines
  );
  const compactGeometry = balancedMode
    ? compareBalancedStableGeometry(
        stableMatches,
        original.lines,
        tailored.lines,
        Math.max(0, options?.removedParagraphCount ?? 0),
        bodyFontScale
      )
    : { preserved: true, changedRatio: 0 };
  const pixelComparison = pageGeometryPreserved
    ? balancedMode
      ? compactGeometry
      : await compareRenderedPixels(originalPdf, tailoredPdf, original, tailored, stableMatches)
    : { preserved: false, changedRatio: 1 };
  const maxAnchorDeltaPt = Math.max(
    0,
    ...stableMatches.map((match) =>
      balancedMode
        ? Math.abs(match.original.x - match.tailored.x)
        : Math.max(
            Math.abs(match.original.x - match.tailored.x),
            Math.abs(match.original.y - match.tailored.y)
          )
    )
  );
  const maxTypographyDeltaPt = Math.max(
    0,
    ...stableMatches.map((match) => Math.abs(match.original.height - match.tailored.height))
  );
  const protectedTypographyPreserved = protectedMatches.every(
    (match) =>
      Math.abs(match.original.height - match.tailored.height) <=
      typographyTolerancePt
  );
  const fontScalingVerified = fontScalingRequested
    ? protectedTypographyPreserved &&
      stableMatches.every((match) =>
        isApprovedTypographyChange(match.original.height, match.tailored.height, bodyFontScale)
      )
    : maxTypographyDeltaPt <= typographyTolerancePt;
  const protectedAnchorsComplete = protectedMatches.length === protectedOriginalLines.length;
  const dateMatches = protectedMatches.filter((match) => isDateLine(match.original.text));
  const dateAlignmentPreserved =
    dateMatches.length === protectedOriginalLines.filter((line) => isDateLine(line.text)).length &&
    dateMatches.every(
      (match) =>
        Math.abs(match.original.x - match.tailored.x) <= anchorTolerancePt &&
        (balancedMode || Math.abs(match.original.y - match.tailored.y) <= anchorTolerancePt)
    );
  const paragraphStructurePreserved = balancedMode
    ? compactGeometry.preserved
    : original.lines.length === tailored.lines.length &&
      stableMatches.every(
        (match) =>
          Math.abs(match.original.x - match.tailored.x) <= anchorTolerancePt &&
          Math.abs(match.original.y - match.tailored.y) <= anchorTolerancePt
      );
  const typographyPreserved = fontScalingVerified;
  const packageIntegrityPreserved = options?.packageIntegrityPreserved !== false;
  const fullTextCoveragePreserved = hasExpectedTextCoverage(
    tailored,
    options?.expectedReplacementTexts ?? []
  );
  const warnings: string[] = [];

  if (!pageGeometryPreserved) warnings.push("Page count or page dimensions changed.");
  if (!protectedAnchorsComplete) warnings.push("A protected heading, contact row, or date could not be matched.");
  if (!dateAlignmentPreserved) warnings.push("One or more date anchors moved.");
  if (!paragraphStructurePreserved) warnings.push("Rendered line count or downstream alignment changed.");
  if (!typographyPreserved) {
    warnings.push(
      fontScalingRequested
        ? "Rendered font metrics changed outside the approved body-text scale."
        : "Rendered font metrics changed."
    );
  }
  if (!packageIntegrityPreserved) warnings.push("The DOCX package changed outside approved text nodes.");
  if (!fullTextCoveragePreserved) warnings.push("One or more applied rewrites were missing or incomplete in the rendered PDF.");
  if (!pixelComparison.preserved) {
    warnings.push("Pixels outside the approved editable text regions changed beyond tolerance.");
  }
  if (stableMatches.length < Math.min(4, original.lines.length)) {
    warnings.push("There were not enough stable text anchors to verify the document.");
  }

  const failureReasons: ResumePdfFidelityFailureReason[] = [];
  if (!pageGeometryPreserved) failureReasons.push("page_overflow");
  if (!protectedAnchorsComplete || !dateAlignmentPreserved) {
    failureReasons.push("protected_anchor_moved");
  }
  if (!paragraphStructurePreserved) failureReasons.push("line_growth");
  if (!typographyPreserved) failureReasons.push("typography_drift");
  if (!fullTextCoveragePreserved) failureReasons.push("incomplete_text");
  if (!packageIntegrityPreserved) failureReasons.push("package_drift");
  if (!pixelComparison.preserved) failureReasons.push("pixel_drift");
  if (stableMatches.length < Math.min(4, original.lines.length)) {
    failureReasons.push("insufficient_anchors");
  }

  const status =
    warnings.length === 0 &&
    pageGeometryPreserved &&
    dateAlignmentPreserved &&
    typographyPreserved &&
    paragraphStructurePreserved &&
    fullTextCoveragePreserved &&
    packageIntegrityPreserved &&
    pixelComparison.preserved
      ? "verified"
      : "failed";

  return {
    status,
    renderer: "microsoft_graph_word",
    pageCount: tailored.pages.length,
    pageGeometryPreserved,
    protectedAnchorsChecked: protectedMatches.length,
    stableAnchorsChecked: stableMatches.length,
    maxAnchorDeltaPt: round(maxAnchorDeltaPt, 3),
    packageIntegrityPreserved,
    typographyPreserved,
    dateAlignmentPreserved,
    paragraphStructurePreserved,
    fullTextCoveragePreserved,
    pixelFidelityPreserved: pixelComparison.preserved,
    changedPixelsOutsideMasksRatio: round(pixelComparison.changedRatio, 6),
    compactMode,
    removedParagraphsVerified: compactMode ? Math.max(0, options?.removedParagraphCount ?? 0) : 0,
    fontScaleApplied: bodyFontScale,
    fontScalingVerified,
    failureReasons: [...new Set(failureReasons)],
    warnings
  };
}

export async function inspectResumePdf(pdf: Buffer | Uint8Array) {
  const layout = await extractPdfLayout(pdf);
  return {
    pageCount: layout.pages.length,
    pages: layout.pages,
    lineCount: layout.lines.length,
    text: layout.lines.map((line) => line.text).join("\n")
  };
}

async function extractPdfLayout(pdf: Buffer | Uint8Array): Promise<PdfLayout> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false
  });
  const document = await loadingTask.promise;
  const pages: PdfLayout["pages"] = [];
  const lines: PdfLine[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ width: viewport.width, height: viewport.height });
      const content = await page.getTextContent({ disableNormalization: false });
      const items = content.items
        .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => {
          return "str" in item && typeof item.str === "string" && item.str.trim().length > 0 && Array.isArray(item.transform);
        })
        .map((item) => ({
          text: item.str,
          x: Number(item.transform[4] ?? 0),
          y: Number(item.transform[5] ?? 0),
          width: Number(item.width ?? 0),
          height: Math.abs(Number(item.height || item.transform[3] || 0))
        }))
        .sort((first, second) => {
          const yDifference = second.y - first.y;
          return Math.abs(yDifference) > 0.65 ? yDifference : first.x - second.x;
        });
      const pageLines: Array<{ y: number; items: typeof items }> = [];

      items.forEach((item) => {
        const line = pageLines.find((candidate) => Math.abs(candidate.y - item.y) <= 0.65);
        if (line) {
          line.items.push(item);
        } else {
          pageLines.push({ y: item.y, items: [item] });
        }
      });

      pageLines.forEach((line) => {
        line.items.sort((first, second) => first.x - second.x);
        let text = "";
        let previousEnd = 0;
        line.items.forEach((item, index) => {
          const gap = item.x - previousEnd;
          const needsSpace = index > 0 && gap > Math.max(0.8, item.height * 0.12) && !text.endsWith(" ");
          text += `${needsSpace ? " " : ""}${item.text}`;
          previousEnd = item.x + item.width;
        });
        const cleaned = text.replace(/\s+/g, " ").trim();
        if (!cleaned) return;
        lines.push({
          page: pageNumber,
          text: cleaned,
          normalized: normalizeLine(cleaned),
          x: line.items[0]?.x ?? 0,
          y: line.y,
          width: Math.max(
            0,
            ...line.items.map((item) => item.x + item.width - (line.items[0]?.x ?? 0))
          ),
          height: Math.max(...line.items.map((item) => item.height), 0)
        });
      });
    }
  } finally {
    await document.destroy();
  }

  return { pages, lines };
}

function hasExpectedTextCoverage(layout: PdfLayout, expectedTexts: string[]) {
  if (!expectedTexts.length) return true;
  const rendered = normalizeCoverageText(layout.lines.map((line) => line.text).join(" "));
  return expectedTexts.every((text) => {
    const expected = normalizeCoverageText(text);
    return !expected || rendered.includes(expected);
  });
}

function normalizeCoverageText(value: string) {
  return value
    .toLowerCase()
    .replace(/[•●▪‣]/g, " ")
    .replace(/[^\p{L}\p{N}+#@./%$()&-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareBalancedStableGeometry(
  stableMatches: Array<{ original: PdfLine; tailored: PdfLine }>,
  originalLines: PdfLine[],
  tailoredLines: PdfLine[],
  removedParagraphCount: number,
  bodyFontScale: number
) {
  if (stableMatches.length < Math.min(4, originalLines.length)) {
    return { preserved: false, changedRatio: 1 };
  }

  // One edited bullet may gain a rendered line only when the overall document
  // remains balanced by a shorter same-section edit or an approved removal.
  if (tailoredLines.length > originalLines.length + 1) {
    return { preserved: false, changedRatio: 1 };
  }

  let failures = 0;
  const maximumUpwardShiftPt = Math.min(34, 14 + removedParagraphCount * 10);
  const maximumDownwardShiftPt = 14;
  const matchesByPage = new Map<number, Array<{ original: PdfLine; tailored: PdfLine }>>();
  stableMatches.forEach((match) => {
    const pageMatches = matchesByPage.get(match.original.page) ?? [];
    pageMatches.push(match);
    matchesByPage.set(match.original.page, pageMatches);
  });

  matchesByPage.forEach((matches) => {
    matches.sort((first, second) => second.original.y - first.original.y);
    matches.forEach((match) => {
      const horizontalDelta = Math.abs(match.original.x - match.tailored.x);
      const typographyDelta = Math.abs(match.original.height - match.tailored.height);
      const verticalShift = match.tailored.y - match.original.y;
      if (
        horizontalDelta > anchorTolerancePt ||
        (typographyDelta > typographyTolerancePt &&
          !isApprovedTypographyChange(
            match.original.height,
            match.tailored.height,
            bodyFontScale
          )) ||
        verticalShift < -maximumDownwardShiftPt ||
        verticalShift > maximumUpwardShiftPt
      ) {
        failures += 1;
      }
    });
  });

  return {
    preserved: failures === 0,
    changedRatio: failures / Math.max(1, stableMatches.length)
  };
}

function isApprovedTypographyChange(
  originalHeight: number,
  tailoredHeight: number,
  bodyFontScale: number
) {
  const delta = Math.abs(originalHeight - tailoredHeight);
  if (delta <= typographyTolerancePt) return true;
  if (bodyFontScale >= 0.999 || originalHeight <= 0 || tailoredHeight <= 0) {
    return false;
  }
  const ratio = tailoredHeight / originalHeight;
  // Word rounds half-point sizes, so smaller source fonts can land a few
  // percentage points away from the requested document-wide scale.
  return ratio <= 1.001 && Math.abs(ratio - bodyFontScale) <= 0.075;
}

async function compareRenderedPixels(
  originalPdf: Buffer | Uint8Array,
  tailoredPdf: Buffer | Uint8Array,
  originalLayout: PdfLayout,
  tailoredLayout: PdfLayout,
  stableMatches: Array<{ original: PdfLine; tailored: PdfLine }>
) {
  const [originalPages, tailoredPages] = await Promise.all([
    renderPdfPages(originalPdf),
    renderPdfPages(tailoredPdf)
  ]);
  if (
    originalPages.length !== tailoredPages.length ||
    originalPages.some(
      (page, index) =>
        page.width !== tailoredPages[index]?.width ||
        page.height !== tailoredPages[index]?.height
    )
  ) {
    return { preserved: false, changedRatio: 1 };
  }

  const matchedOriginal = new Set(stableMatches.map((match) => match.original));
  const matchedTailored = new Set(stableMatches.map((match) => match.tailored));
  const masks = [
    ...originalLayout.lines
      .filter((line) => !matchedOriginal.has(line))
      .map(createLineMask),
    ...tailoredLayout.lines
      .filter((line) => !matchedTailored.has(line))
      .map(createLineMask)
  ];
  let changedPixels = 0;
  let comparedPixels = 0;

  originalPages.forEach((originalPage, pageIndex) => {
    const tailoredPage = tailoredPages[pageIndex];
    if (!tailoredPage) return;
    const mask = createPixelMask(
      originalPage.width,
      originalPage.height,
      originalLayout.pages[pageIndex]?.height ?? 0,
      masks.filter((item) => item.page === pageIndex + 1)
    );

    for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
      if (mask[pixelIndex]) continue;
      comparedPixels += 1;
      const offset = pixelIndex * 4;
      const red = Math.abs(originalPage.data[offset] - tailoredPage.data[offset]);
      const green = Math.abs(
        originalPage.data[offset + 1] - tailoredPage.data[offset + 1]
      );
      const blue = Math.abs(
        originalPage.data[offset + 2] - tailoredPage.data[offset + 2]
      );
      const alpha = Math.abs(
        originalPage.data[offset + 3] - tailoredPage.data[offset + 3]
      );
      if (Math.max(red, green, blue, alpha) > pixelDifferenceTolerance) {
        changedPixels += 1;
      }
    }
  });

  const changedRatio = comparedPixels > 0 ? changedPixels / comparedPixels : 1;
  return {
    preserved: changedRatio <= maxChangedPixelRatio,
    changedRatio
  };
}

async function renderPdfPages(pdf: Buffer | Uint8Array) {
  const [pdfjs, canvasModule] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("@napi-rs/canvas")
  ]);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableFontFace: false,
    useSystemFonts: true,
    isEvalSupported: false
  });
  const document = await loadingTask.promise;
  const pages: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [];
  const scale = visualDpi / 72;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const canvas = canvasModule.createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      await page.render({
        canvasContext: context,
        viewport,
        canvas
      } as never).promise;
      pages.push({
        width,
        height,
        data: context.getImageData(0, 0, width, height).data
      });
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }

  return pages;
}

function createLineMask(line: PdfLine) {
  return {
    page: line.page,
    x: Math.max(0, line.x - 2),
    y: Math.max(0, line.y - 2),
    width: line.width + 4,
    height: Math.max(4, line.height + 4)
  };
}

function createPixelMask(
  width: number,
  height: number,
  pageHeightPt: number,
  masks: Array<{ x: number; y: number; width: number; height: number }>
) {
  const scale = visualDpi / 72;
  const output = new Uint8Array(width * height);

  masks.forEach((mask) => {
    const left = Math.max(0, Math.floor(mask.x * scale));
    const right = Math.min(width, Math.ceil((mask.x + mask.width) * scale));
    const top = Math.max(
      0,
      Math.floor((pageHeightPt - (mask.y + mask.height)) * scale)
    );
    const bottom = Math.min(height, Math.ceil((pageHeightPt - mask.y) * scale));
    for (let y = top; y < bottom; y += 1) {
      output.fill(1, y * width + left, y * width + right);
    }
  });

  return output;
}

function matchStableLines(originalLines: PdfLine[], tailoredLines: PdfLine[]) {
  const usedTailoredIndexes = new Set<number>();
  const matches: Array<{ original: PdfLine; tailored: PdfLine }> = [];

  originalLines.forEach((original) => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    tailoredLines.forEach((tailored, index) => {
      if (usedTailoredIndexes.has(index)) return;
      if (tailored.page !== original.page || tailored.normalized !== original.normalized) return;
      const distance = Math.abs(tailored.x - original.x) + Math.abs(tailored.y - original.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) return;
    usedTailoredIndexes.add(bestIndex);
    matches.push({ original, tailored: tailoredLines[bestIndex] });
  });

  return matches;
}

function isProtectedResumeLine(value: string) {
  const normalized = value.trim();
  return (
    isDateLine(normalized) ||
    /@|linkedin\.com|github\.com|\(\d{3}\)|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i.test(normalized) ||
    (/^[A-Z][A-Z0-9/&+\-\s]{2,70}$/.test(normalized) && normalized.split(/\s+/).length <= 7)
  );
}

function isDateLine(value: string) {
  return /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)[a-z]*\.?\s+\d{4}\b|\b\d{4}\s*(?:-|–|—|to)\s*(?:present|\d{4})\b|\bpresent\b/i.test(
    value
  );
}

function normalizeLine(value: string) {
  return value
    .toLowerCase()
    .replace(/[•●▪‣]/g, "")
    .replace(/[^\p{L}\p{N}+#@./%$()&-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function round(value: number, decimals: number) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
