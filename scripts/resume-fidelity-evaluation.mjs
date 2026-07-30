import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import {
  createResumeLayoutMapFromDocx,
  createTailoredDocxBuildResultFromOriginal,
  validateExactDocxPackageFidelity
} from "../lib/resume-docx.ts";
import { selectCompleteReplacementCandidate } from "../lib/resume-fit.ts";
import {
  estimateResumeRenderedWidth,
  isSubstantiallyRepetitive,
  scoreResumeEditOperations
} from "../lib/resume-impact.ts";
import { validateResumePdfFidelity } from "../lib/resume-pdf-fidelity.ts";
import { fitResumeWithMicrosoftWord } from "../lib/resume-word-fit.ts";

const fixture = await createFixtureDocx();
const noOp = await createTailoredDocxBuildResultFromOriginal(fixture, {
  editOperations: [],
  rewrites: []
});

assert.deepEqual(
  Buffer.from(noOp.buffer),
  fixture,
  "A no-op exact-format build must remain byte-identical."
);

const layoutMap = await createResumeLayoutMapFromDocx(fixture);
const target = layoutMap.paragraphs.find((paragraph) =>
  paragraph.text.includes("forecasting dashboards")
);
assert(target, "The editable mixed-format fixture paragraph should be mapped.");

const nearWidthRatio =
  estimateResumeRenderedWidth(
    "• Built SQL forecasting dashboards for inventory, improving decisions by 35%."
  ) / estimateResumeRenderedWidth(target.text);
assert(
  nearWidthRatio >= 0.9 && nearWidthRatio <= 1.03,
  "The primary fixture rewrite should stay inside the same-width target band."
);
assert.equal(
  isSubstantiallyRepetitive(
    "Built forecasting dashboards and presented inventory findings to stakeholders.",
    ["Built forecasting dashboards and presented inventory findings to stakeholders."],
    ["forecasting"]
  ),
  true,
  "Repeated actions and outcomes should be rejected even when common target keywords are ignored."
);
const redundantImpact = scoreResumeEditOperations({
  operations: [
    {
      type: "replace_bullet",
      paragraphId: target.id,
      original: target.text,
      replacement: "• Coordinated dashboard requirements with operations partners.",
      replacementCandidates: [
        "• Presented inventory findings to cross-functional stakeholders.",
        "• Built SQL forecasting dashboards for inventory, improving decisions by 35%."
      ],
      targetKeywords: ["SQL", "forecasting"],
      reason: "Only the distinct, relevant candidate should survive."
    }
  ],
  job: {
    id: "fixture-job",
    title: "Supply Chain Analyst Intern",
    company: "Example",
    location: "Remote",
    workType: "Remote",
    sponsorshipFriendly: true,
    competitionLevel: "Medium",
    skills: ["SQL", "forecasting", "inventory"],
    description: "Build SQL forecasting and inventory planning dashboards."
  },
  profile: {
    resumeText: layoutMap.paragraphs.map((paragraph) => paragraph.text).join("\n"),
    lookingFor: "Internship"
  },
  layoutMap
});
assert.equal(redundantImpact.operations.length, 1);
assert.match(redundantImpact.operations[0]?.replacement ?? "", /SQL forecasting dashboards/);

const tailored = await createTailoredDocxBuildResultFromOriginal(fixture, {
  editOperations: [
    {
      type: "replace_bullet",
      paragraphId: target.id,
      targetSection: target.sectionName,
      original: target.text,
      replacement: "• Built SQL forecasting dashboards for inventory planning, improving decisions by 35%.",
      keywords: ["SQL", "forecasting", "inventory"],
      reason: "Adds supported role language without changing the paragraph slot.",
      priority: 5,
      contentHash: target.contentHash,
      maxChars: target.maxReplacementChars
    }
  ],
  layoutAdjustment: {
    fontScale: 1,
    reason: "No scaling needed for this same-width rewrite."
  }
});

assert.equal(tailored.stats.validationStatus, "valid");
assert.equal(tailored.stats.fontScale, 1, "Same-width edits should retain the original font size.");
assert.equal(tailored.stats.insertedBullets, 0, "Exact mode must never insert paragraphs.");
assert.equal(tailored.stats.removedLines, 0, "Exact mode must never remove paragraphs.");
assert.equal(tailored.stats.appliedEdits, 1, "The in-place text edit should be accepted.");

const fidelity = await validateExactDocxPackageFidelity(fixture, tailored.buffer);
assert(fidelity.packagePartsChecked >= 4);

