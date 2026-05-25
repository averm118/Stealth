import { NextResponse } from "next/server";
import { TAILOR_RESUME_VERSION } from "@/lib/ai-versions";
import { prepareResumeForAi } from "@/lib/ai-text";
import { callGeminiJson } from "@/lib/gemini";
import { getJobById } from "@/lib/jobs";
import type { CandidateProfile, Job, TailoredResumeResult } from "@/lib/types";

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
          "Keep the original resume structure and section order.",
          "Only update or rewrite what is necessary for this specific job.",
          "Rewrite honestly without inventing experience.",
          "Do not invent employers, tools, metrics, degrees, projects, dates, certifications, responsibilities, visa facts, or job requirements.",
          "Add keywords naturally only where the original resume or profile evidence supports them.",
          "Improve ATS alignment while keeping formatting professional and concise.",
          "Highlight relevant projects and skills already present in the uploaded resume/profile.",
          "Preserve the candidate's actual experience level and work authorization signals.",
          "For analyze mode, set tailoredResumeText to the original resume text unchanged.",
          "For generate mode, return a complete tailored resume draft that preserves the original structure as much as possible.",
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
            "bulletRewrites must preserve truth: original should be an exact or close resume line, rewrite should be a better job-aligned version, reason should explain the keyword or clarity improvement.",
            "atsNotes should be concise practical notes.",
            "Do not rewrite every bullet. Only recommend high-impact changes."
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
  const tailoredResumeText =
    typeof result.tailoredResumeText === "string" && result.tailoredResumeText.trim()
      ? result.tailoredResumeText.trim()
      : originalResume;

  return {
    score: clampScore(result.score, 50),
    missingKeywords: cleanArray(result.missingKeywords, 10),
    suggestedSkills: cleanArray(result.suggestedSkills, 8),
    bulletRewrites: cleanBulletRewrites(result.bulletRewrites),
    atsNotes: cleanArray(result.atsNotes, 5),
    tailoredResumeText: mode === "analyze" ? originalResume : tailoredResumeText,
    source: "gemini",
    generatedAt: new Date().toISOString()
  };
}

function cleanBulletRewrites(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
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
    .filter((item): item is { original: string; rewrite: string; reason: string } => Boolean(item))
    .slice(0, 6);
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
    bulletRewrites: {
      type: "array",
      maxItems: 6,
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
