import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  ResumeDocxParagraphRole,
  ResumeLayoutAdjustment,
  ResumeLayoutMap,
  ResumeLayoutMapParagraph
} from "@/lib/types";

const execFileAsync = promisify(execFile);
const maxLatexSourceChars = 180_000;
const latexCompileTimeoutMs = 25_000;

export type ResumeLatexLayoutBlueprint = {
  source: "docx_layout_map" | "inferred";
  pageWidthIn: number;
  pageHeightIn: number;
  marginTopIn: number;
  marginRightIn: number;
  marginBottomIn: number;
  marginLeftIn: number;
  fontFamily?: string;
  baseFontPt: number;
  nameFontPt: number;
  sectionFontPt: number;
  lineStretch: number;
  paragraphCount: number;
  sectionNames: string[];
};

type ResumeLatexLine = {
  text: string;
  role: ResumeDocxParagraphRole;
  paragraph?: ResumeLayoutMapParagraph;
  sectionName?: string;
};

export function createResumeLatexSource(input: {
  tailoredResumeText: string;
  layoutMap?: ResumeLayoutMap | null;
  layoutAdjustment?: ResumeLayoutAdjustment | null;
  documentTitle?: string;
}) {
  const blueprint = createResumeLatexLayoutBlueprint(input.layoutMap, input.layoutAdjustment);
  const lines = createResumeLatexLines(input.tailoredResumeText, input.layoutMap);
  const body = renderResumeLatexLines(lines, blueprint);
  const title = escapeLatex(input.documentTitle?.trim() || "Tailored Resume");
  const sourceFont = sanitizeLatexFontName(blueprint.fontFamily);
  const fontSetup = sourceFont
    ? `\\IfFontExistsTF{${sourceFont}}{\\setmainfont{${sourceFont}}}{${getPortableFontFallback()}}`
    : getPortableFontFallback();

  return {
    blueprint,
    source: [
      "\\documentclass[10pt,letterpaper]{article}",
      "\\usepackage[" +
        [
          `paperwidth=${formatDecimal(blueprint.pageWidthIn)}in`,
          `paperheight=${formatDecimal(blueprint.pageHeightIn)}in`,
          `top=${formatDecimal(blueprint.marginTopIn)}in`,
          `right=${formatDecimal(blueprint.marginRightIn)}in`,
          `bottom=${formatDecimal(blueprint.marginBottomIn)}in`,
          `left=${formatDecimal(blueprint.marginLeftIn)}in`
        ].join(",") +
        "]{geometry}",
      "\\usepackage{fontspec}",
      "\\usepackage{xcolor}",
      "\\usepackage{tabularx}",
      "\\usepackage[hidelinks]{hyperref}",
      "\\defaultfontfeatures{Ligatures=TeX,Scale=MatchLowercase}",
      fontSetup,
      "\\pagestyle{empty}",
      "\\setlength{\\parindent}{0pt}",
      "\\setlength{\\parskip}{0pt}",
      "\\setlength{\\tabcolsep}{0pt}",
      "\\setlength{\\emergencystretch}{1.5em}",
      `\\renewcommand{\\baselinestretch}{${formatDecimal(blueprint.lineStretch)}}\\normalsize`,
      `\\newcommand{\\resumeBase}{\\fontsize{${formatDecimal(blueprint.baseFontPt)}}{${formatDecimal(
        blueprint.baseFontPt * 1.13
      )}}\\selectfont}`,
      `\\newcommand{\\resumeName}[1]{{\\centering\\fontsize{${formatDecimal(blueprint.nameFontPt)}}{${formatDecimal(
        blueprint.nameFontPt * 1.08
      )}}\\selectfont\\bfseries #1\\par}}`,
      `\\newcommand{\\resumeSection}[1]{\\vspace{${formatDecimal(
        blueprint.baseFontPt * 0.34
      )}pt}{\\fontsize{${formatDecimal(blueprint.sectionFontPt)}}{${formatDecimal(
        blueprint.sectionFontPt * 1.06
      )}}\\selectfont\\bfseries #1}\\par\\vspace{${formatDecimal(blueprint.baseFontPt * 0.12)}pt}}`,
      `\\newcommand{\\resumeBullet}[1]{\\noindent\\hangindent=${formatDecimal(
        blueprint.baseFontPt * 1.15
      )}pt\\hangafter=1\\makebox[${formatDecimal(blueprint.baseFontPt)}pt][l]{\\textbullet}\\hspace{${formatDecimal(
        blueprint.baseFontPt * 0.15
      )}pt}#1\\par}`,
      "\\hypersetup{pdftitle={" + title + "}}",
      "\\begin{document}",
      "\\resumeBase",
      body,
      "\\end{document}",
      ""
    ].join("\n")
  };
}