const [originalZip, tailoredZip] = await Promise.all([
  JSZip.loadAsync(fixture),
  JSZip.loadAsync(tailored.buffer)
]);
for (const name of Object.keys(originalZip.files)) {
  if (name === "word/document.xml" || originalZip.files[name]?.dir) continue;
  const [originalPart, tailoredPart] = await Promise.all([
    originalZip.file(name)?.async("nodebuffer"),
    tailoredZip.file(name)?.async("nodebuffer")
  ]);
  assert.deepEqual(tailoredPart, originalPart, `${name} must remain byte-identical.`);
}

const originalXml = await originalZip.file("word/document.xml").async("string");
const tailoredXml = await tailoredZip.file("word/document.xml").async("string");
assert.notEqual(tailoredXml, originalXml);
assert.equal(count(tailoredXml, "<w:p"), count(originalXml, "<w:p"), "Paragraph count changed.");
assert.equal(count(tailoredXml, "<w:r"), count(originalXml, "<w:r"), "Run count changed.");
assert.equal(count(tailoredXml, "<w:tab"), count(originalXml, "<w:tab"), "Tab count changed.");
assert.equal(count(tailoredXml, "<w:b"), count(originalXml, "<w:b"), "Bold formatting changed.");
assert.match(tailoredXml, /May 2025 – Present/, "The tab-aligned date changed.");
assert.match(
  tailoredXml.replace(/<[^>]+>/g, "").replace(/\s+/g, " "),
  /Built SQL forecasting dashboards for inventory planning/,
  "The approved replacement was not written."
);

const skillLine = layoutMap.paragraphs.find((paragraph) =>
  paragraph.text.startsWith("Frameworks & Tools:")
);
assert(skillLine, "The fixture skills line should be mapped.");
const skillPruned = await createTailoredDocxBuildResultFromOriginal(fixture, {
  editOperations: [],
  approvedSkillPrunes: [
    {
      paragraphId: skillLine.id,
      categoryLabel: "Frameworks & Tools:",
      skill: "Tailscale",
      relevanceScore: 10,
      contentHash: skillLine.contentHash,
      originalText: skillLine.text,
      reason: "Lower relevance to the target role."
    }
  ]
});
assert.equal(skillPruned.stats.skillsPruned, 1);
assert.deepEqual(skillPruned.stats.prunedSkills, ["Tailscale"]);
const skillPrunedZip = await JSZip.loadAsync(skillPruned.buffer);
const skillPrunedXml = await skillPrunedZip.file("word/document.xml").async("string");
assert.match(skillPrunedXml, /Frameworks &amp; Tools:/);
assert.doesNotMatch(skillPrunedXml, /Tailscale/);

const scaled = await createTailoredDocxBuildResultFromOriginal(fixture, {
  editOperations: [],
  layoutAdjustment: {
    fontScale: 0.94,
    reason: "Bounded body-text scaling for one-page fit."
  }
});
assert.equal(scaled.stats.fontScale, 0.94);
assert.equal(scaled.stats.fontScaleApplied, 0.94);
assert(scaled.scaledParagraphIds.length > 0);
const scaledZip = await JSZip.loadAsync(scaled.buffer);
const scaledXml = await scaledZip.file("word/document.xml").async("string");
assert.match(scaledXml, /<w:sz w:val="32"\/>/, "The name size must remain protected.");
assert.match(scaledXml, /<w:sz w:val="19"\/>/, "Eligible 10pt body text should scale to 9.5pt.");
await validateExactDocxPackageFidelity(fixture, scaled.buffer, {
  bodyFontScale: scaled.bodyFontScale,
  scaledParagraphIds: scaled.scaledParagraphIds
});

const unsupportedMetric = await createTailoredDocxBuildResultFromOriginal(fixture, {
  editOperations: [
    {
      type: "replace_bullet",
      paragraphId: target.id,
      original: target.text,
      replacement:
        "• Built SQL forecasting dashboards for inventory planning, improving decisions by 50%.",
      keywords: ["SQL", "forecasting"],
      reason: "This edit must be rejected because it changes a factual metric.",
      priority: 5,
      contentHash: target.contentHash,
      maxChars: target.maxReplacementChars
    }
  ]
});
assert.equal(unsupportedMetric.stats.appliedEdits, 0, "Changed metrics must be rejected.");
assert.equal(
  unsupportedMetric.stats.skippedByReason?.protected_content,
  1,
  "Changed metrics should have a protected-content skip reason."
);

