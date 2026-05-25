import { NextResponse } from "next/server";
import { COVER_LETTER_VERSION } from "@/lib/ai-versions";
import { prepareResumeForAi } from "@/lib/ai-text";
import { callGeminiJson } from "@/lib/gemini";
import { getJobById } from "@/lib/jobs";
import type { CandidateProfile, CoverLetterResult, Job } from "@/lib/types";

export const runtime = "nodejs";

const maxResumeChars = 36000;
const maxJobDescriptionChars = 42000;

export async function POST(request: Request) {
  try {
    const { jobId, profile } = (await request.json()) as {
      jobId?: unknown;
      profile?: unknown;
    };

    if (typeof jobId !== "string") {
      return NextResponse.json({ error: "Job id is required." }, { status: 400 });
    }

    if (!isCandidateProfile(profile)) {
      return NextResponse.json({ error: "Candidate profile is required." }, { status: 400 });
    }

    const job = await getJobById(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    if (!profile.resumeText?.trim()) {
      return NextResponse.json({ error: "Upload a resume before creating a cover letter." }, { status: 400 });
    }

    const result = await generateCoverLetterWithGemini(job, profile);
    return NextResponse.json({ result });
  } catch (error) {
    console.warn("Gemini cover letter generation failed.", error);
    return NextResponse.json({ error: "Cover letter generation failed. Please try again." }, { status: 500 });
  }
}

async function generateCoverLetterWithGemini(job: Job, profile: CandidateProfile): Promise<CoverLetterResult> {
  const resumeText = prepareResumeForAi(profile.resumeText, maxResumeChars);
  const jobDescription = prepareResumeForAi(job.description, maxJobDescriptionChars);

  const parsed = await callGeminiJson<Partial<CoverLetterResult>>({
    task: "cover_letter",
    maxTokens: 3200,
    timeoutMs: 30000,
    schemaName: "job_specific_cover_letter",
    schema: coverLetterSchema,
    messages: [
      {
        role: "system",
        content: [
          "You are Stealth's evidence-first cover letter assistant.",
          "Write one human, professional cover letter for one job using only the supplied resume, extracted profile, and job description.",
          "Use proper business letter format with date, hiring team greeting, concise body paragraphs, closing, and signature.",
          "Default length should be 250 to 350 words.",
          "Sound warm, specific, natural, and student-friendly, not robotic or exaggerated.",
          "Avoid generic opening phrases like 'I am writing to express my interest' when possible.",
          "Do not invent employers, tools, metrics, dates, degrees, certifications, responsibilities, visa facts, or job requirements.",
          "Connect two or three resume-backed strengths, projects, or experiences to the role.",
          "If the resume lacks a detail, omit it instead of guessing.",
          "Return only valid JSON matching the schema."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          version: COVER_LETTER_VERSION,
          today: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
          }),
          job: {
            id: job.id,
            company: job.company,
            title: job.title,
            location: job.location,
            workType: job.workType,
            sponsorshipFriendly: job.sponsorshipFriendly,
            competitionLevel: job.competitionLevel,
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
            "Score cover letter readiness from 0 to 100 based on how directly the resume can support this letter.",
            "talkingPoints should be concise resume-backed points to emphasize.",
            "toneNotes should explain how the letter stays human, specific, and appropriate for this role.",
            "coverLetterText must be a complete formatted cover letter."
          ]
        })
      }
    ]
  });

  return normalizeCoverLetterResult(parsed);
}

function normalizeCoverLetterResult(result: Partial<CoverLetterResult>): CoverLetterResult {
  const coverLetterText = typeof result.coverLetterText === "string" ? result.coverLetterText.trim() : "";
  if (!coverLetterText) throw new Error("Gemini returned an empty cover letter.");

  return {
    score: clampScore(result.score, 70),
    talkingPoints: cleanArray(result.talkingPoints, 5),
    toneNotes: cleanArray(result.toneNotes, 4),
    coverLetterText,
    source: "gemini",
    generatedAt: new Date().toISOString()
  };
}

function cleanArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    .map((item) => limitText(item, 180))
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

const coverLetterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "talkingPoints", "toneNotes", "coverLetterText"],
  properties: {
    score: {
      type: "number",
      minimum: 0,
      maximum: 100
    },
    talkingPoints: {
      type: "array",
      maxItems: 5,
      items: { type: "string" }
    },
    toneNotes: {
      type: "array",
      maxItems: 4,
      items: { type: "string" }
    },
    coverLetterText: { type: "string" }
  }
};
