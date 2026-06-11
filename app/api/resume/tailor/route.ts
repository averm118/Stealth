import { NextResponse } from "next/server";
import { TAILOR_RESUME_VERSION } from "@/lib/ai-versions";
import { prepareResumeForAi } from "@/lib/ai-text";
import { callGeminiJson } from "@/lib/gemini";
import { getJobById } from "@/lib/jobs";
import { createResumeLayoutMapFromDocx } from "@/lib/resume-docx";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  CandidateProfile,
  Job,
  ResumeDocxEditStats,
  ResumeAppliedChange,
  ResumeBulletRewrite,
  ResumeEditOperation,
  ResumeEditOperationType,
  ResumeLayoutAdjustment,
  ResumeLayoutMap,
  ResumeLayoutMapParagraph,
  ResumeSkippedChange,
  TailoredResumeResult
} from "@/lib/types";

export const runtime = "nodejs";

const maxResumeChars = 36000;
const maxJobDescriptionChars = 42000;
const maxGeneratedEditOperations = 32;
const maxDocxLayoutLockedOperations = 14;
const maxDocxLayoutLockedInsertions = 2;
const maxBulletRewriteSummaries = 16;
const lightTailoringEditThreshold = 6;

type ResumeApplyResult = {
  tailoredResumeText: string;
  appliedChanges: ResumeAppliedChange[];
  skippedChanges: ResumeSkippedChange[];
  docxEditStats?: ResumeDocxEditStats;
};

type PreviewReplacement = {
  text: string;
  shortened: boolean;
};