const completeCandidate = selectCompleteReplacementCandidate({
  replacement:
    "Built a substantially expanded SQL forecasting dashboard suite for inventory planning and executive decision support.",
  replacementCandidates: [
    "Built SQL forecasting dashboards for inventory planning."
  ],
  maxChars: 60
});
assert.equal(
  completeCandidate?.text,
  "Built SQL forecasting dashboards for inventory planning.",
  "Preflight selection should choose the next complete candidate without truncation."
);
assert.equal(
  selectCompleteReplacementCandidate({
    replacement: "A complete sentence that is too long.",
    replacementCandidates: ["Another complete sentence that is too long."],
    maxChars: 12
  }),
  null,
  "Preflight must reject all candidates rather than returning a fragment."
);

const removableTarget = layoutMap.paragraphs.find((paragraph) =>
  paragraph.text.toLowerCase().includes("documented recurring workflows")
);
assert(removableTarget, "The lower-relevance fit-removal bullet should be mapped.");
assert.equal(removableTarget.bulletIndex, 1);
assert.equal(removableTarget.bulletCount, 4);

const compacted = await createTailoredDocxBuildResultFromOriginal(fixture, {
  editOperations: [
    {
      type: "replace_bullet",
      paragraphId: target.id,
      sectionName: target.sectionName,
      original: target.text,
      replacement:
        "• Built SQL forecasting dashboards for inventory planning, improving decisions by 35%.",
      reason: "Accepted high-priority same-section improvement.",
      priority: 5,
      contentHash: target.contentHash,
      maxChars: target.maxReplacementChars
    }
  ],
  approvedRemovalParagraphIds: [removableTarget.id]
});
assert.deepEqual(compacted.removedParagraphIds, [removableTarget.id]);
assert.equal(compacted.stats.removedForFit, 1);
const compactFidelity = await validateExactDocxPackageFidelity(
  fixture,
  compacted.buffer,
  { removedParagraphIds: compacted.removedParagraphIds }
);
assert.equal(compactFidelity.removedParagraphsVerified, 1);
const compactZip = await JSZip.loadAsync(compacted.buffer);
const compactXml = await compactZip.file("word/document.xml").async("string");
assert.equal(
  countParagraphs(compactXml),
  countParagraphs(originalXml) - 1,
  "A fit removal must delete exactly one physical paragraph."
);
assert.doesNotMatch(
  compactXml,
  /documented recurring workflows/,
  "The approved fit-removal bullet should not leave an empty text slot."
);

const baselinePdf = createPdfFixture("Built forecasting dashboards.", 0);
const overflowPdf = createOverflowPdfFixture();
const mockValidate = async (_original, candidate, options = {}) => {
  const overflowed = Buffer.from(candidate).equals(overflowPdf);
  return createMockFidelityReport({
    verified: !overflowed,
    pageCount: overflowed ? 2 : 1,
    compactMode: options.compactMode === true,
    removedParagraphCount: options.removedParagraphCount ?? 0
  });
};
const renderByContent = async (docx) => {
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file("word/document.xml").async("string");
  const text = xml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  return text.includes("substantially expanded") ? overflowPdf : baselinePdf;
};
const renderGuidedFit = await fitResumeWithMicrosoftWord(
  {
    originalDocx: fixture,
    originalPdf: baselinePdf,
    editOperations: [
      {
        type: "replace_bullet",
        paragraphId: target.id,
        sectionName: target.sectionName,
        original: target.text,
        replacement:
          "• Built a substantially expanded SQL forecasting dashboard suite for inventory planning and executive decision support, improving decisions by 35%.",
        replacementCandidates: [
          "• Built SQL forecasting dashboards for inventory planning, improving decisions by 35%."
        ],
        reason: "Word should choose the shorter complete candidate after overflow.",
        priority: 5,
        contentHash: target.contentHash
      }
    ]
  },
  {
    render: renderByContent,
    validate: mockValidate
  }
);
assert.equal(renderGuidedFit.fallbackToOriginal, false);
assert.equal(renderGuidedFit.attempts, 2);
assert.equal(
  renderGuidedFit.build.appliedChanges[0]?.replacement,
  "• Built SQL forecasting dashboards for inventory planning, improving decisions by 35%.",
  "Word-guided fitting should downgrade to a complete shorter candidate."
);

