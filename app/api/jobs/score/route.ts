import { NextResponse } from "next/server";
import { JOB_MATCH_VERSION } from "@/lib/ai-versions";
import { prepareResumeForAi, stableTextHash } from "@/lib/ai-text";
import { scoreJob } from "@/lib/scoring";
import { getJobById } from "@/lib/jobs";
import { callGeminiJson } from "@/lib/gemini";
import { getJobProfileAlignment } from "@/lib/role-taxonomy";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  AiJobAnalysis,
  CandidateProfile,
  Job,
  ScoreBreakdown,
  ScoreBreakdownFactor,
  SignalConfidence
} from "@/lib/types";

export const runtime = "nodejs";

const maxResumeChars = 32000;
const jobAnalysisCache = new Map<string, AiJobAnalysis>();

const factorKeys = [
  "skillFit",
  "roleFit",
  "projectEvidence",
  "sponsorshipFit",
  "competitionReadiness"
] as const satisfies readonly (keyof ScoreBreakdown)[];

const factorWeights = {
  skillFit: 0.35,
  roleFit: 0.2,
  projectEvidence: 0.2,
  sponsorshipFit: 0.15,
  competitionReadiness: 0.1
} satisfies Record<keyof ScoreBreakdown, number>;

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

    try {
      const cacheKey = getJobAnalysisCacheKey(job.id, profile);
      const cachedAnalysis = jobAnalysisCache.get(cacheKey);
      if (cachedAnalysis) return NextResponse.json({ analysis: cachedAnalysis });

      const analysis = await scoreJobWithGemini(job, profile);
      jobAnalysisCache.set(cacheKey, analysis);
      await persistMatchScore(job.id, profile, analysis);
      return NextResponse.json({ analysis });
    } catch (error) {
      console.warn("Gemini job scoring failed; using local fallback.", error);
      const analysis = buildFallbackAnalysis(job, profile);
      await persistMatchScore(job.id, profile, analysis);
      return NextResponse.json({ analysis });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not score this job.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function persistMatchScore(jobId: string, profile: CandidateProfile, analysis: AiJobAnalysis) {
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) return;

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) return;

    await supabase.from("match_scores").upsert({
      user_id: user.id,
      job_id: jobId,
      profile_hash: hashProfile(profile),
      analysis,
      source: analysis.source
    });
  } catch (error) {
    console.warn("Could not persist match score.", error);
  }
}

function hashProfile(profile: CandidateProfile) {
  return stableTextHash(
    JSON.stringify({
      version: JOB_MATCH_VERSION,
      resumeText: profile.resumeText,
      headline: profile.headline,
      targetRoles: profile.targetRoles,
      skills: profile.skills,
      strengths: profile.strengths,
      roleEvidence: profile.roleEvidence,
      skillEvidence: profile.skillEvidence,
      educationEvidence: profile.educationEvidence,
      experienceFocus: profile.experienceFocus,
      visaSponsorshipNeeded: profile.visaSponsorshipNeeded,
      lookingFor: profile.lookingFor
    })
  );
}

function getJobAnalysisCacheKey(jobId: string, profile: CandidateProfile) {
  return `${JOB_MATCH_VERSION}:${jobId}:${hashProfile(profile)}`;
}

