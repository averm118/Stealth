import { NextResponse } from "next/server";
import { TAILOR_RESUME_VERSION } from "@/lib/ai-versions";
import { prepareResumeForAi } from "@/lib/ai-text";
import { callGeminiJson } from "@/lib/gemini";
import { getJobById } from "@/lib/jobs";
import type {
  CandidateProfile,
  Job,
  ResumeAppliedChange,
  ResumeBulletRewrite,
  ResumeEditOperation,
  ResumeEditOperationType,
  ResumeLayoutAdjustment,
  ResumeSkippedChange,
  TailoredResumeResult
} from "@/lib/types";

export const runtime = "nodejs";

const maxResumeChars = 36000;
const maxJobDescriptionChars = 42000;

export async function POST(request: Request) {
  try {
    const { jobId, profile, mode } = (await request.json()) as {
      jobId?: unknown;
      profile?: unknown;
      mode?: unknown;
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
      const result = await tailorResumeWithGemini(job, profile, mode);
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
  mode: "analyze" | "generate"
): Promise<TailoredResumeResult> {
  const resumeText = prepareResumeForAi(profile.resumeText, maxResumeChars);
  const jobDescription = prepareResumeForAi(job.description, maxJobDescriptionChars);

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
          "Rewrite honestly without inventing experience.",
          "Do not invent employers, tools, metrics, degrees, projects, dates, certifications, responsibilities, visa facts, or job requirements.",
          "Add missing job keywords naturally when the original resume, coursework, projects, or profile evidence supports them.",
          "If a keyword is only coursework or beginner exposure, represent it honestly as coursework or exposure.",
          "Improve ATS alignment while keeping formatting professional and concise.",
          "Highlight relevant projects and skills already present in the uploaded resume/profile.",
          "Preserve the candidate's actual experience level and work authorization signals.",
          "Use editOperations for the actual changes: replace_line, append_to_line, or shorten_line.",
          "For append_to_line, replacement must be the complete updated line with all supported keywords naturally included.",
          "For shorten_line, replacement must keep the same truth but reduce length.",
          "For analyze mode, set tailoredResumeText to the original resume text unchanged.",
          "For generate mode, return a complete tailored resume draft by applying editOperations to the original resume text.",
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
          outputGuidance: [
            "Score ATS/job tailoring readiness from 0 to 100.",
            "missingKeywords are job keywords supported by the job description but absent or weak in the resume.",
            "suggestedSkills must only include skills already supported by the resume/profile evidence.",
            "editOperations should include all necessary truthful changes. original should quote or closely paraphrase the existing line to change. replacement should be the complete updated line.",
            "Use append_to_line for supported missing keywords in existing Skills, Coursework, Project, or Experience lines.",
            "Use shorten_line if added keywords or stronger wording makes the resume too long.",
            "Set layoutAdjustment.fontScale below 1 only when needed to preserve one-page fit after edits.",
            "bulletRewrites should summarize the most important replace_line/append_to_line operations for the UI.",
            "atsNotes should be concise practical notes.",
            "Do not ignore job-critical missing keywords when they are supported by the resume.",
            "The final resume draft must fit one page by keeping bullets concise, shortening low-priority lines, and using a small fontScale when necessary."
          ]
        })
      }
    ]
  });

  return normalizeTailoredResumeResult(parsed, profile, mode);
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
  mode: "analyze" | "generate"
): TailoredResumeResult {
  const originalResume = profile.resumeText || "";
  const rawTailoredResumeText =
    typeof result.tailoredResumeText === "string" && result.tailoredResumeText.trim()
      ? result.tailoredResumeText.trim()
      : originalResume;
  const editOperations = cleanEditOperations(result.editOperations, result.bulletRewrites);
  const appliedResult =
    mode === "generate"
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

  return {
    score: clampScore(result.score, 50),
    missingKeywords: cleanArray(result.missingKeywords, 10),
    suggestedSkills: cleanArray(result.suggestedSkills, 8),
    editOperations,
    appliedChanges: appliedResult.appliedChanges,
    skippedChanges,
    layoutAdjustment,
    bulletRewrites,
    atsNotes: cleanArray(result.atsNotes, 5),
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
            targetSection?: unknown;
            original?: unknown;
            replacement?: unknown;
            rewrite?: unknown;
            keywords?: unknown;
            reason?: unknown;
          };
          const type = cleanOperationType(record.type);
          const replacement = typeof record.replacement === "string" ? record.replacement : record.rewrite;
          if (!type || typeof record.original !== "string" || typeof replacement !== "string") return null;

          const operation: ResumeEditOperation = {
            type,
            original: limitText(record.original, 360),
            replacement: limitText(replacement, 420),
            keywords: cleanArray(record.keywords, 8),
            reason: typeof record.reason === "string" ? limitText(record.reason, 220) : "Improves alignment with the job."
          };
          if (typeof record.targetSection === "string") operation.targetSection = limitText(record.targetSection, 80);
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
  return null;
}

function dedupeEditOperations(operations: ResumeEditOperation[]) {
  const seen = new Set<string>();
  return operations.filter((operation) => {
    const key = `${operation.type}:${normalizeForResumeMatch(operation.original)}:${normalizeForResumeMatch(operation.replacement)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return normalizeForResumeMatch(operation.original).length >= 8 && normalizeForResumeMatch(operation.replacement).length >= 6;
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
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "original", "replacement", "reason"],
        properties: {
          type: {
            type: "string",
            enum: ["replace_line", "append_to_line", "shorten_line"]
          },
          targetSection: { type: "string" },
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