const skillPruneGuidedFit = await fitResumeWithMicrosoftWord(
  {
    originalDocx: fixture,
    originalPdf: baselinePdf,
    editOperations: [
      {
        type: "replace_bullet",
        paragraphId: target.id,
        sectionName: target.sectionName,
        original: target.text,
        replacement:
          "• Built SQL forecasting dashboards for inventory planning, improving decisions by 35%.",
        reason: "A useful rewrite that needs a small amount of verified room.",
        priority: 5,
        contentHash: target.contentHash,
        impactGain: 22
      }
    ],
    fitSkillPruneCandidates: [
      {
        paragraphId: skillLine.id,
        categoryLabel: "Frameworks & Tools:",
        skill: "Tailscale",
        relevanceScore: 10,
        contentHash: skillLine.contentHash,
        originalText: skillLine.text,
        reason: "Lower relevance to the target role."
      }
    ]
  },
  {
    render: async (docx) => {
      const zip = await JSZip.loadAsync(docx);
      const xml = await zip.file("word/document.xml").async("string");
      const hasRewrite = xml.includes("SQL forecasting dashboards");
      return hasRewrite && xml.includes("Tailscale") ? overflowPdf : baselinePdf;
    },
    validate: mockValidate
  }
);
assert.equal(skillPruneGuidedFit.fallbackToOriginal, false);
assert.equal(skillPruneGuidedFit.build.appliedChanges.length, 1);
assert.equal(skillPruneGuidedFit.build.stats.skillsPruned, 1);
assert.deepEqual(skillPruneGuidedFit.fitPlan.approvedSkillPrunes?.map((item) => item.skill), [
  "Tailscale"
]);

const scaledGuidedFit = await fitResumeWithMicrosoftWord(
  {
    originalDocx: fixture,
    originalPdf: baselinePdf,
    editOperations: [
      {
        type: "replace_bullet",
        paragraphId: target.id,
        sectionName: target.sectionName,
        original: target.text,
        replacement:
          "• Built SQL forecasting dashboards for inventory planning, improving decisions by 35%.",
        reason: "A useful rewrite that fits after bounded body scaling.",
        priority: 5,
        contentHash: target.contentHash,
        impactGain: 20
      }
    ]
  },
  {
    render: async (docx) => {
      const zip = await JSZip.loadAsync(docx);
      const xml = await zip.file("word/document.xml").async("string");
      const hasRewrite = xml.includes("SQL forecasting dashboards");
      return hasRewrite && xml.includes('<w:sz w:val="19"')
        ? baselinePdf
        : hasRewrite
          ? overflowPdf
          : baselinePdf;
    },
    validate: mockValidate
  }
);
assert.equal(scaledGuidedFit.fallbackToOriginal, false);
assert.equal(scaledGuidedFit.build.stats.fontScaleApplied, 0.96);
assert.equal(scaledGuidedFit.fitPlan.bodyFontScale, 0.96);
assert(scaledGuidedFit.build.scaledParagraphIds.length > 0);

const legacyRewriteFit = await fitResumeWithMicrosoftWord(
  {
    originalDocx: fixture,
    originalPdf: baselinePdf,
    editOperations: [],
    rewrites: [
      {
        original: target.text,
        rewrite:
          "• Built SQL forecasting dashboards for inventory planning, improving decisions by 35%.",
        reason: "Legacy rewrite pairs should still enter verified fitting."
      }
    ]
  },
  {
    render: async () => baselinePdf,
    validate: mockValidate
  }
);
assert.equal(legacyRewriteFit.fallbackToOriginal, false);
assert.equal(
  legacyRewriteFit.build.appliedChanges.length,
  1,
  "A legacy rewrite pair should not be silently skipped."
);

const removalGuidedFit = await fitResumeWithMicrosoftWord(
  {
    originalDocx: fixture,
    originalPdf: baselinePdf,
    editOperations: [
      {
        type: "replace_bullet",
        paragraphId: target.id,
        sectionName: target.sectionName,
        original: target.text,
        replacement:
          "• Built SQL forecasting dashboards for inventory planning, improving decisions by 35%.",
        reason: "High-priority same-section improvement.",
        priority: 5,
        contentHash: target.contentHash
      }
    ],
    fitRemovalCandidates: [
      {
        paragraphId: removableTarget.id,
        sectionName: removableTarget.sectionName,
        groupId: removableTarget.groupId,
        original: removableTarget.text,
        relevanceScore: 10,
        contentHash: removableTarget.contentHash,
        reason: "Lower relevance to the target job."
      }
    ]
  },
  {
    render: async (docx) => {
      const zip = await JSZip.loadAsync(docx);
      const xml = await zip.file("word/document.xml").async("string");
      const text = xml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
      return text.toLowerCase().includes("documented recurring workflows")
        ? overflowPdf
        : baselinePdf;
    },
    validate: mockValidate
  }
);
assert.deepEqual(removalGuidedFit.build.removedParagraphIds, [
  removableTarget.id
]);
assert.equal(removalGuidedFit.build.stats.removedForFit, 1);
assert.equal(removalGuidedFit.report.pageCount, 1);