export async function POST(request: Request) {
  try {
    const { jobId, profile, mode, resumeLayoutMap } = (await request.json()) as {
      jobId?: unknown;
      profile?: unknown;
      mode?: unknown;
      resumeLayoutMap?: unknown;
    };

    if (typeof jobId !== "string") {
      return NextResponse.json({ error: "Job id is required." }, { status: 400 });
    }

    if (mode !== "analyze" && mode !== "generate") {
      return NextResponse.json({ error: "Tailoring mode must be analyze or generate." }, { status: 400 });
    }

    if (!isCandidateProfile(profile)) {
      return NextResponse.json({ error: "Candidate profile is required." }, { status: 400 });
    }

    const job = await getJobById(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    if (!profile.resumeText?.trim()) {
      return NextResponse.json({
        result: buildOriginalResumeResult(profile, "Upload a resume before tailoring.")
      });
    }

    try {
      const cleanLayoutMap = cleanResumeLayoutMap(resumeLayoutMap);
      const result = await tailorResumeWithGemini(job, profile, mode, cleanLayoutMap);
      return NextResponse.json({ result });
    } catch (error) {
      console.warn("Gemini resume tailoring failed; showing original resume.", error);
      return NextResponse.json({
        result: buildOriginalResumeResult(profile, "AI tailoring failed. Showing your original resume.")
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not tailor this resume.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function tailorResumeWithGemini(
  job: Job,
  profile: CandidateProfile,
  mode: "analyze" | "generate",
  providedLayoutMap?: ResumeLayoutMap | null
): Promise<TailoredResumeResult> {
  const resumeText = prepareResumeForAi(profile.resumeText, maxResumeChars);
  const jobDescription = prepareResumeForAi(job.description, maxJobDescriptionChars);
  const resumeLayoutMap =
    mode === "generate" ? providedLayoutMap ?? (await loadServerResumeLayoutMap(profile)) : providedLayoutMap ?? null;
  const docxMode = mode === "generate" && Boolean(resumeLayoutMap?.paragraphs.length);

  const parsed = await callGeminiJson<Partial<TailoredResumeResult>>({
    task: "tailor",
    maxTokens: 7600,
    timeoutMs: 42000,
    schemaName: "job_specific_resume_tailoring",
    schema: tailoredResumeSchema,
    messages: [
      {
        role: "system",
        content: [
          "You are Stealth's evidence-first resume tailoring assistant.",
          "Tailor one resume to one job using only the supplied original resume, extracted profile, and job description.",
          "Act as a layout-locked, evidence-first resume editor, not a layout designer.",
          "Keep the original resume structure, section order, headings, dates, contact block, margins, spacing, paragraph count, and layout intent.",
          "Preserve the original line-break style, section labels, section order, and compact resume density.",
          "Make the most important truthful changes for this specific job without changing the resume's overall look.",
          "Apply-ready layout preservation is the default: prefer fewer high-confidence edits over aggressive edits that change spacing.",
          "Before returning, make a complete pass over Skills, Education/Coursework, Experience, Projects, and every other relevant existing section.",
          "Prefer targeted operations that preserve the original layout over a full freeform rewrite.",
          docxMode
            ? "DOCX layout mode is active. You must edit by paragraph IDs from resumeLayoutMap. Return structured operations only; do not invent paragraph IDs."
            : "Plain text mode is active. Return line-level operations that can be mapped back to the resume text.",
          "Rewrite honestly without inventing experience.",
          "Do not invent employers, tools, metrics, degrees, projects, dates, certifications, responsibilities, visa facts, or job requirements.",
          "Add missing job keywords naturally when the original resume, coursework, projects, or profile evidence supports them.",
          "If a keyword is only coursework or beginner exposure, represent it honestly as coursework or exposure.",
          "Improve ATS alignment while keeping formatting professional and concise.",
          "Highlight relevant projects and skills already present in the uploaded resume/profile.",
          "Preserve the candidate's actual experience level and work authorization signals.",
          docxMode
            ? "Use only these DOCX operations: replace_paragraph_text, append_to_paragraph, replace_bullet, insert_bullet_after, shorten_paragraph. Do not use remove_low_priority_paragraph for DOCX resumes."
            : "Use editOperations for the actual changes: replace_line, append_to_line, or shorten_line.",
          docxMode
            ? "Every DOCX operation must reference paragraphId, except insert_bullet_after may use insertAfterParagraphId."
            : "Each text operation original should quote or closely paraphrase an existing resume line.",
          docxMode
            ? "For generate mode in DOCX layout mode, return 6 to 14 focused editOperations. Fewer is better than damaging layout."
            : "For generate mode in plain text mode, return 6 to 14 focused editOperations when the resume has enough evidence for the job.",
          "If evidence is limited, return a lighter set rather than padding unsupported changes.",
          "Set priority from 1 to 5 where 5 is job-critical, evidenceSource to the resume/profile evidence used, targetKeywords to the job keywords addressed, and maxChars to the target editable character budget when available.",
          docxMode
            ? "At least half of the operations should be replace_bullet, append_to_paragraph, or replace_paragraph_text unless the resume is already highly aligned."
            : "At least half of the operations should be replace_line or append_to_line unless the resume is already highly aligned.",
          "Do not return a near-identical resume when job-relevant supported changes are available.",
          docxMode
            ? "For role/project headers, never edit dates, locations, employers, schools, contact info, section headings, or divider lines."
            : "For append_to_line, replacement must be the complete updated line with all supported keywords naturally included.",
          docxMode
            ? "For date_locked_header paragraphs, replacement may contain only the editable leftText before the tab. Never include or alter rightText/date values, and stay within editableCharBudget."
            : "Use append_to_line for supported missing keywords in existing Skills, Coursework, Project, or Experience lines.",
          "For shorten operations, replacement must keep the same truth but reduce length.",
          "Use insert_bullet_after only when the resume has strong, job-relevant evidence and clear layout slack. Otherwise fold the detail into an existing related bullet or line.",
          "When inserting bullets, keep them concise and balance them with same-section shortening nearby.",
          "Prefer replace, append, insert, and shorten operations before using fontScale.",
          docxMode
            ? "DOCX physical removals are disallowed. If a low-priority line should change, return shorten_paragraph or replace_bullet instead."
            : "Plain-text removals are paired-only: use remove_low_priority_paragraph only as a last resort when added same-section replacements or inserted bullets create one-page space pressure.",
          "For any low-priority line, include a concise replacement whenever the line can be replaced or shortened instead of removed.",
          "Never remove contact info, section headings, divider lines, education identity, employers, dates, date rows, skills labels, or whole terminal sections like Projects, Certifications, Activities, Publications, or Leadership.",
          "For analyze mode, set tailoredResumeText to the original resume text unchanged.",
          docxMode
            ? "For generate mode in DOCX layout mode, tailoredResumeText is only a preview. The source of truth is editOperations tied to paragraph IDs."
            : "For generate mode, return a complete tailored resume draft by applying editOperations to the original resume text.",
          "For generate mode, the final resume must be apply-ready and visually consistent with the original.",
          "If the tailored resume needs more space, shorten less relevant lines and set layoutAdjustment.fontScale between 0.92 and 0.98.",
          "Do not convert the resume into long paragraphs. Keep bullets and concise resume lines.",
          "Do not add new sections unless the original resume already has that section.",
          "Do not rewrite headings, dates, school names, company names, locations, contact details, or section divider text.",
          "Return only valid JSON matching the schema."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          version: TAILOR_RESUME_VERSION,
          mode,
          job: {
            id: job.id,
            company: job.company,
            title: job.title,
            location: job.location,
            workType: job.workType,
            sponsorshipFriendly: job.sponsorshipFriendly,
            competitionLevel: job.competitionLevel,
            skills: job.skills,
            description: jobDescription
          },
          candidate: {
            resumeText,
            headline: profile.headline,
            lookingFor: profile.lookingFor,
            targetRoles: profile.targetRoles,
            education: profile.education,
            experienceFocus: profile.experienceFocus,
            strengths: profile.strengths,
            skills: profile.skills,
            roleEvidence: profile.roleEvidence,
            skillEvidence: profile.skillEvidence,
            educationEvidence: profile.educationEvidence,
            visaSponsorshipNeeded: profile.visaSponsorshipNeeded
          },
          resumeLayoutMap: resumeLayoutMap ? compactResumeLayoutMap(resumeLayoutMap) : null,
          outputGuidance: [
            "Score ATS/job tailoring readiness from 0 to 100.",
            "missingKeywords are job keywords supported by the job description but absent or weak in the resume.",
            "suggestedSkills must only include skills already supported by the resume/profile evidence.",
            docxMode
              ? "editOperations must reference resumeLayoutMap paragraph IDs. original should be the paragraph's editableText or text. replacement should be the complete edited editable text only."
              : "editOperations should include all necessary truthful changes. original should quote or closely paraphrase the existing line to change. replacement should be the complete updated line.",
            "Each operation should include priority, evidenceSource, targetKeywords, and keywords when supported.",
            docxMode
              ? "Use resumeLayoutMap metadata: include contentHash, fallbackParagraphIds, and maxChars from the selected paragraph when available."
              : "Use append_to_line for supported missing keywords in existing Skills, Coursework, Project, or Experience lines.",
            docxMode
              ? "Do not edit paragraphs whose role is contact_header, section_heading, divider, blank, or whose canEdit is false."
              : "Make a full pass through Skills, Education/Coursework, Experience, Projects, and every relevant existing section.",
            docxMode
              ? "Use append_to_paragraph for Skills/Coursework lines and preserve bold labels by keeping the same label text before the colon."
              : "Use shorten_line if added keywords or stronger wording makes the resume too long.",
            docxMode
              ? "Use replace_bullet for existing bullet paragraphs. Use insert_bullet_after only when there is clear layout slack; otherwise append the detail to a related existing bullet."
              : "Set layoutAdjustment.fontScale below 1 only when needed to preserve one-page fit after edits.",
            docxMode
              ? "Do not use remove_low_priority_paragraph for DOCX resumes. Use shorten_paragraph or replace_bullet instead."
              : "Use remove operations only if the original plain-text resume is too long after necessary additions.",
            "bulletRewrites should summarize the most important replace_line/append_to_line operations for the UI.",
            "atsNotes should be concise practical notes.",
            "Do not ignore job-critical missing keywords when they are supported by the resume.",
            docxMode
              ? "For generate mode, aim for 6-14 mapped operations. Trim anything that might create visual gaps or spacing inconsistency."
              : "For generate mode, aim for 6-14 mapped operations when evidence exists; if fewer than 6 edits are justified, explain why in atsNotes.",
            "The final resume draft must fit the original visual layout by keeping bullets concise, shortening low-priority lines, and using a small fontScale only when necessary."
          ]
        })
      }
    ]
  });

  return normalizeTailoredResumeResult(parsed, profile, mode, resumeLayoutMap);
}

function buildOriginalResumeResult(profile: CandidateProfile, note: string): TailoredResumeResult {
  return {
    score: 0,
    missingKeywords: [],
    suggestedSkills: [],
    editOperations: [],
    appliedChanges: [],
    skippedChanges: [],
    layoutAdjustment: {
      fontScale: 1,
      reason: "No layout adjustment applied."
    },
    docxEditStats: {
      appliedEdits: 0,
      insertedBullets: 0,
      removedLines: 0,
      skippedEdits: 0,
      validationStatus: "not_generated",
      fontScale: 1,
      warning: note
    },
    bulletRewrites: [],
    atsNotes: [note],
    tailoredResumeText: profile.resumeText || "",
    source: "original_resume",
    generatedAt: new Date().toISOString()
  };
}

function normalizeTailoredResumeResult(
  result: Partial<TailoredResumeResult>,
  profile: CandidateProfile,
  mode: "analyze" | "generate",
  resumeLayoutMap?: ResumeLayoutMap | null
): TailoredResumeResult {
  const originalResume = profile.resumeText || "";
  const rawTailoredResumeText =
    typeof result.tailoredResumeText === "string" && result.tailoredResumeText.trim()
      ? result.tailoredResumeText.trim()
      : originalResume;
  const editOperations = cleanEditOperations(result.editOperations, result.bulletRewrites, resumeLayoutMap);
  const requestedLayoutAdjustment = cleanRequestedLayoutAdjustment(result.layoutAdjustment);
  const appliedResult: ResumeApplyResult =
    mode === "generate" && resumeLayoutMap?.paragraphs.length
      ? applyLayoutMapEditOperations(resumeLayoutMap, editOperations, requestedLayoutAdjustment)
      : mode === "generate"
      ? applyPlainTextEditOperations(originalResume, editOperations)
      : {
          tailoredResumeText: originalResume,
          appliedChanges: [] as ResumeAppliedChange[],
          skippedChanges: [] as ResumeSkippedChange[]
        };
  const bulletRewrites = cleanBulletRewrites(result.bulletRewrites, editOperations);
  const layoutAdjustment = cleanLayoutAdjustment(result.layoutAdjustment, originalResume, appliedResult.tailoredResumeText, appliedResult.appliedChanges.length);
  const generatedTailoredResumeText =
    mode === "generate" &&
    appliedResult.appliedChanges.length === 0 &&
    normalizeForResumeMatch(rawTailoredResumeText) !== normalizeForResumeMatch(originalResume)
      ? rawTailoredResumeText
      : appliedResult.tailoredResumeText;
  const skippedChanges =
    mode === "generate"
      ? appliedResult.skippedChanges
      : editOperations.map((operation) => ({
          ...operation,
          skipReason: "Preview only. Generate to apply this change."
        }));
  const atsNotes = cleanArray(result.atsNotes, 5);
  if (mode === "generate" && editOperations.length < lightTailoringEditThreshold) {
    atsNotes.unshift("Gemini returned a light edit plan; only clearly supported changes were used.");
  }
  const docxEditStats =
    resumeLayoutMap?.paragraphs.length && mode === "generate"
      ? normalizeDocxPreviewStats(
          appliedResult.docxEditStats ?? summarizeDocxEditPlan(appliedResult.appliedChanges, skippedChanges, layoutAdjustment),
          layoutAdjustment
        )
      : undefined;
  if (docxEditStats?.warning) atsNotes.unshift(docxEditStats.warning);

  return {
    score: clampScore(result.score, 50),
    missingKeywords: cleanArray(result.missingKeywords, 10),
    suggestedSkills: cleanArray(result.suggestedSkills, 8),
    editOperations,
    appliedChanges: appliedResult.appliedChanges,
    skippedChanges,
    layoutAdjustment,
    docxEditStats,
    bulletRewrites,
    atsNotes: atsNotes.slice(0, 5),
    tailoredResumeText: mode === "analyze" ? originalResume : generatedTailoredResumeText || rawTailoredResumeText,
    source: "gemini",
    generatedAt: new Date().toISOString()
  };
}

function cleanEditOperations(
  editOperations: unknown,
  bulletRewrites: unknown,
  resumeLayoutMap?: ResumeLayoutMap | null
): ResumeEditOperation[] {
  const operations: ResumeEditOperation[] = Array.isArray(editOperations)
    ? editOperations
        .map((item): ResumeEditOperation | null => {
          if (!item || typeof item !== "object") return null;
          const record = item as {
            type?: unknown;
            paragraphId?: unknown;
            insertAfterParagraphId?: unknown;
            targetSection?: unknown;
            sectionName?: unknown;
            original?: unknown;
            replacement?: unknown;
            rewrite?: unknown;
            keywords?: unknown;
            priority?: unknown;
            evidenceSource?: unknown;
            targetKeywords?: unknown;
            fallbackParagraphIds?: unknown;
            contentHash?: unknown;
            maxChars?: unknown;
            reason?: unknown;
          };
          const type = cleanOperationType(record.type);
          const replacement = typeof record.replacement === "string" ? record.replacement : record.rewrite;
          if (!type || typeof record.original !== "string") return null;
          if (type !== "remove_low_priority_paragraph" && typeof replacement !== "string") return null;

          const operation: ResumeEditOperation = {
            type,
            original: limitText(record.original, 360),
            replacement: typeof replacement === "string" ? limitText(replacement, 520) : "",
            keywords: cleanArray(record.keywords, 8),
            priority: cleanOperationPriority(record.priority, type),
            evidenceSource:
              typeof record.evidenceSource === "string" ? limitText(record.evidenceSource, 180) : undefined,
            targetKeywords: cleanArray(record.targetKeywords, 10),
            fallbackParagraphIds: cleanArray(record.fallbackParagraphIds, 8).map((item) => limitText(item, 40)),
            contentHash: typeof record.contentHash === "string" ? limitText(record.contentHash, 40) : undefined,
            maxChars:
              typeof record.maxChars === "number" && Number.isFinite(record.maxChars)
                ? Math.max(24, Math.min(900, Math.round(record.maxChars)))
                : undefined,
            reason: typeof record.reason === "string" ? limitText(record.reason, 220) : "Improves alignment with the job."
          };
          if (typeof record.paragraphId === "string") operation.paragraphId = limitText(record.paragraphId, 40);
          if (typeof record.insertAfterParagraphId === "string") operation.insertAfterParagraphId = limitText(record.insertAfterParagraphId, 40);
          if (typeof record.targetSection === "string") operation.targetSection = limitText(record.targetSection, 80);
          if (typeof record.sectionName === "string") operation.sectionName = limitText(record.sectionName, 80);
          return operation;
        })
        .filter((item): item is ResumeEditOperation => Boolean(item))
    : [];

  if (operations.length) return prepareLayoutLockedEditOperations(dedupeEditOperations(operations), resumeLayoutMap);
  if (!Array.isArray(bulletRewrites)) return [];

  const fallbackOperations = bulletRewrites
      .map((item): ResumeEditOperation | null => {
        if (!item || typeof item !== "object") return null;
        const record = item as { original?: unknown; rewrite?: unknown; reason?: unknown };
        if (typeof record.original !== "string" || typeof record.rewrite !== "string") return null;

        return {
          type: "replace_line" as const,
          original: limitText(record.original, 360),
          replacement: limitText(record.rewrite, 420),
          keywords: [],
          priority: 3,
          reason: typeof record.reason === "string" ? limitText(record.reason, 180) : "Improves alignment with the job."
        };
      })
    .filter((item): item is ResumeEditOperation => Boolean(item));

  return prepareLayoutLockedEditOperations(dedupeEditOperations(fallbackOperations), resumeLayoutMap);
}

function prepareLayoutLockedEditOperations(operations: ResumeEditOperation[], resumeLayoutMap?: ResumeLayoutMap | null) {
  const layoutParagraphs = resumeLayoutMap?.paragraphs ?? [];
  const paragraphById = new Map(layoutParagraphs.map((paragraph) => [paragraph.id, paragraph]));
  if (!layoutParagraphs.length) return operations.sort(compareResumeEditOperations).slice(0, maxDocxLayoutLockedOperations);

  const insertionCounts = {
    total: 0,
    bySection: new Map<string, number>()
  };
  const hasInsertionSlack = hasClearDocxInsertionSlack(layoutParagraphs);

  return operations
    .map((operation) => enrichOperationWithLayoutMetadata(operation, layoutParagraphs, paragraphById))
    .filter((operation) => !layoutParagraphs.length || Boolean(resolveSafeLayoutOperationTarget(operation, layoutParagraphs, paragraphById)))
    .sort(compareResumeEditOperations)
    .map((operation) => normalizeLayoutLockedOperation(operation, layoutParagraphs, paragraphById, insertionCounts, hasInsertionSlack))
    .filter((operation): operation is ResumeEditOperation => Boolean(operation))
    .slice(0, maxDocxLayoutLockedOperations);
}

function normalizeLayoutLockedOperation(
  operation: ResumeEditOperation,
  paragraphs: ResumeLayoutMapParagraph[],
  paragraphById: Map<string, ResumeLayoutMapParagraph>,
  insertionCounts: { total: number; bySection: Map<string, number> },
  hasInsertionSlack: boolean
): ResumeEditOperation | null {
  const target = resolveSafeLayoutOperationTarget(operation, paragraphs, paragraphById);
  if (!target) return null;

  if (operation.type === "remove_low_priority_paragraph") {
    return convertLayoutRemovalToInPlaceOperation(operation, target) ?? operation;
  }

  if (operation.type === "insert_bullet_after") {
    const sectionKey = getLayoutPairingKey(target);
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
      return operation;
    }

    return convertLayoutInsertionToInPlaceOperation(operation, target, paragraphs, paragraphById) ?? operation;
  }

  return operation;
}

function convertLayoutRemovalToInPlaceOperation(
  operation: ResumeEditOperation,
  target: ResumeLayoutMapParagraph
): ResumeEditOperation | null {
  const replacement = operation.replacement.trim();
  if (!replacement || !target.canEdit) return null;

  const current = (target.editableText || target.leftText || target.text).trim();
  if (!current || normalizeForResumeMatch(replacement) === normalizeForResumeMatch(current)) return null;

  return {
    ...operation,
    type: replacement.length < current.length ? "shorten_paragraph" : target.isBullet ? "replace_bullet" : "replace_paragraph_text",
    paragraphId: target.id,
    insertAfterParagraphId: undefined,
    original: target.editableText || target.text || operation.original,
    replacement,
    reason: `${operation.reason} Converted from a removal to preserve layout.`
  };
}

function convertLayoutInsertionToInPlaceOperation(
  operation: ResumeEditOperation,
  target: ResumeLayoutMapParagraph,
  paragraphs: ResumeLayoutMapParagraph[],
  paragraphById: Map<string, ResumeLayoutMapParagraph>
): ResumeEditOperation | null {
  const foldTarget = findLayoutInsertionFoldTarget(target, operation, paragraphs, paragraphById);
  if (!foldTarget?.canEdit) return null;

  const current = (foldTarget.editableText || foldTarget.leftText || foldTarget.text).trim();
  const detail = stripResumeBulletPrefix(operation.replacement);
  if (!current || !detail) return null;

  const replacement = fitFoldedLayoutDetail(foldTarget, current, detail, operation.maxChars);
  if (!replacement || normalizeForResumeMatch(replacement) === normalizeForResumeMatch(current)) return null;

  return {
    ...operation,
    type: foldTarget.isBullet ? "replace_bullet" : "append_to_paragraph",
    paragraphId: foldTarget.id,
    insertAfterParagraphId: undefined,
    original: foldTarget.editableText || foldTarget.text,
    replacement,
    reason: `${operation.reason} Folded into an existing line to preserve layout.`
  };
}

function findLayoutInsertionFoldTarget(
  target: ResumeLayoutMapParagraph,
  operation: ResumeEditOperation,
  paragraphs: ResumeLayoutMapParagraph[],
  paragraphById: Map<string, ResumeLayoutMapParagraph>
) {
  const candidateIds = [
    target.id,
    ...(target.nearbyBulletIds ?? []),
    ...(target.fallbackIds ?? []),
    ...(operation.fallbackParagraphIds ?? [])
  ];

  for (const id of candidateIds) {
    const candidate = paragraphById.get(id);
    if (candidate?.canEdit && candidate.role !== "section_heading" && candidate.role !== "blank" && candidate.role !== "divider") {
      return candidate;
    }
  }

  return paragraphs.find((candidate) => {
    if (!candidate.canEdit) return false;
    if ((candidate.sectionName || "") !== (target.sectionName || "")) return false;
    return candidate.role === "bullet" || candidate.role === "body" || candidate.role === "skills_line";
  }) ?? null;
}

function fitFoldedLayoutDetail(
  paragraph: ResumeLayoutMapParagraph,
  current: string,
  detail: string,
  requestedMaxChars?: number
) {
  const layoutBudget = paragraph.maxReplacementChars ?? paragraph.editableCharBudget;
  const operationBudget =
    typeof requestedMaxChars === "number" && Number.isFinite(requestedMaxChars)
      ? Math.max(24, Math.min(900, Math.round(requestedMaxChars)))
      : undefined;
  const budget = layoutBudget && operationBudget ? Math.min(layoutBudget, operationBudget) : layoutBudget ?? operationBudget;
  const separator = /[.;:]$/.test(current) ? " " : "; ";
  const combined = `${current.replace(/\s+/g, " ").trim()}${separator}${detail.replace(/\s+/g, " ").trim()}`;
  if (!budget || combined.length <= budget) return combined;

  const available = budget - current.length - separator.length;
  if (available < 24) return "";
  const shortenedDetail = detail.slice(0, available).replace(/\s+\S*$/, "").trim();
  return shortenedDetail ? `${current}${separator}${shortenedDetail}` : "";
}

function stripResumeBulletPrefix(value: string) {
  return value.replace(/^\s*(?:[-*•●▪‣]\s*)?/, "").trim();
}

function hasClearDocxInsertionSlack(paragraphs: ResumeLayoutMapParagraph[]) {
  const meaningfulParagraphs = paragraphs.filter((paragraph) => paragraph.text.trim() && paragraph.role !== "blank" && paragraph.role !== "divider");
  const characterCount = meaningfulParagraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0);
  const bulletCount = meaningfulParagraphs.filter((paragraph) => paragraph.isBullet).length;
  return characterCount < 3000 && meaningfulParagraphs.length < 46 && bulletCount < 28;
}

function enrichOperationWithLayoutMetadata(
  operation: ResumeEditOperation,
  paragraphs: ResumeLayoutMapParagraph[],
  paragraphById: Map<string, ResumeLayoutMapParagraph>
): ResumeEditOperation {
  if (!paragraphs.length) return operation;

  const target = resolveSafeLayoutOperationTarget(operation, paragraphs, paragraphById);
  if (!target) return operation;

  const targetId = getOperationTargetId(operation);
  const isInsert = operation.type === "insert_bullet_after";
  const fallbackParagraphIds = Array.from(
    new Set([...(operation.fallbackParagraphIds ?? []), ...(target.fallbackIds ?? []), ...(target.insertAnchorIds ?? [])])
  ).slice(0, 8);
  const targetKeywords = operation.targetKeywords?.length ? operation.targetKeywords : operation.keywords;

  return {
    ...operation,
    paragraphId: !isInsert && !targetId ? target.id : operation.paragraphId,
    insertAfterParagraphId: isInsert && !operation.insertAfterParagraphId ? target.id : operation.insertAfterParagraphId,
    sectionName: operation.sectionName ?? target.sectionName,
    targetSection: operation.targetSection ?? target.sectionName,
    contentHash: operation.contentHash ?? target.contentHash,
    fallbackParagraphIds,
    targetKeywords,
    evidenceSource: operation.evidenceSource ?? buildEvidenceSourceLabel(target),
    maxChars: operation.maxChars ?? target.maxReplacementChars ?? target.editableCharBudget
  };
}

function resolveSafeLayoutOperationTarget(
  operation: ResumeEditOperation,
  paragraphs: ResumeLayoutMapParagraph[],
  paragraphById: Map<string, ResumeLayoutMapParagraph>
) {
  const targetIds = getCandidateLayoutTargetIds(operation);
  for (const id of targetIds) {
    const paragraph = paragraphById.get(id);
    if (paragraph && canUseLayoutParagraphForOperation(operation, paragraph)) return paragraph;
  }

  if (operation.contentHash) {
    const hashTarget = paragraphs.find((paragraph) => paragraph.contentHash === operation.contentHash);
    if (hashTarget && canUseLayoutParagraphForOperation(operation, hashTarget)) return hashTarget;
  }

  const semanticTarget = findSemanticLayoutTarget(operation, paragraphs);
  if (semanticTarget) return semanticTarget;

  const normalizedOriginal = normalizeForResumeMatch(operation.original);
  if (!normalizedOriginal) return null;

  let best: { paragraph: ResumeLayoutMapParagraph; score: number } | null = null;
  for (const paragraph of paragraphs) {
    if (!canUseLayoutParagraphForOperation(operation, paragraph)) continue;
    const score = getResumeMatchScore(normalizeForResumeMatch(paragraph.editableText || paragraph.text), normalizedOriginal, operation.targetSection);
    const threshold = operation.type === "append_to_line" || operation.type === "append_to_paragraph" ? 0.34 : 0.46;
    if (score >= threshold && (!best || score > best.score)) best = { paragraph, score };
  }

  return best?.paragraph ?? null;
}

function getCandidateLayoutTargetIds(operation: ResumeEditOperation) {
  return Array.from(
    new Set(
      [
        operation.type === "insert_bullet_after" ? operation.insertAfterParagraphId || operation.paragraphId : operation.paragraphId,
        operation.paragraphId,
        operation.insertAfterParagraphId,
        ...(operation.fallbackParagraphIds ?? [])
      ].filter(Boolean) as string[]
    )
  );
}

function getOperationTargetId(operation: ResumeEditOperation) {
  return operation.type === "insert_bullet_after" ? operation.insertAfterParagraphId || operation.paragraphId : operation.paragraphId;
}

function canUseLayoutParagraphForOperation(operation: ResumeEditOperation, paragraph: ResumeLayoutMapParagraph) {
  if (operation.type === "insert_bullet_after") return paragraph.canInsertAfter;
  if (operation.type === "remove_low_priority_paragraph") return paragraph.canEdit || paragraph.canRemove;
  if (!paragraph.canEdit || paragraph.role === "contact_header" || paragraph.role === "section_heading" || paragraph.role === "divider" || paragraph.role === "blank") {
    return false;
  }

  const safeOperations = paragraph.safeOperations ?? [];
  if (!safeOperations.length) return true;
  if (safeOperations.includes(operation.type)) return true;
  if (operation.type === "replace_line" && safeOperations.includes("replace_paragraph_text")) return true;
  if (operation.type === "replace_paragraph_text" && safeOperations.includes("replace_line")) return true;
  if (operation.type === "append_to_line" && safeOperations.includes("append_to_paragraph")) return true;
  if (operation.type === "append_to_paragraph" && safeOperations.includes("append_to_line")) return true;
  if (operation.type === "shorten_line" && safeOperations.includes("shorten_paragraph")) return true;
  if (operation.type === "shorten_paragraph" && safeOperations.includes("shorten_line")) return true;
  return false;
}

function findSemanticLayoutTarget(operation: ResumeEditOperation, paragraphs: ResumeLayoutMapParagraph[]) {
  const targetSection = normalizeForResumeMatch(operation.sectionName || operation.targetSection || "");
  const targetKeywords = (operation.targetKeywords?.length ? operation.targetKeywords : operation.keywords ?? [])
    .map(normalizeForResumeMatch)
    .filter(Boolean);
  if (!targetSection && !targetKeywords.length) return null;

  let best: { paragraph: ResumeLayoutMapParagraph; score: number } | null = null;
  for (const paragraph of paragraphs) {
    if (!canUseLayoutParagraphForOperation(operation, paragraph)) continue;
    const paragraphText = normalizeForResumeMatch(`${paragraph.sectionName ?? ""} ${paragraph.text}`);
    const sectionScore =
      targetSection && paragraph.sectionName && normalizeForResumeMatch(paragraph.sectionName).includes(targetSection) ? 0.32 : 0;
    const keywordScore = targetKeywords.some((keyword) => paragraphText.includes(keyword)) ? 0.22 : 0;
    const roleScore = getLayoutOperationRoleScore(operation, paragraph);
    const score = sectionScore + keywordScore + roleScore;
    if (score > 0.24 && (!best || score > best.score)) best = { paragraph, score };
  }

  return best?.paragraph ?? null;
}

function getLayoutOperationRoleScore(operation: ResumeEditOperation, paragraph: ResumeLayoutMapParagraph) {
  if (operation.type === "replace_bullet" && paragraph.role === "bullet") return 0.34;
  if ((operation.type === "append_to_line" || operation.type === "append_to_paragraph") && paragraph.role === "skills_line") return 0.34;
  if ((operation.type === "shorten_line" || operation.type === "shorten_paragraph") && paragraph.canEdit) return 0.22;
  if (operation.type === "insert_bullet_after" && paragraph.canInsertAfter) return 0.28;
  return paragraph.canEdit ? 0.08 : 0;
}

function buildEvidenceSourceLabel(paragraph: ResumeLayoutMapParagraph) {
  return paragraph.sectionName ? `Resume ${paragraph.sectionName} section` : `Resume ${paragraph.role.replace(/_/g, " ")}`;
}

function cleanOperationPriority(value: unknown, type: ResumeEditOperationType) {
  const fallback = type === "remove_low_priority_paragraph" ? 1 : type === "shorten_line" || type === "shorten_paragraph" ? 2 : 3;
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function compareResumeEditOperations(first: ResumeEditOperation, second: ResumeEditOperation) {
  const firstStage = getOperationApplyStage(first.type);
  const secondStage = getOperationApplyStage(second.type);
  if (firstStage !== secondStage) return firstStage - secondStage;

  const firstPriority = typeof first.priority === "number" ? first.priority : 3;
  const secondPriority = typeof second.priority === "number" ? second.priority : 3;
  if (firstPriority !== secondPriority) return secondPriority - firstPriority;

  const firstKeywordCount = (first.targetKeywords?.length ?? 0) + (first.keywords?.length ?? 0);
  const secondKeywordCount = (second.targetKeywords?.length ?? 0) + (second.keywords?.length ?? 0);
  if (firstKeywordCount !== secondKeywordCount) return secondKeywordCount - firstKeywordCount;

  return normalizeForResumeMatch(first.original).localeCompare(normalizeForResumeMatch(second.original));
}

function getOperationApplyStage(type: ResumeEditOperationType) {
  if (
    type === "replace_line" ||
    type === "replace_paragraph_text" ||
    type === "replace_bullet" ||
    type === "append_to_line" ||
    type === "append_to_paragraph"
  ) {
    return 1;
  }
  if (type === "insert_bullet_after") return 2;
  if (type === "shorten_line" || type === "shorten_paragraph") return 3;
  return 4;
}

function isPairingImprovementOperation(type: ResumeEditOperationType) {
  return (
    type === "replace_line" ||
    type === "append_to_line" ||
    type === "replace_paragraph_text" ||
    type === "append_to_paragraph" ||
    type === "replace_bullet" ||
    type === "insert_bullet_after"
  );
}

function incrementPairedImprovement(acceptedImprovementCounts: Map<string, number>, sectionKey: string) {
  acceptedImprovementCounts.set(sectionKey, (acceptedImprovementCounts.get(sectionKey) ?? 0) + 1);
}

function hasAvailablePairedImprovement(acceptedImprovementCounts: Map<string, number>, sectionKey: string) {
  return (acceptedImprovementCounts.get(sectionKey) ?? 0) > 0;
}

function consumePairedImprovement(acceptedImprovementCounts: Map<string, number>, sectionKey: string) {
  const count = acceptedImprovementCounts.get(sectionKey) ?? 0;
  if (count <= 0) return false;
  acceptedImprovementCounts.set(sectionKey, count - 1);
  return true;
}

function cleanOperationType(value: unknown): ResumeEditOperationType | null {
  if (value === "replace_line" || value === "append_to_line" || value === "shorten_line") return value;
  if (
    value === "replace_paragraph_text" ||
    value === "append_to_paragraph" ||
    value === "replace_bullet" ||
    value === "insert_bullet_after" ||
    value === "shorten_paragraph" ||
    value === "remove_low_priority_paragraph"
  ) {
    return value;
  }
  return null;
}

function dedupeEditOperations(operations: ResumeEditOperation[]) {
  const seen = new Set<string>();
  return operations.filter((operation) => {
    const key = `${operation.type}:${operation.paragraphId || operation.insertAfterParagraphId || normalizeForResumeMatch(operation.original)}:${normalizeForResumeMatch(operation.replacement)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const hasMappedTarget = Boolean(operation.paragraphId || operation.insertAfterParagraphId);
    const hasOriginal = normalizeForResumeMatch(operation.original).length >= 8;
    const hasReplacement =
      operation.type === "remove_low_priority_paragraph" || normalizeForResumeMatch(operation.replacement).length >= 4;
    return (hasMappedTarget || hasOriginal) && hasReplacement;
  });
}

function cleanBulletRewrites(value: unknown, operations: ResumeEditOperation[]): ResumeBulletRewrite[] {
  const fromModel = Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as { original?: unknown; rewrite?: unknown; reason?: unknown };
          if (typeof record.original !== "string" || typeof record.rewrite !== "string") return null;

          return {
            original: limitText(record.original, 260),
            rewrite: limitText(record.rewrite, 300),
            reason: typeof record.reason === "string" ? limitText(record.reason, 180) : "Improves alignment with the job."
          };
        })
        .filter((item): item is ResumeBulletRewrite => Boolean(item))
    : [];

  const summaries = fromModel.length
    ? fromModel
    : operations.map((operation) => ({
        original: limitText(operation.original, 260),
        rewrite: limitText(operation.replacement, 300),
        reason: operation.reason
      }));

  return summaries.slice(0, maxBulletRewriteSummaries);
}

function applyPlainTextEditOperations(originalResume: string, operations: ResumeEditOperation[]): ResumeApplyResult {
  if (!operations.length) {
    return {
      tailoredResumeText: originalResume,
      appliedChanges: [] as ResumeAppliedChange[],
      skippedChanges: [] as ResumeSkippedChange[]
    };
  }

  const lines = originalResume.split(/\n/);
  const usedLineIndexes = new Set<number>();
  const acceptedImprovementCounts = new Map<string, number>();
  const appliedChanges: ResumeAppliedChange[] = [];
  const skippedChanges: ResumeSkippedChange[] = [];

  operations.slice().sort(compareResumeEditOperations).forEach((operation) => {
    const match = findBestLineMatch(lines, operation, usedLineIndexes);
    if (!match) {
      skippedChanges.push({
        ...operation,
        skipReason: "Could not safely map this change to an existing resume line.",
        skipCategory: "mapping"
      });
      return;
    }

    const originalLine = lines[match.index];
    if (operation.type === "remove_low_priority_paragraph") {
      const converted = buildPlainTextRemovalReplacement(originalLine, operation);
      if (converted) {
        lines[match.index] = converted.text;
        usedLineIndexes.add(match.index);
        appliedChanges.push({
          ...operation,
          type: converted.type,
          matchedText: originalLine.trim(),
          repairNote: "Converted removal request to replacement."
        });
        if (converted.type !== "shorten_line") {
          recordAcceptedPlainTextImprovement(acceptedImprovementCounts, lines, match.index, operation);
        }
        return;
      }

      if (operation.replacement.trim()) {
        skippedChanges.push({
          ...operation,
          skipReason: "Removal replacement was empty or did not improve the matched line.",
          skipCategory: "content"
        });
        return;
      }

      const sectionKey = getPlainTextSectionKey(lines, match.index, operation);
      if (!hasAvailablePairedImprovement(acceptedImprovementCounts, sectionKey)) {
        skippedChanges.push({
          ...operation,
          skipReason: "Removal skipped because no stronger same-section edit was accepted to replace its space.",
          skipCategory: "unpaired_removal"
        });
        return;
      }

      if (!canRemovePlainTextLine(lines, match.index, operation)) {
        skippedChanges.push({
          ...operation,
          skipReason: "This line is protected from removal or needed to preserve resume structure.",
          skipCategory: "protected_layout"
        });
        return;
      }

      consumePairedImprovement(acceptedImprovementCounts, sectionKey);
      lines.splice(match.index, 1);
      shiftUsedLineIndexes(usedLineIndexes, match.index, -1);
      appliedChanges.push({
        ...operation,
        matchedText: originalLine.trim()
      });
      return;
    }

    if (operation.type === "insert_bullet_after") {
      lines.splice(match.index + 1, 0, preserveLinePrefix(originalLine, operation.replacement));
      shiftUsedLineIndexes(usedLineIndexes, match.index + 1, 1);
      appliedChanges.push({
        ...operation,
        matchedText: originalLine.trim()
      });
      recordAcceptedPlainTextImprovement(acceptedImprovementCounts, lines, match.index, operation);
      return;
    }

    const replacement = preserveLinePrefix(originalLine, operation.replacement);
    lines[match.index] = replacement;
    usedLineIndexes.add(match.index);
    appliedChanges.push({
      ...operation,
      matchedText: originalLine.trim()
    });
    if (isPairingImprovementOperation(operation.type)) {
      recordAcceptedPlainTextImprovement(acceptedImprovementCounts, lines, match.index, operation);
    }
  });

  return {
    tailoredResumeText: lines.join("\n"),
    appliedChanges,
    skippedChanges
  };
}

function buildPlainTextRemovalReplacement(
  originalLine: string,
  operation: ResumeEditOperation
): { text: string; type: "replace_line" | "shorten_line" } | null {
  const replacement = preserveLinePrefix(originalLine, operation.replacement);
  if (!replacement.trim()) return null;
  if (normalizeForResumeMatch(replacement) === normalizeForResumeMatch(originalLine)) return null;

  return {
    text: replacement,
    type: replacement.trim().length < originalLine.trim().length ? "shorten_line" : "replace_line"
  };
}

function recordAcceptedPlainTextImprovement(
  acceptedImprovementCounts: Map<string, number>,
  lines: string[],
  lineIndex: number,
  operation: ResumeEditOperation
) {
  const sectionKey = getPlainTextSectionKey(lines, lineIndex, operation);
  incrementPairedImprovement(acceptedImprovementCounts, sectionKey);
}

function getPlainTextSectionKey(lines: string[], lineIndex: number, operation?: ResumeEditOperation) {
  return normalizeForResumeMatch(getPlainTextSectionName(lines, lineIndex, operation) || "resume") || "resume";
}

function getPlainTextSectionName(lines: string[], lineIndex: number, operation?: ResumeEditOperation) {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const candidate = lines[index]?.trim() ?? "";
    if (isPlainTextSectionHeading(candidate)) return candidate;
  }
  return operation?.sectionName || operation?.targetSection || "resume";
}

function canRemovePlainTextLine(lines: string[], lineIndex: number, operation: ResumeEditOperation) {
  const line = lines[lineIndex]?.trim() ?? "";
  if (!line || isPlainTextSectionHeading(line) || isProtectedPlainTextLine(line)) return false;

  const sectionName = getPlainTextSectionName(lines, lineIndex, operation);
  if (isTerminalPlainTextSection(sectionName)) return false;

  const sectionKey = getPlainTextSectionKey(lines, lineIndex, operation);
  const peers = lines.filter((candidate, index) => {
    if (index === lineIndex) return false;
    const trimmed = candidate.trim();
    if (!trimmed || isPlainTextSectionHeading(trimmed) || isProtectedPlainTextLine(trimmed)) return false;
    return getPlainTextSectionKey(lines, index, operation) === sectionKey;
  });

  return peers.length > 0;
}

function isPlainTextSectionHeading(value: string) {
  const normalized = value.trim();
  if (!/^[A-Z][A-Z0-9/&+\-\s]{2,70}$/.test(normalized)) return false;
  if (isProtectedPlainTextLine(normalized)) return false;
  return normalized.split(/\s+/).length <= 7;
}

function isProtectedPlainTextLine(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/@|linkedin\.com|github\.com|\(\d{3}\)|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i.test(trimmed)) return true;
  if (
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b\d{4}\s*(?:-|–|—|to)\s*(?:present|\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4})\b|\b(?:present|current)\b/i.test(
      trimmed
    ) &&
    trimmed.length <= 120
  ) {
    return true;
  }
  return false;
}

function isTerminalPlainTextSection(value: string) {
  return /\b(PROJECTS?|CERTIFICATIONS?|PUBLICATIONS?|ACTIVITIES?|LEADERSHIP|INVOLVEMENT|AWARDS?|ORGANIZATIONS?|VOLUNTEER|ADDITIONAL)\b/i.test(
    value
  );
}

function shiftUsedLineIndexes(usedLineIndexes: Set<number>, startIndex: number, delta: number) {
  const shifted = Array.from(usedLineIndexes, (index) => {
    if (delta > 0 && index >= startIndex) return index + delta;
    if (delta < 0 && index > startIndex) return index + delta;
    return index;
  }).filter((index) => index >= 0);

  usedLineIndexes.clear();
  shifted.forEach((index) => usedLineIndexes.add(index));
}

function findBestLineMatch(
  lines: string[],
  operation: ResumeEditOperation,
  usedLineIndexes: Set<number>
): { index: number; score: number } | null {
  const normalizedOriginal = normalizeForResumeMatch(operation.original);
  if (normalizedOriginal.length < 8) return null;

  let best: { index: number; score: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (usedLineIndexes.has(index)) continue;
    const normalizedLine = normalizeForResumeMatch(line);
    if (!normalizedLine) continue;
    const score = getResumeMatchScore(normalizedLine, normalizedOriginal, operation.targetSection);
    if (!best || score > best.score) best = { index, score };
  }

  const threshold = operation.type === "append_to_line" ? 0.4 : 0.48;
  return best && best.score >= threshold ? best : null;
}

function getResumeMatchScore(normalizedLine: string, normalizedOriginal: string, targetSection?: string) {
  if (!normalizedLine || !normalizedOriginal) return 0;
  if (normalizedLine === normalizedOriginal) return 1;

  const containsScore = normalizedLine.includes(normalizedOriginal)
    ? Math.min(0.92, 0.58 + normalizedOriginal.length / Math.max(normalizedLine.length, 1) * 0.32)
    : 0;
  const reverseContainsScore = normalizedOriginal.includes(normalizedLine)
    ? Math.min(0.86, 0.52 + normalizedLine.length / Math.max(normalizedOriginal.length, 1) * 0.28)
    : 0;
  const tokenScore = getTokenDiceScore(normalizedLine, normalizedOriginal);
  const sectionBoost = targetSection && normalizedLine.includes(normalizeForResumeMatch(targetSection)) ? 0.06 : 0;

  return Math.min(1, Math.max(containsScore, reverseContainsScore, tokenScore) + sectionBoost);
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

function applyLayoutMapEditOperations(
  layoutMap: ResumeLayoutMap,
  operations: ResumeEditOperation[],
  requestedLayoutAdjustment: ResumeLayoutAdjustment
): ResumeApplyResult {
  const paragraphs = layoutMap.paragraphs.map((paragraph) => ({ ...paragraph }));
  const paragraphIndexById = new Map(paragraphs.map((paragraph, index) => [paragraph.id, index]));
  const appliedChanges: ResumeAppliedChange[] = [];
  const skippedChanges: ResumeSkippedChange[] = [];
  const stats = createPreviewDocxStats(requestedLayoutAdjustment);
  const acceptedImprovementCounts = new Map<string, number>();
  const insertionCounts = {
    total: 0,
    bySection: new Map<string, number>()
  };
  const hasInsertionSlack = hasClearDocxInsertionSlack(layoutMap.paragraphs);

  operations.slice().sort(compareResumeEditOperations).forEach((operation) => {
    const resolved = resolvePreviewOperationTarget(operation, paragraphs, paragraphIndexById);
    const index = typeof resolved?.index === "number" ? resolved.index : undefined;
    if (typeof index !== "number") {
      recordPreviewSkip(stats, skippedChanges, operation, "Could not map this edit to a safe DOCX paragraph.", "mapping");
      return;
    }
    const repaired = Boolean(resolved?.repaired);

    const paragraph = paragraphs[index];
    if (!paragraph) {
      recordPreviewSkip(stats, skippedChanges, operation, "The referenced DOCX paragraph was not found.", "mapping");
      return;
    }

    if (operation.type === "remove_low_priority_paragraph") {
      if (operation.replacement.trim()) {
        const converted = convertPreviewRemovalToReplacement(paragraph, operation);
        if (!converted) {
          recordPreviewSkip(stats, skippedChanges, operation, "Removal replacement was empty or could not safely edit this paragraph.", "content");
          return;
        }

        const originalText = paragraph.text.trim();
        paragraph.text = mergeEditablePreviewText(paragraph, converted.text);
        paragraph.editableText = converted.text;
        appliedChanges.push({
          ...operation,
          type: converted.type,
          matchedText: originalText,
          repairNote: "Converted removal request to replacement."
        });
        stats.appliedEdits += 1;
        stats.convertedEdits = (stats.convertedEdits ?? 0) + 1;
        if (converted.shortened) stats.shortenedEdits = (stats.shortenedEdits ?? 0) + 1;
        if (repaired) stats.repairedEdits = (stats.repairedEdits ?? 0) + 1;
        if (converted.type !== "shorten_paragraph") {
          recordAcceptedLayoutImprovement(acceptedImprovementCounts, paragraph);
        }
        return;
      }

      recordPreviewSkip(
        stats,
        skippedChanges,
        operation,
        "Removal skipped because DOCX layout lock does not allow physical line deletion.",
        "layout_locked_removal"
      );
      return;
    }

    if (operation.type === "insert_bullet_after") {
      const sectionKey = getLayoutPairingKey(paragraph);
      const sectionInsertions = insertionCounts.bySection.get(sectionKey) ?? 0;
      const canInsert =
        hasInsertionSlack &&
        insertionCounts.total < maxDocxLayoutLockedInsertions &&
        sectionInsertions < 1 &&
        paragraph.canInsertAfter &&
        Boolean(operation.replacement.trim());

      if (!canInsert) {
        const converted = convertLayoutInsertionToInPlaceOperation(
          operation,
          paragraph,
          paragraphs,
          new Map(paragraphs.map((candidate) => [candidate.id, candidate]))
        );
        const convertedResolved = converted ? resolvePreviewOperationTarget(converted, paragraphs, paragraphIndexById) : null;
        const convertedIndex = typeof convertedResolved?.index === "number" ? convertedResolved.index : undefined;
        const convertedParagraph = typeof convertedIndex === "number" ? paragraphs[convertedIndex] : null;

        if (!converted || !convertedParagraph?.canEdit) {
          recordPreviewSkip(
            stats,
            skippedChanges,
            operation,
            "Insertion skipped because there was not enough layout slack for a new bullet.",
            "unsafe_insertion"
          );
          return;
        }

        const replacement = fitPreviewReplacementToBudget(convertedParagraph, converted.replacement.trim(), converted.maxChars);
        if (!replacement.text) {
          recordPreviewSkip(stats, skippedChanges, operation, "Converted insertion was too long for the target line.", "visual_gap_risk");
          return;
        }

        const originalText = convertedParagraph.text.trim();
        convertedParagraph.text = mergeEditablePreviewText(convertedParagraph, replacement.text);
        convertedParagraph.editableText = replacement.text;
        appliedChanges.push({
          ...converted,
          matchedText: originalText,
          repairNote: "Converted insertion to in-place edit."
        });
        stats.appliedEdits += 1;
        stats.convertedEdits = (stats.convertedEdits ?? 0) + 1;
        if (replacement.shortened) {
          stats.autoShortenedEdits = (stats.autoShortenedEdits ?? 0) + 1;
          stats.shortenedEdits = (stats.shortenedEdits ?? 0) + 1;
        }
        if (convertedResolved?.repaired) stats.repairedEdits = (stats.repairedEdits ?? 0) + 1;
        recordAcceptedLayoutImprovement(acceptedImprovementCounts, convertedParagraph);
        return;
      }

      if (!paragraph.canInsertAfter || !operation.replacement.trim()) {
        recordPreviewSkip(stats, skippedChanges, operation, "This paragraph cannot safely receive an inserted bullet.", "protected_layout");
        return;
      }
      const inserted: ResumeLayoutMapParagraph = {
        ...paragraph,
        id: `${paragraph.id}-insert-${appliedChanges.length + 1}`,
        role: "bullet",
        text: preserveLinePrefix(paragraph.isBullet ? paragraph.text : "• ", operation.replacement),
        editableText: operation.replacement,
        lockedText: undefined,
        leftText: operation.replacement,
        rightText: undefined,
        hasTabStop: false,
        tabStopSignature: undefined,
        isTerminalSection: paragraph.isTerminalSection,
        editableCharBudget: paragraph.editableCharBudget,
        hasLockedDate: false,
        isBullet: true,
        canEdit: true,
        canInsertAfter: true,
        canRemove: true
      };
      paragraphs.splice(index + 1, 0, inserted);
      rebuildParagraphIndex(paragraphs, paragraphIndexById);
      appliedChanges.push({ ...operation, matchedText: paragraph.text.trim() });
      stats.insertedBullets += 1;
      if (repaired) stats.repairedEdits = (stats.repairedEdits ?? 0) + 1;
      insertionCounts.total += 1;
      insertionCounts.bySection.set(sectionKey, sectionInsertions + 1);
      recordAcceptedLayoutImprovement(acceptedImprovementCounts, paragraph);
      return;
    }

    if (!paragraph.canEdit) {
      recordPreviewSkip(stats, skippedChanges, operation, "This paragraph is protected from editing.", "protected_layout");
      return;
    }

    const replacement = fitPreviewReplacementToBudget(paragraph, operation.replacement.trim(), operation.maxChars);
    if (!replacement.text) {
      recordPreviewSkip(stats, skippedChanges, operation, "Replacement text was empty.", "content");
      return;
    }

    paragraph.text = mergeEditablePreviewText(paragraph, replacement.text);
    paragraph.editableText = replacement.text;
    appliedChanges.push({ ...operation, matchedText: paragraph.text.trim() });
    stats.appliedEdits += 1;
    if (isPairingImprovementOperation(operation.type)) {
      recordAcceptedLayoutImprovement(acceptedImprovementCounts, paragraph);
    }
    if (repaired) stats.repairedEdits = (stats.repairedEdits ?? 0) + 1;
    if (replacement.shortened) {
      stats.autoShortenedEdits = (stats.autoShortenedEdits ?? 0) + 1;
      stats.shortenedEdits = (stats.shortenedEdits ?? 0) + 1;
    } else if (operation.type === "shorten_line" || operation.type === "shorten_paragraph") {
      stats.shortenedEdits = (stats.shortenedEdits ?? 0) + 1;
    }
  });

  stats.skippedEdits = skippedChanges.length;
  const total = stats.appliedEdits + stats.insertedBullets + stats.removedLines;
  if (total < lightTailoringEditThreshold) {
    stats.warning = "Only a light tailoring was possible from resume-backed evidence.";
  }

  return {
    tailoredResumeText: paragraphs.map((paragraph) => paragraph.text).join("\n"),
    appliedChanges,
    skippedChanges,
    docxEditStats: stats
  };
}

function createPreviewDocxStats(layoutAdjustment: ResumeLayoutAdjustment): ResumeDocxEditStats {
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
    fontScale: layoutAdjustment.fontScale
  };
}

function resolvePreviewOperationTarget(
  operation: ResumeEditOperation,
  paragraphs: ResumeLayoutMapParagraph[],
  paragraphIndexById: Map<string, number>
): { index: number; repaired: boolean } | null {
  const directId = getOperationTargetId(operation);
  if (directId) {
    const directIndex = paragraphIndexById.get(directId);
    if (typeof directIndex === "number") {
      const directTarget = paragraphs[directIndex];
      if (directTarget && canUseLayoutParagraphForOperation(operation, directTarget)) return { index: directIndex, repaired: false };
    }
  }

  for (const id of getCandidateLayoutTargetIds(operation)) {
    const index = paragraphIndexById.get(id);
    if (typeof index !== "number") continue;
    const paragraph = paragraphs[index];
    if (paragraph && canUseLayoutParagraphForOperation(operation, paragraph)) return { index, repaired: true };
  }

  if (operation.contentHash) {
    const hashIndex = paragraphs.findIndex((paragraph) => paragraph.contentHash === operation.contentHash);
    const hashTarget = hashIndex >= 0 ? paragraphs[hashIndex] : null;
    if (hashTarget && canUseLayoutParagraphForOperation(operation, hashTarget)) return { index: hashIndex, repaired: true };
  }

  const semanticTarget = findSemanticLayoutTarget(operation, paragraphs);
  if (semanticTarget) {
    const index = paragraphs.findIndex((paragraph) => paragraph.id === semanticTarget.id);
    if (index >= 0) return { index, repaired: true };
  }

  return null;
}

function recordPreviewSkip(
  stats: ResumeDocxEditStats,
  skippedChanges: ResumeSkippedChange[],
  operation: ResumeEditOperation,
  skipReason: string,
  skipCategory: string
) {
  skippedChanges.push({ ...operation, skipReason, skipCategory });
  stats.skippedByReason = stats.skippedByReason ?? {};
  stats.skippedByReason[skipCategory] = (stats.skippedByReason[skipCategory] ?? 0) + 1;
}

function convertPreviewRemovalToReplacement(paragraph: ResumeLayoutMapParagraph, operation: ResumeEditOperation) {
  const current = (paragraph.editableText || paragraph.leftText || paragraph.text).trim();
  const replacement = operation.replacement.trim();
  if (!paragraph.canEdit || !current) return null;

  const fitted = fitPreviewReplacementToBudget(paragraph, replacement, operation.maxChars);
  if (!fitted.text || normalizeForResumeMatch(fitted.text) === normalizeForResumeMatch(current)) return null;

  return {
    text: fitted.text,
    type: fitted.text.length < current.length ? "shorten_paragraph" : paragraph.isBullet ? "replace_bullet" : "replace_paragraph_text",
    shortened: fitted.shortened || fitted.text.length < current.length
  } satisfies { text: string; type: "shorten_paragraph" | "replace_bullet" | "replace_paragraph_text"; shortened: boolean };
}

function recordAcceptedLayoutImprovement(acceptedImprovementCounts: Map<string, number>, paragraph: ResumeLayoutMapParagraph) {
  incrementPairedImprovement(acceptedImprovementCounts, getLayoutPairingKey(paragraph));
}

function getLayoutPairingKey(paragraph: ResumeLayoutMapParagraph) {
  return normalizeForResumeMatch(paragraph.sectionName || "resume") || "resume";
}

function rebuildParagraphIndex(paragraphs: ResumeLayoutMapParagraph[], paragraphIndexById: Map<string, number>) {
  paragraphIndexById.clear();
  paragraphs.forEach((paragraph, index) => paragraphIndexById.set(paragraph.id, index));
}

function estimateLayoutMapPressure(
  layoutMap: ResumeLayoutMap,
  operations: ResumeEditOperation[],
  requestedLayoutAdjustment: ResumeLayoutAdjustment
) {
  const paragraphById = new Map(layoutMap.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  let insertedBullets = 0;
  let positiveGrowth = 0;
  let shortening = 0;
  let hasShorteningOperation = false;

  operations.forEach((operation) => {
    const targetId = operation.type === "insert_bullet_after" ? operation.insertAfterParagraphId || operation.paragraphId : operation.paragraphId;
    const target = targetId ? paragraphById.get(targetId) : null;
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

  const originalCharacterCount = layoutMap.paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0);
  const originalParagraphCount = layoutMap.paragraphs.filter((paragraph) => paragraph.text.trim()).length;
  const denseOriginal = originalCharacterCount > 3600 || originalParagraphCount > 58;
  const hasMeaningfulAdds = insertedBullets > 0 || positiveGrowth > 160;
  const hasFitAttempt = requestedLayoutAdjustment.fontScale < 0.98 || hasShorteningOperation || shortening > 120;

  return hasMeaningfulAdds && hasFitAttempt && (denseOriginal || insertedBullets > 1 || positiveGrowth > 280);
}

function canRemoveLayoutParagraph(paragraph: ResumeLayoutMapParagraph, paragraphs: ResumeLayoutMapParagraph[]) {
  if (!paragraph.canRemove) return false;
  if (paragraph.role !== "bullet" && paragraph.role !== "activity_line") return false;
  if (paragraph.hasLockedDate || paragraph.hasTabStop || paragraph.isTerminalSection) return false;

  const section = paragraph.sectionName || "";
  const peers = paragraphs.filter((candidate) => {
    if (candidate.id === paragraph.id) return false;
    if ((candidate.sectionName || "") !== section) return false;
    if (candidate.role === "blank" || candidate.role === "divider" || candidate.role === "section_heading") return false;
    return Boolean(candidate.text.trim());
  });

  return peers.length > 0;
}

function fitPreviewReplacementToBudget(
  paragraph: ResumeLayoutMapParagraph,
  replacement: string,
  requestedMaxChars?: number
): PreviewReplacement {
  let safeReplacement = replacement.replace(/\s+/g, " ").trim();
  if (paragraph.role === "date_locked_header") {
    safeReplacement = safeReplacement.replace(/\t.*/, "").trim();
    if (paragraph.rightText) {
      safeReplacement = safeReplacement.replace(new RegExp(`${escapeRegExp(paragraph.rightText)}\\s*$`, "i"), "").trim();
    }
  }

  const layoutBudget = paragraph.maxReplacementChars ?? paragraph.editableCharBudget;
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

function mergeEditablePreviewText(paragraph: ResumeLayoutMapParagraph, replacement: string) {
  if (paragraph.role === "date_locked_header" && paragraph.rightText) {
    return `${replacement}\t${paragraph.rightText}`.trim();
  }
  if (!paragraph.lockedText) return preserveLinePrefix(paragraph.text, replacement);
  if (!paragraph.text.includes(paragraph.lockedText)) return preserveLinePrefix(paragraph.text, replacement);
  return paragraph.text.replace(paragraph.editableText || paragraph.text.replace(paragraph.lockedText, ""), replacement);
}

function summarizeDocxEditPlan(
  appliedChanges: ResumeAppliedChange[],
  skippedChanges: ResumeSkippedChange[],
  layoutAdjustment: ResumeLayoutAdjustment
): ResumeDocxEditStats {
  const insertedBullets = appliedChanges.filter((change) => change.type === "insert_bullet_after").length;
  const removedLines = appliedChanges.filter((change) => change.type === "remove_low_priority_paragraph").length;
  const appliedEdits = appliedChanges.length - insertedBullets - removedLines;
  const total = appliedEdits + insertedBullets + removedLines;
  const skippedByReason = skippedChanges.reduce<Record<string, number>>((accumulator, change) => {
    const key = change.skipCategory || "other";
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
  const shortenedEdits = appliedChanges.filter((change) => change.type === "shorten_line" || change.type === "shorten_paragraph").length;

  return {
    appliedEdits,
    insertedBullets,
    removedLines,
    skippedEdits: skippedChanges.length,
    repairedEdits: appliedChanges.filter((change) => Boolean(change.repairNote)).length,
    convertedEdits: appliedChanges.filter((change) => change.repairNote?.toLowerCase().includes("converted")).length,
    autoShortenedEdits: 0,
    shortenedEdits,
    skippedByReason,
    validationStatus: "not_generated",
    fontScale: layoutAdjustment.fontScale,
    warning: total < lightTailoringEditThreshold ? "Only a light tailoring was possible from resume-backed evidence." : undefined
  };
}

function normalizeDocxPreviewStats(stats: ResumeDocxEditStats, layoutAdjustment: ResumeLayoutAdjustment): ResumeDocxEditStats {
  const total = stats.appliedEdits + stats.insertedBullets + stats.removedLines;
  return {
    ...stats,
    skippedByReason: stats.skippedByReason ?? {},
    fontScale: layoutAdjustment.fontScale,
    warning: stats.warning ?? (total < lightTailoringEditThreshold ? "Only a light tailoring was possible from resume-backed evidence." : undefined)
  };
}

function cleanRequestedLayoutAdjustment(value: unknown): ResumeLayoutAdjustment {
  const record = value && typeof value === "object" ? (value as { fontScale?: unknown; reason?: unknown }) : null;
  const requestedScale = typeof record?.fontScale === "number" && Number.isFinite(record.fontScale) ? record.fontScale : 1;

  return {
    fontScale: Math.max(0.9, Math.min(1, requestedScale)),
    reason: typeof record?.reason === "string" && record.reason.trim() ? limitText(record.reason, 180) : "No layout adjustment applied."
  };
}

function cleanLayoutAdjustment(
  value: unknown,
  originalResume: string,
  tailoredResumeText: string,
  appliedChangeCount: number
): ResumeLayoutAdjustment {
  const record = value && typeof value === "object" ? (value as { fontScale?: unknown; reason?: unknown }) : null;
  const requestedScale = typeof record?.fontScale === "number" && Number.isFinite(record.fontScale) ? record.fontScale : 1;
  const growth = Math.max(0, tailoredResumeText.length - originalResume.length);
  const inferredScale = growth > 520 ? 0.92 : growth > 260 || appliedChangeCount > 8 ? 0.94 : growth > 120 || appliedChangeCount > 5 ? 0.96 : 1;
  const fontScale = Math.max(0.9, Math.min(1, Math.min(requestedScale, inferredScale)));

  return {
    fontScale,
    reason:
      typeof record?.reason === "string" && record.reason.trim()
        ? limitText(record.reason, 180)
        : fontScale < 1
          ? "Font size reduced slightly to preserve a one-page resume after tailoring."
          : "No layout adjustment applied."
  };
}

function preserveLinePrefix(originalLine: string, rewrite: string) {
  const prefix = originalLine.match(/^(\s*(?:[-*•]\s*)?)/)?.[1] ?? "";
  const cleanedRewrite = rewrite.replace(/^\s*(?:[-*•]\s*)?/, "").trim();
  return `${prefix}${cleanedRewrite}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForResumeMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/^section:\s*/i, "")
    .replace(/^[\-•*]\s*/, "")
    .replace(/[^\w+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    .map((item) => limitText(item, 160))
    .slice(0, maxItems);
}

function limitText(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trim()}...`;
}

function clampScore(value: unknown, fallback: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function cleanResumeLayoutMap(value: unknown): ResumeLayoutMap | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ResumeLayoutMap>;
  if (record.source !== "docx" || !Array.isArray(record.paragraphs)) return null;

  const paragraphs = record.paragraphs
    .map((item): ResumeLayoutMapParagraph | null => {
      if (!item || typeof item !== "object") return null;
      const paragraph = item as Partial<ResumeLayoutMapParagraph>;
      if (typeof paragraph.id !== "string" || typeof paragraph.text !== "string") return null;
      return {
        id: limitText(paragraph.id, 40),
        role: isResumeParagraphRole(paragraph.role) ? paragraph.role : "body",
        sectionName: typeof paragraph.sectionName === "string" ? limitText(paragraph.sectionName, 90) : undefined,
        text: limitText(paragraph.text, 900),
        editableText: typeof paragraph.editableText === "string" ? limitText(paragraph.editableText, 700) : "",
        lockedText: typeof paragraph.lockedText === "string" ? limitText(paragraph.lockedText, 120) : undefined,
        leftText: typeof paragraph.leftText === "string" ? limitText(paragraph.leftText, 500) : undefined,
        rightText: typeof paragraph.rightText === "string" ? limitText(paragraph.rightText, 160) : undefined,
        hasTabStop: Boolean(paragraph.hasTabStop),
        tabStopSignature: typeof paragraph.tabStopSignature === "string" ? limitText(paragraph.tabStopSignature, 220) : undefined,
        isTerminalSection: Boolean(paragraph.isTerminalSection),
        editableCharBudget:
          typeof paragraph.editableCharBudget === "number" && Number.isFinite(paragraph.editableCharBudget)
            ? Math.max(0, Math.min(900, Math.round(paragraph.editableCharBudget)))
            : undefined,
        contentHash: typeof paragraph.contentHash === "string" ? limitText(paragraph.contentHash, 40) : undefined,
        semanticTags: cleanArray(paragraph.semanticTags, 12),
        safeOperations: Array.isArray(paragraph.safeOperations)
          ? paragraph.safeOperations.filter((item): item is ResumeEditOperationType => Boolean(cleanOperationType(item)))
          : undefined,
        fallbackIds: cleanArray(paragraph.fallbackIds, 8).map((item) => limitText(item, 40)),
        insertAnchorIds: cleanArray(paragraph.insertAnchorIds, 8).map((item) => limitText(item, 40)),
        nearbyBulletIds: cleanArray(paragraph.nearbyBulletIds, 8).map((item) => limitText(item, 40)),
        maxReplacementChars:
          typeof paragraph.maxReplacementChars === "number" && Number.isFinite(paragraph.maxReplacementChars)
            ? Math.max(0, Math.min(900, Math.round(paragraph.maxReplacementChars)))
            : undefined,
        lockedRegions: cleanArray(paragraph.lockedRegions, 8),
        hasLockedDate: Boolean(paragraph.hasLockedDate),
        isBullet: Boolean(paragraph.isBullet),
        canEdit: Boolean(paragraph.canEdit),
        canInsertAfter: Boolean(paragraph.canInsertAfter),
        canRemove: Boolean(paragraph.canRemove)
      };
    })
    .filter((item): item is ResumeLayoutMapParagraph => Boolean(item))
    .slice(0, 180);

  if (!paragraphs.length) return null;
  return {
    source: "docx",
    paragraphs,
    sectionNames: cleanArray(record.sectionNames, 20),
    generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : new Date().toISOString()
  };
}

function isResumeParagraphRole(value: unknown): value is ResumeLayoutMapParagraph["role"] {
  return (
    value === "contact_header" ||
    value === "section_heading" ||
    value === "divider" ||
    value === "education_line" ||
    value === "skills_line" ||
    value === "role_header" ||
    value === "date_locked_header" ||
    value === "bullet" ||
    value === "activity_line" ||
    value === "blank" ||
    value === "body"
  );
}

function compactResumeLayoutMap(layoutMap: ResumeLayoutMap) {
  return {
    source: layoutMap.source,
    sectionNames: layoutMap.sectionNames,
    paragraphs: layoutMap.paragraphs
      .filter((paragraph) => paragraph.role !== "blank" && paragraph.role !== "divider")
      .map((paragraph) => ({
        id: paragraph.id,
        role: paragraph.role,
        sectionName: paragraph.sectionName,
        text: paragraph.role === "date_locked_header" ? paragraph.leftText || paragraph.editableText || paragraph.text : paragraph.text,
        editableText: paragraph.editableText,
        lockedText: paragraph.lockedText,
        leftText: paragraph.leftText,
        rightText: paragraph.rightText,
        hasTabStop: paragraph.hasTabStop,
        tabStopSignature: paragraph.tabStopSignature,
        isTerminalSection: paragraph.isTerminalSection,
        editableCharBudget: paragraph.editableCharBudget,
        contentHash: paragraph.contentHash,
        semanticTags: paragraph.semanticTags,
        safeOperations: paragraph.safeOperations,
        fallbackIds: paragraph.fallbackIds,
        insertAnchorIds: paragraph.insertAnchorIds,
        nearbyBulletIds: paragraph.nearbyBulletIds,
        maxReplacementChars: paragraph.maxReplacementChars,
        lockedRegions: paragraph.lockedRegions,
        hasLockedDate: paragraph.hasLockedDate,
        isBullet: paragraph.isBullet,
        canEdit: paragraph.canEdit,
        canInsertAfter: paragraph.canInsertAfter,
        canRemove: paragraph.canRemove
      }))
      .slice(0, 140)
  };
}

async function loadServerResumeLayoutMap(profile: CandidateProfile): Promise<ResumeLayoutMap | null> {
  const document = profile.resumeDocument;
  if (!document?.exactLayoutSupported || !document.storagePath || document.storagePath.startsWith("indexeddb://")) return null;

  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) return null;
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user || !document.storagePath.startsWith(`${user.id}/`)) return null;
    const { data, error } = await supabase.storage.from("resumes").download(document.storagePath);
    if (error || !data) return null;

    return createResumeLayoutMapFromDocx(Buffer.from(await data.arrayBuffer()));
  } catch (error) {
    console.warn("Could not build server DOCX layout map for tailoring.", error);
    return null;
  }
}

function isCandidateProfile(value: unknown): value is CandidateProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<CandidateProfile>;
  return (
    typeof profile.resumeText === "string" &&
    Array.isArray(profile.targetRoles) &&
    typeof profile.visaSponsorshipNeeded === "boolean" &&
    typeof profile.lookingFor === "string"
  );
}

const tailoredResumeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "score",
    "missingKeywords",
    "suggestedSkills",
    "editOperations",
    "layoutAdjustment",
    "bulletRewrites",
    "atsNotes",
    "tailoredResumeText"
  ],
  properties: {
    score: {
      type: "number",
      minimum: 0,
      maximum: 100
    },
    missingKeywords: {
      type: "array",
      maxItems: 10,
      items: { type: "string" }
    },
    suggestedSkills: {
      type: "array",
      maxItems: 8,
      items: { type: "string" }
    },
    editOperations: {
      type: "array",
      maxItems: maxGeneratedEditOperations,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "original", "replacement", "reason"],
        properties: {
          type: {
            type: "string",
            enum: [
              "replace_line",
              "append_to_line",
              "shorten_line",
              "replace_paragraph_text",
              "append_to_paragraph",
              "replace_bullet",
              "insert_bullet_after",
              "shorten_paragraph",
              "remove_low_priority_paragraph"
            ]
          },
          paragraphId: { type: "string" },
          insertAfterParagraphId: { type: "string" },
          targetSection: { type: "string" },
          sectionName: { type: "string" },
          original: { type: "string" },
          replacement: { type: "string" },
          keywords: {
            type: "array",
            maxItems: 8,
            items: { type: "string" }
          },
          priority: {
            type: "number",
            minimum: 1,
            maximum: 5
          },
          evidenceSource: { type: "string" },
          targetKeywords: {
            type: "array",
            maxItems: 10,
            items: { type: "string" }
          },
          fallbackParagraphIds: {
            type: "array",
            maxItems: 8,
            items: { type: "string" }
          },
          contentHash: { type: "string" },
          maxChars: {
            type: "number",
            minimum: 24,
            maximum: 900
          },
          reason: { type: "string" }
        }
      }
    },
    layoutAdjustment: {
      type: "object",
      additionalProperties: false,
      required: ["fontScale", "reason"],
      properties: {
        fontScale: {
          type: "number",
          minimum: 0.9,
          maximum: 1
        },
        reason: { type: "string" }
      }
    },
    bulletRewrites: {
      type: "array",
      maxItems: maxBulletRewriteSummaries,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original", "rewrite", "reason"],
        properties: {
          original: { type: "string" },
          rewrite: { type: "string" },
          reason: { type: "string" }
        }
      }
    },
    atsNotes: {
      type: "array",
      maxItems: 5,
      items: { type: "string" }
    },
    tailoredResumeText: { type: "string" }
  }
};