async function scoreJobWithGemini(job: Job, profile: CandidateProfile): Promise<AiJobAnalysis> {
  const resumeText = prepareResumeForAi(profile.resumeText || "", maxResumeChars);
  const alignment = getJobProfileAlignment(job, profile);
  const parsed = await callGeminiJson<Partial<AiJobAnalysis>>({
    task: "match",
    maxTokens: 3200,
    schemaName: "resume_job_compatibility",
    schema: aiJobAnalysisSchema,
    messages: [
      {
        role: "system",
        content: [
          "You are Stealth's evidence-first resume-to-job compatibility analyst.",
          "Score one job against one candidate using only the supplied resume text, extracted profile, search preferences, and job data.",
          "Do not invent skills, projects, employers, education, visa facts, or job requirements.",
          "If evidence is absent or weak, put it in gaps instead of treating it as a match.",
          "Generic shared tools like Python, SQL, Excel, and Tableau cannot override a role-category mismatch.",
          "Use exact strings from job.skills for matchedSkills and missingSkills.",
          "Score each rubric factor from 0 to 100. The server recomputes the final score from these factors and may cap unrelated roles.",
          "Rubric weights: skillFit 35%, roleFit 20%, projectEvidence 20%, sponsorshipFit 15%, competitionReadiness 10%.",
          "matchedEvidence must cite resume-backed facts or cautious paraphrases from the provided profile evidence.",
          "jobHighlights must summarize the important job-description pointers only: responsibilities, required qualifications, tools, role scope, and constraints.",
          "Do not include generic company boilerplate, benefits, equal opportunity language, or marketing copy in jobHighlights.",
          "applicationStrategy must be 1-2 concise sentences.",
          "Return only valid JSON matching the schema."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          version: JOB_MATCH_VERSION,
          candidate: {
            resumeText,
            profile: getScoringProfile(profile)
          },
          job,
          deterministicRoleAlignment: {
            candidateDirection: alignment.category.label,
            tier: alignment.tier,
            note:
              alignment.tier === "core"
                ? "Job category is a core match to the extracted resume direction."
                : "Server-side validator will cap scores if the model overstates this role alignment."
          },
          scoringGuidance: {
            skillFit: "Direct resume-backed overlap between resume skills/evidence and job.skills.",
            roleFit: "Alignment between lookingFor, target roles, profile headline, evidence fields, and job title/category.",
            projectEvidence: "Concrete resume projects, work, education, or outcomes that support this role.",
            sponsorshipFit: "Fit between candidate visa need and job sponsorship friendliness.",
            competitionReadiness: "How ready the candidate appears for this role given competition level and evidence depth."
          },
          trustRules: [
            "Prefer role-category evidence over generic skill overlap.",
            "If the resume is supply chain or operations oriented, do not score pure software roles highly from Python/SQL alone.",
            "If a job skill is not clearly present in the resume/profile evidence, list it as missing.",
            "If the resume or job text is thin, lower confidence and explain the limitation.",
            "Use the full job.description to create jobHighlights, but keep each highlight concise and scannable."
          ]
        })
      }
    ]
  });
  return normalizeAiAnalysis(parsed, job, profile, "gemini");
}

function buildFallbackAnalysis(job: Job, profile: CandidateProfile): AiJobAnalysis {
  const deterministic = scoreJob(job, profile);
  const scoreBreakdown = enforceRoleAlignmentCaps(buildFallbackBreakdown(job, profile, deterministic), job, profile);
  const score = calculateWeightedScore(scoreBreakdown);
  const missingSkills = deterministic.missingSkills.length ? deterministic.missingSkills : job.skills.slice(0, 3);
  const matchedEvidence = deterministic.matchedSkills.length
    ? deterministic.matchedSkills.map((skill) => `${skill} appears in the extracted profile.`)
    : ["No direct role-skill evidence was found in the extracted profile."];

  return {
    score,
    matchedSkills: deterministic.matchedSkills,
    missingSkills,
    why: [
      deterministic.matchedSkills.length
        ? `The profile overlaps with ${deterministic.matchedSkills.slice(0, 3).join(", ")}.`
        : "This is a cautious fallback score based on limited extracted profile overlap.",
      deterministic.why[1],
      profile.visaSponsorshipNeeded
        ? `${job.company} is marked ${job.sponsorshipFriendly} for sponsorship friendliness.`
        : "Visa sponsorship is not weighted heavily for the current profile."
    ].filter(Boolean),
    suggestedKeywords: deterministic.suggestedKeywords.length
      ? deterministic.suggestedKeywords
      : [...new Set([...missingSkills, ...job.skills])].slice(0, 6),
    scoreBreakdown,
    confidence: deterministic.matchedSkills.length >= 3 ? "medium" : "low",
    matchedEvidence,
    gaps: buildFallbackGaps(job, profile, missingSkills),
    jobHighlights: buildFallbackJobHighlights(job),
    applicationStrategy: buildFallbackStrategy(job, profile, deterministic.matchedSkills, missingSkills),
    source: "local_fallback",
    generatedAt: new Date().toISOString()
  };
}