const secondTarget = layoutMap.paragraphs.find((paragraph) =>
  paragraph.text.toLowerCase().includes("coordinated dashboard requirements")
);
assert(secondTarget, "The second independently editable bullet should be mapped.");
const partialFit = await fitResumeWithMicrosoftWord(
  {
    originalDocx: fixture,
    originalPdf: baselinePdf,
    editOperations: [
      {
        type: "replace_bullet",
        paragraphId: target.id,
        sectionName: target.sectionName,
        original: target.text,
        replacement:
          "• Built SQL forecasting dashboards for inventory planning, improving decisions by 35%.",
        reason: "This high-priority edit fits independently.",
        priority: 5,
        contentHash: target.contentHash
      },
      {
        type: "replace_bullet",
        paragraphId: secondTarget.id,
        sectionName: secondTarget.sectionName,
        original: secondTarget.text,
        replacement:
          "• Added a never-fits expansion that must not discard the previously verified rewrite.",
        reason: "This edit intentionally fails the mocked Word fit check.",
        priority: 4,
        contentHash: secondTarget.contentHash
      }
    ]
  },
  {
    render: async (docx) => {
      const zip = await JSZip.loadAsync(docx);
      const xml = await zip.file("word/document.xml").async("string");
      return xml.includes("never-fits") ? overflowPdf : baselinePdf;
    },
    validate: mockValidate
  }
);
assert.equal(
  partialFit.fallbackToOriginal,
  false,
  "One incompatible rewrite must not discard a verified edit."
);
assert.equal(partialFit.build.appliedChanges.length, 1);
assert.equal(partialFit.build.stats.rejectedForFit, 1);
assert.equal(partialFit.fitPlan.selections.length, 1);
assert.equal(partialFit.fitPlan.rejectedOperationIndexes.length, 1);
assert.match(
  partialFit.build.appliedChanges[0]?.replacement ?? "",
  /SQL forecasting dashboards/,
  "The best verified partial result should be retained."
);

const reusedFitPlan = await fitResumeWithMicrosoftWord(
  {
    originalDocx: fixture,
    originalPdf: baselinePdf,
    editOperations: [
      {
        type: "replace_bullet",
        paragraphId: target.id,
        sectionName: target.sectionName,
        original: target.text,
        replacement:
          "• Built SQL forecasting dashboards for inventory planning, improving decisions by 35%.",
        reason: "This high-priority edit fits independently.",
        priority: 5,
        contentHash: target.contentHash
      },
      {
        type: "replace_bullet",
        paragraphId: secondTarget.id,
        sectionName: secondTarget.sectionName,
        original: secondTarget.text,
        replacement:
          "• Added a never-fits expansion that must not discard the previously verified rewrite.",
        reason: "This edit intentionally fails the mocked Word fit check.",
        priority: 4,
        contentHash: secondTarget.contentHash
      }
    ],
    verifiedFitPlan: partialFit.fitPlan
  },
  {
    render: async () => baselinePdf,
    validate: mockValidate
  }
);
assert.equal(reusedFitPlan.attempts, 1);
assert.equal(reusedFitPlan.build.appliedChanges.length, 1);
assert.deepEqual(
  reusedFitPlan.fitPlan.selections,
  partialFit.fitPlan.selections,
  "DOCX export should be able to reuse the exact PDF-verified fit plan."
);

const textOnlyPdf = createPdfFixture("Built inventory dashboards.", 0);
const verifiedPdf = await validateResumePdfFidelity(baselinePdf, textOnlyPdf, {
  packageIntegrityPreserved: true
});
assert.equal(
  verifiedPdf.status,
  "verified",
  `A same-slot text replacement should pass: ${verifiedPdf.warnings.join(" ")}`
);
assert.equal(verifiedPdf.pixelFidelityPreserved, true);