export function createResumeLatexLayoutBlueprint(
  layoutMap?: ResumeLayoutMap | null,
  layoutAdjustment?: ResumeLayoutAdjustment | null
): ResumeLatexLayoutBlueprint {
  const paragraphs = layoutMap?.paragraphs ?? [];
  const meaningfulParagraphs = paragraphs.filter((paragraph) => paragraph.role !== "blank");
  const paragraphCount = meaningfulParagraphs.length || 30;
  const sectionCount = layoutMap?.sectionNames.length ?? 5;
  const density = paragraphCount + sectionCount * 1.4;
  const dense = density >= 48;
  const veryDense = density >= 62;
  const requestedScale = clamp(layoutAdjustment?.fontScale ?? 1, 0.92, 1);
  const inferredFontPt = veryDense ? 8.25 : dense ? 8.7 : 9.15;
  const baseFontPt = clamp(layoutMap?.defaultFontSizePt ?? inferredFontPt, 7, 14) * requestedScale;
  const horizontalMargin = veryDense ? 0.42 : dense ? 0.48 : 0.56;
  const verticalMargin = veryDense ? 0.36 : dense ? 0.42 : 0.5;
  const sourcePage = layoutMap?.page;

  return {
    source: layoutMap?.paragraphs.length ? "docx_layout_map" : "inferred",
    pageWidthIn: sourcePage ? clamp(sourcePage.widthPt / 72, 5, 14) : 8.5,
    pageHeightIn: sourcePage ? clamp(sourcePage.heightPt / 72, 7, 18) : 11,
    marginTopIn: sourcePage ? clamp(sourcePage.marginTopPt / 72, 0.16, 2.5) : verticalMargin,
    marginRightIn: sourcePage ? clamp(sourcePage.marginRightPt / 72, 0.16, 2.5) : horizontalMargin,
    marginBottomIn: sourcePage ? clamp(sourcePage.marginBottomPt / 72, 0.16, 2.5) : verticalMargin,
    marginLeftIn: sourcePage ? clamp(sourcePage.marginLeftPt / 72, 0.16, 2.5) : horizontalMargin,
    fontFamily: sanitizeLatexFontName(layoutMap?.defaultFont),
    baseFontPt,
    nameFontPt: baseFontPt * 1.78,
    sectionFontPt: baseFontPt * 1.08,
    lineStretch: veryDense ? 0.96 : dense ? 0.99 : 1.02,
    paragraphCount,
    sectionNames: layoutMap?.sectionNames ?? []
  };
}

export async function compileResumeLatex(source: string) {
  if (!source.trim() || source.length > maxLatexSourceChars) {
    throw new Error("The generated LaTeX source is empty or too large to compile safely.");
  }

  const remoteCompilerUrl = process.env.LATEX_COMPILER_URL?.trim();
  if (remoteCompilerUrl) return compileResumeLatexRemotely(remoteCompilerUrl, source);

  if (process.env.VERCEL) {
    throw new Error("LaTeX PDF export is not configured for production. Set LATEX_COMPILER_URL.");
  }

  return compileResumeLatexLocally(source);
}

