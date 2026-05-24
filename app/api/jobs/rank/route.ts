import { NextResponse } from "next/server";
import { DASHBOARD_MATCH_VERSION } from "@/lib/ai-versions";
import { prepareResumeForAi, stableTextHash } from "@/lib/ai-text";
import { getJobs } from "@/lib/jobs";
import { callOpenRouterJson } from "@/lib/openrouter";
import { getJobProfileAlignment } from "@/lib/role-taxonomy";
import type { AiDashboardJobMatch, CandidateProfile, Job, SignalConfidence } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxInputJobs = 200;
const maxDashboardJobs = 50;
const maxResumeChars = 12000;
const dashboardRankCache = new Map<string, AiDashboardJobMatch[]>();

type RankRequest = {
  jobIds?: unknown;
  profile?: unknown;
};

type RawDashboardRankResponse = {
  matches?: Partial<InternalDashboardJobMatch>[];
};

type InternalDashboardJobMatch = AiDashboardJobMatch & {
  score: number;
};

export async function POST(request: Request) {
  try {
    const { jobIds, profile } = (await request.json()) as RankRequest;

    if (!isCandidateProfile(profile)) {
      return NextResponse.json({ error: "Candidate profile is required." }, { status: 400 });
    }

    const requestedIds = normalizeJobIds(jobIds);
    if (!requestedIds.length) {
      return NextResponse.json({ matches: [] });
    }

    const jobs = await resolveJobsById(requestedIds);
    if (!jobs.length) {
      return NextResponse.json({ matches: [] });
    }

    const cacheKey = getDashboardRankCacheKey(profile, jobs.map((job) => job.id));
    const cachedMatches = dashboardRankCache.get(cacheKey);
    if (cachedMatches) return NextResponse.json({ matches: cachedMatches });

    const matches = await rankJobsWithOpenRouter(jobs, profile);
    dashboardRankCache.set(cacheKey, matches);
    return NextResponse.json({ matches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not rank jobs.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function resolveJobsById(jobIds: string[]) {
  const jobs = await getJobs();
  const byId = new Map(jobs.map((job) => [job.id, job]));
  return jobIds.map((jobId) => byId.get(jobId)).filter((job): job is Job => Boolean(job));
}

async function rankJobsWithOpenRouter(jobs: Job[], profile: CandidateProfile): Promise<AiDashboardJobMatch[]> {
  const parsed = await callOpenRouterJson<RawDashboardRankResponse>({
    task: "match",
    maxTokens: 5200,
    timeoutMs: 32000,
    schemaName: "dashboard_job_ranking",
    schema: dashboardRankSchema,
    messages: [
      {
        role: "system",
        content: [
          "You are Stealth's evidence-first dashboard ranking analyst.",
          "Rank a shortlist of jobs against one candidate using only the supplied resume/profile, search preference, sponsorship preference, and job data.",
          "Select and return as many qualified student-first matches as possible, up to 50 total.",
          "Prefer internships, co-ops, university or student programs, new grad roles, early career roles, rotational or development programs, and entry-level analyst roles.",
          "If the candidate is looking for Internship, prioritize internship, co-op, student, university, seasonal internship, and campus-program roles.",
          "If the candidate is looking for Full-time job, prioritize new grad, entry-level, early career, rotational, development program, and associate analyst roles.",
          "Exclude or score very low any job requiring 2+ years of professional experience unless the job title or description clearly says intern, co-op, student, university, new grad, early career, rotational program, or development program.",
          "Prioritize role/category alignment above generic shared tools.",
          "Python, SQL, Excel, Tableau, or analytics are supporting evidence only; they cannot make an unrelated role a top match.",
          "For supply chain, procurement, logistics, inventory, demand planning, forecasting, or operations resumes, pure software, ML, data science, or PhD roles must score low unless the job itself contains supply chain, logistics, procurement, inventory, planning, or operations context.",
          "For software resumes, software internships can rank high only when the resume contains real software evidence such as APIs, backend, frontend, full-stack, React, Node, GitHub, deployed apps, Java, C++, or product engineering projects.",
          "Missing or weak evidence belongs in riskFlags, not matchedSignals.",
          "Use score only to order the response internally; it will not be shown to the user.",
          "Keep reason to one concise evidence-backed sentence.",
          "Return only valid JSON matching the schema."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          version: DASHBOARD_MATCH_VERSION,
          candidate: {
            resumeText: prepareResumeForAi(profile.resumeText || "", maxResumeChars),
            headline: profile.headline,
            lookingFor: profile.lookingFor,
            visaSponsorshipNeeded: profile.visaSponsorshipNeeded,
            targetRoles: profile.targetRoles,
            skills: profile.skills,
            strengths: profile.strengths,
            experienceFocus: profile.experienceFocus,
            roleEvidence: profile.roleEvidence,
            skillEvidence: profile.skillEvidence,
            educationEvidence: profile.educationEvidence,
            confidenceNotes: profile.confidenceNotes
          },
          jobs: jobs.map((job) => {
            const alignment = getJobProfileAlignment(job, profile);
            return {
              id: job.id,
              company: job.company,
              title: job.title,
              location: job.location,
              workType: job.workType,
              postedDate: job.postedDate,
              sponsorshipFriendly: job.sponsorshipFriendly,
              competitionLevel: job.competitionLevel,
              skills: job.skills,
              description: job.description,
              studentSignals: getStudentSignals(job),
              experienceRequirementWarning: getExperienceRequirementWarning(job),
              deterministicRoleAlignment: {
                candidateDirection: alignment.category.label,
                tier: alignment.tier
              }
            };
          }),
          outputRules: [
            "Score 85-100 only for clear role match plus strong resume evidence.",
            "Score 65-84 for reasonable matches with some missing evidence.",
            "Score 35-64 for adjacent roles or weak evidence.",
            "Score below 35 for role-category mismatch even if generic skills overlap.",
            "Return the strongest available qualified jobs up to the maximum; do not stop early unless remaining jobs are clearly irrelevant or experience-heavy.",
            "Any role with experienceRequirementWarning should appear only if it also has strong studentSignals and a clear role fit.",
            "Confidence is high only when resume evidence and job description are both specific."
          ]
        })
      }
    ]
  });

  return normalizeAiMatches(parsed.matches, jobs).slice(0, maxDashboardJobs);
}

function normalizeAiMatches(value: unknown, jobs: Job[]) {
  if (!Array.isArray(value)) return [];

  const validJobIds = new Set(jobs.map((job) => job.id));
  const seen = new Set<string>();
  const matches: InternalDashboardJobMatch[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Partial<InternalDashboardJobMatch>;
    if (typeof record.jobId !== "string" || !validJobIds.has(record.jobId) || seen.has(record.jobId)) continue;

    const reason = typeof record.reason === "string" && record.reason.trim() ? limitSentence(record.reason.trim()) : "";
    if (!reason) continue;

    matches.push({
      jobId: record.jobId,
      score: clampScore(record.score, 0),
      confidence: normalizeConfidence(record.confidence, "low"),
      reason,
      matchedSignals: cleanStringArray(record.matchedSignals, [], 4),
      riskFlags: cleanStringArray(record.riskFlags, [], 4),
      source: "openrouter"
    });
    seen.add(record.jobId);
  }

  return matches
    .sort((a, b) => b.score - a.score || jobs.findIndex((job) => job.id === a.jobId) - jobs.findIndex((job) => job.id === b.jobId))
    .map(({ score: _score, ...match }) => match);
}

function normalizeJobIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return [...new Set(ids)].slice(0, maxInputJobs);
}

function getDashboardRankCacheKey(profile: CandidateProfile, jobIds: string[]) {
  const profileHash = stableTextHash(
    JSON.stringify({
      version: DASHBOARD_MATCH_VERSION,
      resumeText: profile.resumeText,
      headline: profile.headline,
      targetRoles: profile.targetRoles,
      skills: profile.skills,
      roleEvidence: profile.roleEvidence,
      skillEvidence: profile.skillEvidence,
      experienceFocus: profile.experienceFocus,
      visaSponsorshipNeeded: profile.visaSponsorshipNeeded,
      lookingFor: profile.lookingFor
    })
  );
  return `${DASHBOARD_MATCH_VERSION}:${profileHash}:${stableTextHash(jobIds.join("|"))}`;
}

function cleanStringArray(value: unknown, fallback: string[], maxItems: number) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => limitSentence(item.trim()))
    .filter(Boolean);
  const unique = [...new Set(cleaned)].slice(0, maxItems);
  return unique.length ? unique : fallback;
}