const scaledBodyPdf = createPdfFixture("Built forecasting dashboards.", 0, 0.95);
const verifiedScaledPdf = await validateResumePdfFidelity(
  baselinePdf,
  scaledBodyPdf,
  {
    packageIntegrityPreserved: true,
    balancedMode: true,
    bodyFontScale: 0.95
  }
);
assert.equal(
  verifiedScaledPdf.status,
  "verified",
  `Approved body scaling should verify while protected text remains fixed: ${verifiedScaledPdf.warnings.join(" ")}`
);
assert.equal(verifiedScaledPdf.fontScalingVerified, true);

const shiftedHeadingPdf = createPdfFixture("Built inventory dashboards.", 2);
const failedPdf = await validateResumePdfFidelity(baselinePdf, shiftedHeadingPdf, {
  packageIntegrityPreserved: true
});
assert.equal(failedPdf.status, "failed", "A shifted protected heading must fail.");
assert.equal(failedPdf.paragraphStructurePreserved, false);

console.log("Resume fidelity evaluation passed.");

async function createFixtureDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr/></w:pPrDefault>
  </w:docDefaults>
</w:styles>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>ADITYA VERMA</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r><w:t>(602) 582-3165 • averm118@asu.edu • linkedin.com/in/adityavarma</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="666666"/></w:pBdr></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>TECHNICAL SKILLS</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Programming Languages:</w:t></w:r>
      <w:r><w:t xml:space="preserve"> Java, Python, C, C++, JavaScript, TypeScript</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Frameworks &amp; Tools:</w:t></w:r>
      <w:r><w:t xml:space="preserve"> Git, React, Next.js, Tailwind CSS, Playwright, Tailscale</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="666666"/></w:pBdr></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>WORK EXPERIENCE</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Data Analyst Intern, Example Company</w:t></w:r>
      <w:r><w:tab/></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>May 2025 – Present</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:ind w:left="360" w:hanging="180"/></w:pPr>
      <w:r><w:t xml:space="preserve">• Built </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">forecasting dashboards </w:t></w:r>
      <w:r><w:t>for class projects, improving decisions by 35%.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:ind w:left="360" w:hanging="180"/></w:pPr>
      <w:r><w:t>• Documented recurring workflows for the analytics team.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:ind w:left="360" w:hanging="180"/></w:pPr>
      <w:r><w:t>• Coordinated dashboard requirements with operations partners.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:ind w:left="360" w:hanging="180"/></w:pPr>
      <w:r><w:t>• Presented inventory findings to cross-functional stakeholders.</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`
  );

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

function count(value, needle) {
  return value.split(needle).length - 1;
}

function countParagraphs(value) {
  return (value.match(/<w:p(?:\s|>)/g) ?? []).length;
}

function createPdfFixture(editableLine, headingShiftPt, bodyScale = 1) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
    compress: false
  });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("WORK EXPERIENCE", 54, 72 + headingShiftPt);
  pdf.setLineWidth(0.75);
  pdf.line(54, 77 + headingShiftPt, 558, 77 + headingShiftPt);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text("May 2025 - Present", 470, 96);
  pdf.setFontSize(10 * bodyScale);
  pdf.text(editableLine, 72, 114);
  pdf.text("Programming Languages: C, C++, Python", 72, 132);
  pdf.text("Frameworks: React, Next.js, Tailwind CSS", 72, 150);
  pdf.text("Platforms: Linux, Windows, macOS", 72, 168);
  return Buffer.from(pdf.output("arraybuffer"));
}

function createOverflowPdfFixture() {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
    compress: false
  });
  pdf.text("WORK EXPERIENCE", 54, 72);
  pdf.addPage();
  pdf.text("Overflow", 54, 72);
  return Buffer.from(pdf.output("arraybuffer"));
}

function createMockFidelityReport({
  verified,
  pageCount,
  compactMode,
  removedParagraphCount
}) {
  return {
    status: verified ? "verified" : "failed",
    renderer: "microsoft_graph_word",
    pageCount,
    pageGeometryPreserved: verified,
    protectedAnchorsChecked: 4,
    stableAnchorsChecked: 4,
    maxAnchorDeltaPt: 0,
    packageIntegrityPreserved: true,
    typographyPreserved: true,
    dateAlignmentPreserved: true,
    paragraphStructurePreserved: verified,
    fullTextCoveragePreserved: verified,
    pixelFidelityPreserved: verified,
    changedPixelsOutsideMasksRatio: verified ? 0 : 1,
    compactMode,
    removedParagraphsVerified: removedParagraphCount,
    failureReasons: verified ? [] : ["page_overflow"],
    warnings: verified ? [] : ["Page count changed."]
  };
}