export async function inspectResumeLatexPdf(pdf: Buffer, blueprint: ResumeLatexLayoutBlueprint) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: pdf });

  try {
    const info = await parser.getInfo({ parsePageInfo: true });
    const page = info.pages[0];
    if (!page || info.total < 1) throw new Error("The compiled resume PDF has no readable page.");

    const expectedWidth = blueprint.pageWidthIn * 72;
    const expectedHeight = blueprint.pageHeightIn * 72;
    const dimensionDelta = Math.max(Math.abs(page.width - expectedWidth), Math.abs(page.height - expectedHeight));
    if (dimensionDelta > 2) {
      throw new Error("The compiled resume page geometry does not match the extracted layout.");
    }

    return {
      pageCount: info.total,
      widthPt: page.width,
      heightPt: page.height
    };
  } finally {
    await parser.destroy();
  }
}

async function compileResumeLatexRemotely(url: string, source: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/pdf"
  };
  const token = process.env.LATEX_COMPILER_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      engine: "xelatex",
      source
    }),
    signal: AbortSignal.timeout(latexCompileTimeoutMs)
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`The LaTeX compiler rejected this resume (${response.status}). ${detail}`.trim());
  }

  const pdf = Buffer.from(await response.arrayBuffer());
  assertPdf(pdf);
  return {
    pdf,
    engine: "xelatex-remote" as const
  };
}

async function compileResumeLatexLocally(source: string) {
  const workDirectory = await mkdtemp(join(tmpdir(), "stealth-latex-"));
  const texPath = join(workDirectory, "resume.tex");
  const pdfPath = join(workDirectory, "resume.pdf");

  try {
    await writeFile(texPath, source, "utf8");
    await execFileAsync(
      process.env.LATEX_LOCAL_COMMAND?.trim() || "xelatex",
      ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-output-directory", workDirectory, texPath],
      {
        cwd: workDirectory,
        timeout: latexCompileTimeoutMs,
        maxBuffer: 1024 * 1024
      }
    );
    const pdf = await readFile(pdfPath);
    assertPdf(pdf);
    return {
      pdf,
      engine: "xelatex-local" as const
    };
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string"
        ? error.stdout.slice(-1200)
        : error instanceof Error
          ? error.message
          : "Unknown LaTeX compiler error.";
    throw new Error(`Could not typeset the resume with LaTeX. ${detail}`);
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

function createResumeLatexLines(text: string, layoutMap?: ResumeLayoutMap | null): ResumeLatexLine[] {
  const rawLines = text.replace(/\r/g, "").split("\n");
  if (layoutMap?.paragraphs.length && Math.abs(layoutMap.paragraphs.length - rawLines.length) <= 3) {
    return rawLines.map((line, index) => {
      const paragraph = layoutMap.paragraphs[Math.min(index, layoutMap.paragraphs.length - 1)];
      return {
        text: line,
        role: paragraph?.role ?? inferResumeLineRole(line),
        paragraph,
        sectionName: paragraph?.sectionName
      };
    });
  }

  const lines: ResumeLatexLine[] = [];
  let currentSection = "";
  let headerLineCount = 0;

  rawLines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (isResumeMetadataLine(line)) return;

    if (line.startsWith("SECTION:")) {
      currentSection = line.slice("SECTION:".length).trim();
      if (!/^(resume header|resume)$/i.test(currentSection)) {
        lines.push({
          text: currentSection,
          role: "section_heading",
          sectionName: currentSection
        });
      }
      return;
    }

    const role = line
      ? currentSection === "Resume Header" && headerLineCount < 3
        ? "contact_header"
        : inferResumeLineRole(line)
      : "blank";
    if (role === "contact_header") headerLineCount += 1;
    lines.push({ text: rawLine, role, sectionName: currentSection });
  });

  return lines;
}

