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
    maxTokens: 5200,
    timeoutMs: 32000,
    schemaName: "job_specific_resume_tailoring",
    schema: tailoredResumeSchema,
    messages: [
      {
        role: "system",
        content: [
          "You are Stealth's evidence-first resume tailoring assistant.",
          "Tailor one resume to one job using only the supplied original resume, extracted profile, and job description.",
          "Act as an aggressive but truthful resume editor, not a layout designer.",
          "Keep the original resume structure, section order, headings, dates, contact block, margins, and layout intent.",
          "Preserve the original line-break style, section labels, section order, and compact resume density.",
          "Make every necessary truthful change for this specific job.",
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
            ? "Use only these DOCX operations: replace_paragraph_text, append_to_paragraph, replace_bullet, insert_bullet_after, shorten_paragraph, remove_low_priority_paragraph."
            : "Use editOperations for the actual changes: replace_line, append_to_line, or shorten_line.",
          docxMode
            ? "Every DOCX operation must reference paragraphId, except insert_bullet_after may use insertAfterParagraphId."
            : "Each text operation original should quote or closely paraphrase an existing resume line.",
          "For generate mode, return 8 to 14 useful editOperations when the resume has enough evidence for the job.",
          docxMode
            ? "At least half of the operations should be replace_bullet, append_to_paragraph, or replace_paragraph_text unless the resume is already highly aligned."
            : "At least half of the operations should be replace_line or append_to_line unless the resume is already highly aligned.",
          "Do not return a near-identical resume when job-relevant supported changes are available.",
          docxMode
            ? "For role/project headers, never edit dates, locations, employers, schools, contact info, section headings, or divider lines."
            : "For append_to_line, replacement must be the complete updated line with all supported keywords naturally included.",
          "For shorten operations, replacement must keep the same truth but reduce length.",
          "Use insert_bullet_after only to add a short resume-backed bullet under an existing role/project, cloning that section's bullet style.",
          "Use remove_low_priority_paragraph only for optional bullets or activity lines that are less relevant and safe to remove.",
          "For analyze mode, set tailoredResumeText to the original resume text unchanged.",
          docxMode
            ? "For generate mode in DOCX layout mode, tailoredResumeText is only a preview. The source of truth is editOperations tied to paragraph IDs."
            : "For generate mode, return a complete tailored resume draft by applying editOperations to the original resume text.",
          "For generate mode, the final resume must be one page only. Keep only the most relevant existing content if the original resume is longer.",
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
            docxMode
              ? "Do not edit paragraphs whose role is contact_header, section_heading, divider, blank, or whose canEdit is false."
              : "Use append_to_line for supported missing keywords in existing Skills, Coursework, Project, or Experience lines.",
            docxMode
              ? "Use append_to_paragraph for Skills/Coursework lines and preserve bold labels by keeping the same label text before the colon."
              : "Use shorten_line if added keywords or stronger wording makes the resume too long.",
            docxMode
              ? "Use replace_bullet for existing bullet paragraphs and insert_bullet_after only near related existing bullets."
              : "Set layoutAdjustment.fontScale below 1 only when needed to preserve one-page fit after edits.",
            "bulletRewrites should summarize the most important replace_line/append_to_line operations for the UI.",
            "atsNotes should be concise practical notes.",
            "Do not ignore job-critical missing keywords when they are supported by the resume.",
            "For generate mode, aim for 6-12 mapped operations; if fewer than 4 edits are justified, explain why in atsNotes.",
            "The final resume draft must fit one page by keeping bullets concise, shortening low-priority lines, and using a small fontScale when necessary."
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
  const editOperations = cleanEditOperations(result.editOperations, result.bulletRewrites);
  const appliedResult =
    mode === "generate" && resumeLayoutMap?.paragraphs.length
      ? applyLayoutMapEditOperations(resumeLayoutMap, editOperations)
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
  if (mode === "generate" && editOperations.length < 4) {
    atsNotes.unshift("Gemini returned a light edit plan; only clearly supported changes were used.");
  }
  const docxEditStats =
    resumeLayoutMap?.paragraphs.length && mode === "generate"
      ? summarizeDocxEditPlan(appliedResult.appliedChanges, skippedChanges, layoutAdjustment)
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

function cleanEditOperations(editOperations: unknown, bulletRewrites: unknown): ResumeEditOperation[] {
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

  if (operations.length) return dedupeEditOperations(operations).slice(0, 16);
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
          reason: typeof record.reason === "string" ? limitText(record.reason, 180) : "Improves alignment with the job."
        };
      })
    .filter((item): item is ResumeEditOperation => Boolean(item));

  return dedupeEditOperations(fallbackOperations).slice(0, 16);
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

  return summaries.slice(0, 8);
}