function normalizeAiAnalysis(
  analysis: Partial<AiJobAnalysis>,
  job: Job,
  profile: CandidateProfile,
  source: AiJobAnalysis["source"]
): AiJobAnalysis {
  const fallback = buildFallbackAnalysis(job, profile);
  const scoreBreakdown = normalizeBreakdown(analysis.scoreBreakdown, fallback.scoreBreakdown);
  const matchedSkills = normalizeJobSkillArray(analysis.matchedSkills, job, fallback.matchedSkills, 8);
  const missingSkills = normalizeJobSkillArray(analysis.missingSkills, job, fallback.missingSkills, 8);
  const validatedBreakdown = enforceRoleAlignmentCaps(scoreBreakdown, job, profile);
  const score = calculateWeightedScore(validatedBreakdown);
  const confidence = normalizeConfidence(analysis.confidence, fallback.confidence);

  return {
    score,
    matchedSkills,
    missingSkills,
    why: cleanArray(analysis.why, fallback.why, 4).map(limitSentence),
    suggestedKeywords: cleanArray(analysis.suggestedKeywords, fallback.suggestedKeywords, 8),
    scoreBreakdown: validatedBreakdown,
    confidence: downgradeConfidenceForWeakEvidence(confidence, job, profile),
    matchedEvidence: cleanArray(analysis.matchedEvidence, fallback.matchedEvidence, 5).map(limitSentence),
    gaps: cleanArray(analysis.gaps, fallback.gaps, 5).map(limitSentence),
    jobHighlights: cleanArray(analysis.jobHighlights, fallback.jobHighlights, 6).map(limitSentence),
    applicationStrategy:
      typeof analysis.applicationStrategy === "string" && analysis.applicationStrategy.trim()
        ? limitSentences(analysis.applicationStrategy.trim())
        : fallback.applicationStrategy,
    source,
    generatedAt: new Date().toISOString()
  };
}

function buildFallbackJobHighlights(job: Job) {
  const description = job.description.replace(/\s+/g, " ").trim();
  const sentences =
    description.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  const usefulTerms = [
    "responsib",
    "require",
    "qualification",
    "build",
    "analyze",
    "support",
    "develop",
    "work with",
    "tools",
    "experience",
    "project",
    "data",
    "operations",
    "supply",
    "customer"
  ];
  const boilerplateTerms = ["equal opportunity", "benefits", "accommodation", "privacy", "compensation", "about us"];
  const highlights = sentences
    .filter((sentence) => {
      const lower = sentence.toLowerCase();
      return usefulTerms.some((term) => lower.includes(term)) && !boilerplateTerms.some((term) => lower.includes(term));
    })
    .slice(0, 5)
    .map(limitSentence);

  if (highlights.length) return highlights;

  return [
    `${job.company} is hiring for ${job.title}.`,
    `Role skills include ${job.skills.slice(0, 4).join(", ") || "the listed job requirements"}.`,
    `Work setup is ${job.workType.toLowerCase()} in ${job.location}.`
  ];
}

function getScoringProfile(profile: CandidateProfile) {
  return {
    headline: profile.headline,
    lookingFor: profile.lookingFor,
    targetRoles: profile.targetRoles,
    skills: profile.skills,
    strengths: profile.strengths,
    education: profile.education,
    experienceFocus: profile.experienceFocus,
    roleEvidence: profile.roleEvidence,
    skillEvidence: profile.skillEvidence,
    educationEvidence: profile.educationEvidence,
    confidenceNotes: profile.confidenceNotes,
    goals: profile.goals,
    visaSponsorshipNeeded: profile.visaSponsorshipNeeded
  };
}

function enforceRoleAlignmentCaps(scoreBreakdown: ScoreBreakdown, job: Job, profile: CandidateProfile): ScoreBreakdown {
  const alignment = getJobProfileAlignment(job, profile);
  if (alignment.tier === "core") return scoreBreakdown;

  const cap = alignment.tier === "adjacent" ? 82 : alignment.tier === "weak" ? 58 : 44;
  const roleCap = alignment.tier === "adjacent" ? 72 : alignment.tier === "weak" ? 46 : 28;
  const reason =
    alignment.tier === "unrelated"
      ? "Server validation capped role fit because this job category does not match the extracted resume direction."
      : `Server validation capped role fit because this job is ${alignment.tier} to the extracted resume direction.`;

  const capped: ScoreBreakdown = {
    ...scoreBreakdown,
    roleFit: {
      score: Math.min(scoreBreakdown.roleFit.score, roleCap),
      reason
    }
  };

  let score = calculateWeightedScore(capped);
  if (score <= cap) return capped;

  const excess = score - cap;
  capped.skillFit = {
    ...capped.skillFit,
    score: Math.max(0, capped.skillFit.score - Math.ceil(excess / factorWeights.skillFit))
  };
  score = calculateWeightedScore(capped);

  if (score > cap) {
    capped.projectEvidence = {
      ...capped.projectEvidence,
      score: Math.max(0, capped.projectEvidence.score - Math.ceil((score - cap) / factorWeights.projectEvidence))
    };
  }

  return capped;
}