function renderResumeLatexLines(lines: ResumeLatexLine[], blueprint: ResumeLatexLayoutBlueprint) {
  let contactLineIndex = 0;
  const rendered: string[] = [];

  lines.forEach((line, index) => {
    const text = line.text.trim();
    const nextRole = lines[index + 1]?.role;

    if (!text && line.role !== "divider") {
      rendered.push(`\\vspace{${formatDecimal(blueprint.baseFontPt * 0.28)}pt}`);
      return;
    }

    if (line.role === "contact_header") {
      const escaped = renderInlineResumeText(text);
      if (contactLineIndex === 0) {
        rendered.push(applySourceParagraphFormat(`\\resumeName{${escaped}}`, line, blueprint));
      } else {
        rendered.push(applySourceParagraphFormat(`{\\centering ${escaped}\\par}`, line, blueprint));
      }
      contactLineIndex += 1;
      return;
    }

    if (line.role === "section_heading") {
      rendered.push(applySourceParagraphFormat(`\\resumeSection{${escapeLatex(text)}}`, line, blueprint));
      if (nextRole !== "divider") {
        rendered.push(`\\vspace{${formatDecimal(blueprint.baseFontPt * 0.08)}pt}\\hrule\\vspace{${formatDecimal(
          blueprint.baseFontPt * 0.28
        )}pt}`);
      }
      return;
    }

    if (line.role === "divider") {
      rendered.push(`\\hrule\\vspace{${formatDecimal(blueprint.baseFontPt * 0.28)}pt}`);
      return;
    }

    if (line.role === "bullet" || /^[•\-*]\s+/.test(text)) {
      rendered.push(
        applySourceParagraphFormat(
          `\\resumeBullet{${renderInlineResumeText(text.replace(/^[•\-*]\s+/, ""))}}`,
          line,
          blueprint
        )
      );
      return;
    }

    const columns = getResumeLineColumns(line);
    if (columns) {
      const left = line.role === "role_header" || line.role === "date_locked_header"
        ? `\\textbf{${renderInlineResumeText(columns.left)}}`
        : renderInlineResumeText(columns.left);
      rendered.push(
        applySourceParagraphFormat(
          `\\begin{tabular*}{\\textwidth}{@{}p{0.78\\textwidth}@{\\extracolsep{\\fill}}r@{}}${left} & ${escapeLatex(
            columns.right
          )}\\\\\\end{tabular*}\\par`,
          line,
          blueprint
        )
      );
      return;
    }

    const content = renderInlineResumeText(text);
    if (line.role === "role_header" || line.role === "date_locked_header") {
      rendered.push(applySourceParagraphFormat(`\\textbf{${content}}\\par`, line, blueprint));
      return;
    }

    rendered.push(applySourceParagraphFormat(`${content}\\par`, line, blueprint));
  });

  return rendered.join("\n");
}

function applySourceParagraphFormat(content: string, line: ResumeLatexLine, blueprint: ResumeLatexLayoutBlueprint) {
  const format = line.paragraph?.format;
  if (!format) return content;

  const commands: string[] = [];
  const fontSize = format.fontSizePt ? clamp(format.fontSizePt, 6, 32) : undefined;
  if (fontSize) {
    const lineSpacing = clamp(format.lineSpacing ?? blueprint.lineStretch, 0.7, 3);
    commands.push(`\\fontsize{${formatDecimal(fontSize)}}{${formatDecimal(fontSize * lineSpacing * 1.12)}}\\selectfont`);
  }
  if (format.bold) commands.push("\\bfseries");
  if (format.italic) commands.push("\\itshape");
  if (format.alignment === "center") commands.push("\\centering");
  if (format.alignment === "right") commands.push("\\raggedleft");
  if (format.alignment === "left") commands.push("\\raggedright");
  if (typeof format.leftIndentPt === "number" && Math.abs(format.leftIndentPt) > 0.1) {
    commands.push(`\\leftskip=${formatDecimal(format.leftIndentPt)}pt`);
  }
  if (typeof format.rightIndentPt === "number" && Math.abs(format.rightIndentPt) > 0.1) {
    commands.push(`\\rightskip=${formatDecimal(format.rightIndentPt)}pt`);
  }

  const before =
    typeof format.spacingBeforePt === "number" && format.spacingBeforePt > 0
      ? `\\vspace{${formatDecimal(format.spacingBeforePt)}pt}`
      : "";
  const after =
    typeof format.spacingAfterPt === "number" && format.spacingAfterPt > 0
      ? `\\vspace{${formatDecimal(format.spacingAfterPt)}pt}`
      : "";
  return [before, `{${commands.join(" ")} ${content}}`, after].filter(Boolean).join("\n");
}