function applyPlainTextEditOperations(originalResume: string, operations: ResumeEditOperation[]) {
  if (!operations.length) {
    return {
      tailoredResumeText: originalResume,
      appliedChanges: [] as ResumeAppliedChange[],
      skippedChanges: [] as ResumeSkippedChange[]
    };
  }

  const lines = originalResume.split(/\n/);
  const usedLineIndexes = new Set<number>();
  const appliedChanges: ResumeAppliedChange[] = [];
  const skippedChanges: ResumeSkippedChange[] = [];

  operations.forEach((operation) => {
    const match = findBestLineMatch(lines, operation, usedLineIndexes);
    if (!match) {
      skippedChanges.push({
        ...operation,
        skipReason: "Could not safely map this change to an existing resume line."
      });
      return;
    }

    const originalLine = lines[match.index];
    if (operation.type === "remove_low_priority_paragraph") {
      lines.splice(match.index, 1);
      appliedChanges.push({
        ...operation,
        matchedText: originalLine.trim()
      });
      return;
    }

    if (operation.type === "insert_bullet_after") {
      lines.splice(match.index + 1, 0, preserveLinePrefix(originalLine, operation.replacement));
      appliedChanges.push({
        ...operation,
        matchedText: originalLine.trim()
      });
      return;
    }

    const replacement = preserveLinePrefix(originalLine, operation.replacement);
    lines[match.index] = replacement;
    usedLineIndexes.add(match.index);
    appliedChanges.push({
      ...operation,
      matchedText: originalLine.trim()
    });
  });

  return {
    tailoredResumeText: lines.join("\n"),
    appliedChanges,
    skippedChanges
  };
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

function applyLayoutMapEditOperations(layoutMap: ResumeLayoutMap, operations: ResumeEditOperation[]) {
  const paragraphs = layoutMap.paragraphs.map((paragraph) => ({ ...paragraph }));
  const paragraphIndexById = new Map(paragraphs.map((paragraph, index) => [paragraph.id, index]));
  const appliedChanges: ResumeAppliedChange[] = [];
  const skippedChanges: ResumeSkippedChange[] = [];

  operations.forEach((operation) => {
    const targetId = operation.type === "insert_bullet_after" ? operation.insertAfterParagraphId || operation.paragraphId : operation.paragraphId;
    const index = targetId ? paragraphIndexById.get(targetId) : undefined;
    if (typeof index !== "number") {
      skippedChanges.push({ ...operation, skipReason: "Could not map this edit to a DOCX paragraph ID." });
      return;
    }

    const paragraph = paragraphs[index];
    if (!paragraph) {
      skippedChanges.push({ ...operation, skipReason: "The referenced DOCX paragraph was not found." });
      return;
    }

    if (operation.type === "remove_low_priority_paragraph") {
      if (!paragraph.canRemove) {
        skippedChanges.push({ ...operation, skipReason: "This paragraph is protected from removal." });
        return;
      }
      paragraphs.splice(index, 1);
      rebuildParagraphIndex(paragraphs, paragraphIndexById);
      appliedChanges.push({ ...operation, matchedText: paragraph.text.trim() });
      return;
    }

    if (operation.type === "insert_bullet_after") {
      if (!paragraph.canInsertAfter || !operation.replacement.trim()) {
        skippedChanges.push({ ...operation, skipReason: "This paragraph cannot safely receive an inserted bullet." });
        return;
      }
      const inserted: ResumeLayoutMapParagraph = {
        ...paragraph,
        id: `${paragraph.id}-insert-${appliedChanges.length + 1}`,
        role: "bullet",
        text: preserveLinePrefix(paragraph.isBullet ? paragraph.text : "• ", operation.replacement),
        editableText: operation.replacement,
        lockedText: undefined,
        hasLockedDate: false,
        isBullet: true,
        canEdit: true,
        canInsertAfter: true,
        canRemove: true
      };
      paragraphs.splice(index + 1, 0, inserted);
      rebuildParagraphIndex(paragraphs, paragraphIndexById);
      appliedChanges.push({ ...operation, matchedText: paragraph.text.trim() });
      return;
    }

    if (!paragraph.canEdit) {
      skippedChanges.push({ ...operation, skipReason: "This paragraph is protected from editing." });
      return;
    }

    const replacement = operation.replacement.trim();
    if (!replacement) {
      skippedChanges.push({ ...operation, skipReason: "Replacement text was empty." });
      return;
    }

    paragraph.text = mergeEditablePreviewText(paragraph, replacement);
    paragraph.editableText = replacement;
    appliedChanges.push({ ...operation, matchedText: paragraph.text.trim() });
  });

  return {
    tailoredResumeText: paragraphs.map((paragraph) => paragraph.text).join("\n"),
    appliedChanges,
    skippedChanges
  };
}

function rebuildParagraphIndex(paragraphs: ResumeLayoutMapParagraph[], paragraphIndexById: Map<string, number>) {
  paragraphIndexById.clear();
  paragraphs.forEach((paragraph, index) => paragraphIndexById.set(paragraph.id, index));
}

function mergeEditablePreviewText(paragraph: ResumeLayoutMapParagraph, replacement: string) {
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

  return {
    appliedEdits,
    insertedBullets,
    removedLines,
    skippedEdits: skippedChanges.length,
    validationStatus: "not_generated",
    fontScale: layoutAdjustment.fontScale,
    warning: total < 4 ? "Only a light tailoring was possible from resume-backed evidence." : undefined
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
        text: paragraph.text,
        editableText: paragraph.editableText,
        lockedText: paragraph.lockedText,
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
      maxItems: 24,
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
      maxItems: 8,
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