function downgradeConfidenceForWeakEvidence(confidence: SignalConfidence, job: Job, profile: CandidateProfile): SignalConfidence {
  const alignment = getJobProfileAlignment(job, profile);
  const evidenceDepth =
    profile.roleEvidence.length +
    profile.skillEvidence.length +
    profile.educationEvidence.filter((item) => !item.toLowerCase().includes("not extracted")).length;

  if (alignment.tier === "unrelated" || evidenceDepth < 3 || (profile.resumeText || "").length < 600) return "low";
  if (alignment.tier === "weak" && confidence === "high") return "medium";
  return confidence;
}

function buildFallbackBreakdown(job: Job, profile: CandidateProfile, deterministic = scoreJob(job, profile)): ScoreBreakdown {
  const skillScore = job.skills.length ? Math.round((deterministic.matchedSkills.length / job.skills.length) * 100) : 35;
  const roleScore = profile.targetRoles.some((role) =>
    job.title.toLowerCase().includes(role.toLowerCase().replace(" intern", "").replace(" internship", ""))
  )
    ? 78
    : 42;
  const projectScore = profile.experienceFocus.length ? Math.min(78, 35 + profile.experienceFocus.length * 10) : 30;
  const sponsorshipScore = profile.visaSponsorshipNeeded ? sponsorshipToScore(job.sponsorshipFriendly) : 75;
  const competitionScore = job.competitionLevel === "low" ? 78 : job.competitionLevel === "medium" ? 62 : 44;

  return {
    skillFit: {
      score: skillScore,
      reason: deterministic.matchedSkills.length
        ? `Profile matches ${deterministic.matchedSkills.slice(0, 3).join(", ")}.`
        : "Limited direct skill overlap found in the extracted profile."
    },
    roleFit: {
      score: roleScore,
      reason: roleScore >= 70 ? "Job title aligns with the extracted target roles." : "Role is adjacent to the extracted target roles."
    },
    projectEvidence: {
      score: projectScore,
      reason: profile.experienceFocus.length
        ? `Relevant experience focus includes ${profile.experienceFocus.slice(0, 2).join(" and ")}.`
        : "Project evidence is limited in the extracted profile."
    },
    sponsorshipFit: {
      score: sponsorshipScore,
      reason: profile.visaSponsorshipNeeded
        ? `Company sponsorship friendliness is marked ${job.sponsorshipFriendly}.`
        : "Sponsorship is not a required constraint for this profile."
    },
    competitionReadiness: {
      score: competitionScore,
      reason: `Competition level is marked ${job.competitionLevel}.`
    }
  };
}

function buildFallbackGaps(job: Job, profile: CandidateProfile, missingSkills: string[]) {
  const gaps = missingSkills.length
    ? missingSkills.slice(0, 3).map((skill) => `${skill} is not clearly present in the extracted profile.`)
    : ["No major skill gaps were detected from the extracted profile."];

  if (profile.visaSponsorshipNeeded && job.sponsorshipFriendly === "low") {
    gaps.push("Visa sponsorship may be a constraint for this company.");
  }

  return gaps;
}

function buildFallbackStrategy(job: Job, profile: CandidateProfile, matchedSkills: string[], missingSkills: string[]) {
  const lead = matchedSkills.length
    ? `Lead with ${matchedSkills.slice(0, 3).join(", ")} and connect those strengths directly to ${job.company}'s ${job.title} work.`
    : `Position this as a stretch role and emphasize transferable strengths from ${profile.experienceFocus.slice(0, 2).join(" and ") || "your profile"}.`;
  const gap = missingSkills.length
    ? `Address ${missingSkills.slice(0, 2).join(" and ")} briefly in your resume or cover note.`
    : "Keep the application focused and concise.";

  return limitSentences(`${lead} ${gap}`);
}