function getResumeLineColumns(line: ResumeLatexLine) {
  const rightText = line.paragraph?.rightText?.trim();
  if (rightText) {
    const text = line.text.trim();
    const rightIndex = text.lastIndexOf(rightText);
    return {
      left: rightIndex > 0 ? text.slice(0, rightIndex).trim() : line.paragraph?.leftText?.trim() || text,
      right: rightText
    };
  }

  const tabParts = line.text
    .split(/\t|\s{3,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (tabParts.length < 2) return null;
  const right = tabParts[tabParts.length - 1];
  if (!looksLikeResumeDateOrLocation(right)) return null;
  return {
    left: tabParts.slice(0, -1).join(" "),
    right
  };
}

function inferResumeLineRole(line: string): ResumeDocxParagraphRole {
  const trimmed = line.trim();
  if (!trimmed) return "blank";
  if (/^[=_\-]{4,}$/.test(trimmed)) return "divider";
  if (/^[•\-*]\s+/.test(trimmed)) return "bullet";
  if (looksLikeSectionHeading(trimmed)) return "section_heading";
  if (/\b(?:19|20)\d{2}\b/.test(trimmed) && /\s{2,}|\t/.test(line)) return "date_locked_header";
  if (/^[^:]{2,28}:\s+\S/.test(trimmed)) return "skills_line";
  return "body";
}

function looksLikeSectionHeading(value: string) {
  const letters = value.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && value.length <= 48 && letters === letters.toUpperCase();
}

function looksLikeResumeDateOrLocation(value: string) {
  return (
    /\b(?:19|20)\d{2}\b/.test(value) ||
    /\b(?:present|current)\b/i.test(value) ||
    /\b(?:remote|hybrid|on-site)\b/i.test(value) ||
    /^[A-Za-z .'-]+,\s*[A-Z]{2}$/.test(value)
  );
}

function isResumeMetadataLine(value: string) {
  return /^(STRUCTURED_RESUME_UPLOAD|SOURCE_TYPE|DETECTED_SECTIONS):/.test(value);
}

function renderInlineResumeText(value: string) {
  const colonIndex = value.indexOf(":");
  if (colonIndex > 0 && colonIndex <= 32) {
    const label = value.slice(0, colonIndex + 1);
    const rest = value.slice(colonIndex + 1).trim();
    if (rest) return `\\textbf{${escapeLatex(label)}} ${escapeLatex(rest)}`;
  }
  return escapeLatex(value);
}

export function escapeLatex(value: string) {
  const replacements: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "$": "\\$",
    "&": "\\&",
    "%": "\\%",
    "#": "\\#",
    "_": "\\_",
    "^": "\\textasciicircum{}",
    "~": "\\textasciitilde{}"
  };
  return value.replace(/[\\{}$&%#_^~]/g, (character) => replacements[character] ?? character);
}

function assertPdf(pdf: Buffer) {
  if (pdf.length < 800 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("The LaTeX compiler did not return a valid PDF document.");
  }
}

function formatDecimal(value: number) {
  return Number(value.toFixed(3)).toString();
}

function getPortableFontFallback() {
  return "\\IfFontExistsTF{Aptos}{\\setmainfont{Aptos}}{\\IfFontExistsTF{Arial}{\\setmainfont{Arial}}{\\renewcommand{\\familydefault}{\\sfdefault}}}";
}

function sanitizeLatexFontName(value?: string) {
  const cleaned = value?.replace(/[^\p{L}\p{N} ._-]+/gu, "").trim();
  return cleaned ? cleaned.slice(0, 80) : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
