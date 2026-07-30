import assert from "node:assert/strict";
import {
  compileResumeLatex,
  createResumeLatexSource,
  escapeLatex,
  inspectResumeLatexPdf
} from "../lib/resume-latex.ts";

const layoutMap = {
  source: "docx",
  generatedAt: new Date().toISOString(),
  sectionNames: ["Education", "Experience", "Skills"],
  page: {
    widthPt: 612,
    heightPt: 792,
    marginTopPt: 36,
    marginRightPt: 40,
    marginBottomPt: 36,
    marginLeftPt: 40
  },
  defaultFont: "Arial",
  defaultFontSizePt: 9,
  paragraphs: [
    paragraph("p-1", "contact_header", "ADITYA VERMA", false),
    paragraph("p-2", "contact_header", "aditya@example.com | Phoenix, AZ", false),
    paragraph("p-3", "section_heading", "EDUCATION", false),
    paragraph("p-4", "date_locked_header", "Arizona State University    May 2026", true, {
      leftText: "Arizona State University",
      rightText: "May 2026"
    }),
    paragraph("p-5", "section_heading", "EXPERIENCE", false),
    paragraph("p-6", "date_locked_header", "Supply Chain Intern    Jun 2025 - Aug 2025", true, {
      leftText: "Supply Chain Intern",
      rightText: "Jun 2025 - Aug 2025"
    }),
    paragraph("p-7", "bullet", "• Improved demand forecasting with SAP and Excel.", true),
    paragraph("p-8", "bullet", "• Built KPI reporting for inventory planning.", true),
    paragraph("p-9", "section_heading", "SKILLS", false),
    paragraph("p-10", "skills_line", "Analytics: SQL, Excel, Tableau & Power BI", true)
  ]
};

const tailoredResumeText = layoutMap.paragraphs.map((item) => item.text).join("\n");
const build = createResumeLatexSource({
  tailoredResumeText,
  layoutMap,
  layoutAdjustment: {
    fontScale: 1,
    reason: "Fixture"
  },
  documentTitle: "Supply Chain Analyst Resume"
});

assert.equal(build.blueprint.source, "docx_layout_map");
assert.match(build.source, /\\begin\{document\}/);
assert.match(build.source, /paperwidth=8.5in/);
assert.match(build.source, /left=0.556in/);
assert.match(build.source, /Tableau \\& Power BI/);
assert.equal(escapeLatex("\\input{secret}"), "\\textbackslash{}input\\{secret\\}");

const compiled = await compileResumeLatex(build.source);
assert.ok(compiled.pdf.length > 800);
assert.equal(compiled.pdf.subarray(0, 5).toString("ascii"), "%PDF-");
const inspection = await inspectResumeLatexPdf(compiled.pdf, build.blueprint);
assert.equal(inspection.pageCount, 1);
assert.ok(Math.abs(inspection.widthPt - layoutMap.page.widthPt) <= 2);
assert.ok(Math.abs(inspection.heightPt - layoutMap.page.heightPt) <= 2);

console.log(
  `LaTeX resume evaluation passed: ${compiled.engine}, ${compiled.pdf.length} bytes, ${inspection.pageCount} page, ${build.blueprint.paragraphCount} paragraphs.`
);

function paragraph(id, role, text, canEdit, columns = {}) {
  return {
    id,
    role,
    text,
    editableText: text,
    hasLockedDate: role === "date_locked_header",
    isBullet: role === "bullet",
    canEdit,
    canInsertAfter: role === "bullet",
    canRemove: false,
    ...columns
  };
}