function normalizeConfidence(value: unknown, fallback: SignalConfidence): SignalConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return fallback;
}

function clampScore(value: unknown, fallback: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function limitSentence(value: string) {
  return value.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.slice(0, 1).join(" ") ?? value.slice(0, 160);
}

function getStudentSignals(job: Job) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  return [
    "intern",
    "internship",
    "co-op",
    "co op",
    "student",
    "university",
    "campus",
    "new grad",
    "new graduate",
    "early career",
    "early talent",
    "graduate program",
    "rotational",
    "development program",
    "entry level",
    "entry-level",
    "associate analyst"
  ].filter((signal) => text.includes(signal));
}

function getExperienceRequirementWarning(job: Job) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  const protectedText = text.replace(/\b0\s*-\s*[2-9]\s+years?\b/g, "0 years").replace(/\b0\s+to\s+[2-9]\s+years?\b/g, "0 years");
  const match =
    protectedText.match(/\b(?:minimum|min|at least|required|requires|requirement)\s+(?:of\s+)?(?:[2-9]|[1-9]\d)\+?\s+years?\b.{0,90}\bexperience\b/i) ??
    protectedText.match(/\b(?:[2-9]|[1-9]\d)\+?\s+years?\s+(?:of\s+)?(?:professional\s+|relevant\s+|work\s+|industry\s+)?experience\b/i) ??
    protectedText.match(/\bexperience\s+(?:of|with)\s+(?:[2-9]|[1-9]\d)\+?\s+years?\b/i);
  return match?.[0]?.replace(/\s+/g, " ").trim() ?? "";
}

function isCandidateProfile(value: unknown): value is CandidateProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<CandidateProfile>;
  return (
    Array.isArray(profile.skills) &&
    Array.isArray(profile.targetRoles) &&
    typeof profile.visaSponsorshipNeeded === "boolean" &&
    typeof profile.lookingFor === "string"
  );
}

const dashboardRankSchema = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: {
      type: "array",
      maxItems: maxDashboardJobs,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["jobId", "score", "confidence", "reason", "matchedSignals", "riskFlags"],
        properties: {
          jobId: { type: "string" },
          score: {
            type: "number",
            minimum: 0,
            maximum: 100
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"]
          },
          reason: { type: "string" },
          matchedSignals: {
            type: "array",
            maxItems: 4,
            items: { type: "string" }
          },
          riskFlags: {
            type: "array",
            maxItems: 4,
            items: { type: "string" }
          }
        }
      }
    }
  }
};