function normalizeBreakdown(value: unknown, fallback: ScoreBreakdown): ScoreBreakdown {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Partial<Record<keyof ScoreBreakdown, Partial<ScoreBreakdownFactor>>>;

  return factorKeys.reduce((breakdown, key) => {
    const factor = record[key];
    breakdown[key] = {
      score: clampScore(factor?.score, fallback[key].score),
      reason:
        typeof factor?.reason === "string" && factor.reason.trim()
          ? limitSentence(factor.reason.trim())
          : fallback[key].reason
    };
    return breakdown;
  }, {} as ScoreBreakdown);
}

function calculateWeightedScore(scoreBreakdown: ScoreBreakdown) {
  const total = factorKeys.reduce((sum, key) => sum + scoreBreakdown[key].score * factorWeights[key], 0);
  return clampScore(Math.round(total), 0);
}

function normalizeJobSkillArray(value: unknown, job: Job, fallback: string[], maxItems: number) {
  if (!Array.isArray(value)) return fallback;

  const byNormalizedName = new Map(job.skills.map((skill) => [normalizeSkill(skill), skill]));
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => byNormalizedName.get(normalizeSkill(item)))
    .filter((item): item is string => Boolean(item));

  const unique = [...new Set(cleaned)].slice(0, maxItems);
  return unique.length ? unique : fallback;
}

function cleanArray(value: unknown, fallback: string[], maxItems: number) {
  if (!Array.isArray(value)) return fallback;

  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  const unique = [...new Set(cleaned)].slice(0, maxItems);
  return unique.length ? unique : fallback;
}

function normalizeConfidence(value: unknown, fallback: SignalConfidence): SignalConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return fallback;
}

function sponsorshipToScore(value: Job["sponsorshipFriendly"]) {
  if (value === "high") return 95;
  if (value === "medium") return 70;
  if (value === "unknown") return 48;
  return 20;
}

function clampScore(value: unknown, fallback: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeSkill(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
}

function limitSentence(value: string) {
  return limitSentences(value).replace(/\s+/g, " ").trim();
}

function limitSentences(value: string) {
  const sentences = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((item) => item.trim()).filter(Boolean) ?? [value];
  return sentences.slice(0, 2).join(" ");
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

const scoreBreakdownFactorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "reason"],
  properties: {
    score: {
      type: "number",
      minimum: 0,
      maximum: 100
    },
    reason: { type: "string" }
  }
};

const aiJobAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "scoreBreakdown",
    "confidence",
    "matchedSkills",
    "missingSkills",
    "matchedEvidence",
    "gaps",
    "jobHighlights",
    "suggestedKeywords",
    "why",
    "applicationStrategy"
  ],
  properties: {
    scoreBreakdown: {
      type: "object",
      additionalProperties: false,
      required: ["skillFit", "roleFit", "projectEvidence", "sponsorshipFit", "competitionReadiness"],
      properties: {
        skillFit: scoreBreakdownFactorSchema,
        roleFit: scoreBreakdownFactorSchema,
        projectEvidence: scoreBreakdownFactorSchema,
        sponsorshipFit: scoreBreakdownFactorSchema,
        competitionReadiness: scoreBreakdownFactorSchema
      }
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"]
    },
    matchedSkills: {
      type: "array",
      maxItems: 8,
      items: { type: "string" }
    },
    missingSkills: {
      type: "array",
      maxItems: 8,
      items: { type: "string" }
    },
    matchedEvidence: {
      type: "array",
      maxItems: 5,
      items: { type: "string" }
    },
    gaps: {
      type: "array",
      maxItems: 5,
      items: { type: "string" }
    },
    jobHighlights: {
      type: "array",
      maxItems: 6,
      items: { type: "string" }
    },
    suggestedKeywords: {
      type: "array",
      maxItems: 8,
      items: { type: "string" }
    },
    why: {
      type: "array",
      maxItems: 4,
      items: { type: "string" }
    },
    applicationStrategy: { type: "string" }
  }
};
