import { NextResponse } from "next/server";
import { defaultCandidateProfile, extractCandidateProfile } from "@/lib/ai";
import { PROFILE_EXTRACTION_VERSION } from "@/lib/ai-versions";
import { prepareResumeForAi, stableTextHash } from "@/lib/ai-text";
import { callOpenRouterJson } from "@/lib/openrouter";
import type { CandidateProfile, LookingFor, SignalConfidence } from "@/lib/types";

export const runtime = "nodejs";

const maxResumeChars = 28000;
const profileExtractionCache = new Map<string, CandidateProfile>();

type ExtractionResponse = {
  profile: CandidateProfile;
  source: "openrouter" | "local_fallback";
  warning?: string;
};

export async function POST(request: Request) {
  try {
    const { resumeText, visaSponsorshipNeeded, lookingFor } = (await request.json()) as {
      resumeText?: unknown;
      visaSponsorshipNeeded?: unknown;
      lookingFor?: unknown;
    };

    if (typeof resumeText !== "string" || !resumeText.trim()) {
      return NextResponse.json({ error: "Resume text is required." }, { status: 400 });
    }

    const sponsorshipNeeded = Boolean(visaSponsorshipNeeded);
    const searchType = normalizeLookingFor(lookingFor);
    const cacheKey = getProfileExtractionCacheKey(resumeText, sponsorshipNeeded, searchType);
    const cachedProfile = profileExtractionCache.get(cacheKey);

    if (cachedProfile) {
      return NextResponse.json({
        profile: cachedProfile,
        source: "openrouter"
      } satisfies ExtractionResponse);
    }

    try {
      const profile = await extractProfileWithOpenRouter({
        resumeText,
        visaSponsorshipNeeded: sponsorshipNeeded,
        lookingFor: searchType
      });
      profileExtractionCache.set(cacheKey, profile);

      return NextResponse.json({
        profile,
        source: "openrouter"
      } satisfies ExtractionResponse);
    } catch (error) {
      console.warn("OpenRouter profile extraction failed; using local fallback.", error);
      const fallbackProfile = {
        ...extractCandidateProfile(resumeText),
        visaSponsorshipNeeded: sponsorshipNeeded,
        lookingFor: searchType
      };

      return NextResponse.json({
        profile: fallbackProfile,
        source: "local_fallback",
        warning: error instanceof Error ? error.message : "AI extraction failed. Used local fallback."
      } satisfies ExtractionResponse);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not extract profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function extractProfileWithOpenRouter({
  resumeText,
  visaSponsorshipNeeded,
  lookingFor
}: {
  resumeText: string;
  visaSponsorshipNeeded: boolean;
  lookingFor: LookingFor;
}) {
  const trimmedResume = prepareResumeForAi(resumeText, maxResumeChars);
  const parsed = await callOpenRouterJson<Partial<CandidateProfile>>({
    task: "profile",
    maxTokens: 4200,
    schemaName: "candidate_profile_extraction",
    schema: candidateProfileExtractionSchema,
    messages: [
      {
        role: "system",
        content: [
          "You extract concise, evidence-backed candidate profiles from resumes for a career matching app.",
          "Return only valid JSON that matches the schema.",
          "Do not invent facts, employers, schools, tools, roles, outcomes, or work authorization.",
          "Every target role and skill must be supported by resume evidence.",
          "Broad tools like Python, SQL, Excel, or Tableau are supporting evidence, not enough by themselves to infer a software engineering direction.",
          "Prefer domain-specific roles when resume evidence mentions supply chain, operations, procurement, logistics, inventory, forecasting, demand planning, sourcing, or supplier work.",
          "Keep all fields short, cautious, and useful for matching jobs."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          `Profile extraction version: ${PROFILE_EXTRACTION_VERSION}.`,
          `Looking for: ${lookingFor}.`,
          `Visa sponsorship needed: ${visaSponsorshipNeeded}.`,
          "Rules:",
          "- headline must be a short candidate profile headline, not a sentence about the app.",
          "- targetRoles must match both the resume evidence and the Looking for value where possible.",
          "- For internship searches, prefer intern/co-op role names when evidence supports them.",
          "- Do not infer AI/software/software engineering roles from Python, SQL, or analytics tools alone; require explicit engineering evidence such as backend, frontend, APIs, React, JavaScript, TypeScript, Java, C++, GitHub projects, deployed apps, or software engineering titles.",
          "- If a role or skill is not clearly present, leave it out or put the uncertainty in confidenceNotes.",
          "- roleEvidence should explain why each target role was selected using resume-backed facts.",
          "- skillEvidence should cite where skills came from in the resume text.",
          "- educationEvidence should cite degree, school, GPA, graduation date, or coursework only if present.",
          "- confidenceNotes should explain uncertainty and any weak or missing evidence.",
          "",
          "Structured resume text:",
          trimmedResume
        ].join("\n")
      }
    ]
  });
  return normalizeAiProfile(parsed, resumeText, visaSponsorshipNeeded, lookingFor);
}

function normalizeAiProfile(
  profile: Partial<CandidateProfile>,
  resumeText: string,
  visaSponsorshipNeeded: boolean,
  lookingFor: LookingFor
): CandidateProfile {
  const targetRoles = cleanTargetRoles(profile.targetRoles, resumeText, lookingFor);
  const skills = cleanEvidenceBackedArray(profile.skills, defaultCandidateProfile.skills, 12, resumeText, profile.skillEvidence);

  return {
    ...defaultCandidateProfile,
    ...profile,
    resumeText,
    headline: profile.headline?.trim() || defaultCandidateProfile.headline,
    targetRoles,
    skills,
    strengths: cleanArray(profile.strengths, defaultCandidateProfile.strengths, 6),
    education: cleanArray(profile.education, defaultCandidateProfile.education, 4),
    experienceFocus: cleanArray(profile.experienceFocus, defaultCandidateProfile.experienceFocus, 6),
    extractionNotes: cleanArray(profile.extractionNotes, defaultCandidateProfile.extractionNotes, 4),
    roleEvidence: cleanArray(profile.roleEvidence, buildRoleEvidenceFallback(targetRoles, resumeText), 6),
    skillEvidence: cleanArray(profile.skillEvidence, buildSkillEvidenceFallback(skills, resumeText), 8),
    educationEvidence: cleanArray(profile.educationEvidence, defaultCandidateProfile.educationEvidence, 4),
    confidenceNotes: cleanArray(profile.confidenceNotes, defaultCandidateProfile.confidenceNotes, 5),
    personality: {
      summary: profile.personality?.summary?.trim() || defaultCandidateProfile.personality.summary,
      traits: normalizeTraits(profile.personality?.traits),
      workStyle: cleanArray(profile.personality?.workStyle, defaultCandidateProfile.personality.workStyle, 4),
      communicationStyle:
        profile.personality?.communicationStyle?.trim() || defaultCandidateProfile.personality.communicationStyle
    },
    goals: cleanArray(profile.goals, defaultCandidateProfile.goals, 4),
    visaSponsorshipNeeded,
    lookingFor
  };
}

function cleanTargetRoles(value: unknown, resumeText: string, lookingFor: LookingFor) {
  const roles = cleanArray(value, defaultCandidateProfile.targetRoles, 4);
  const normalizedResume = resumeText.toLowerCase();
  const hasSoftwareEvidence = /\b(software engineer|software engineering|backend|frontend|full[- ]stack|react|typescript|javascript|node\.?js|java|c\+\+|github|apis?|deployed|web app)\b/i.test(resumeText);
  const supplySignals = ["supply chain", "procurement", "logistics", "inventory", "demand planning", "forecasting", "supplier", "sourcing"];
  const hasSupplyDirection = supplySignals.some((signal) => normalizedResume.includes(signal));
  const filtered = roles.filter((role) => {
    if (!/software|ai\/software|engineer/i.test(role)) return true;
    return hasSoftwareEvidence;
  });
  const reordered = hasSupplyDirection
    ? filtered.sort((a, b) => Number(/supply|procurement|logistics|operations/i.test(b)) - Number(/supply|procurement|logistics|operations/i.test(a)))
    : filtered;
  const searchAligned = reordered.map((role) => formatRoleForSearchType(role, lookingFor));

  return searchAligned.length ? searchAligned : defaultCandidateProfile.targetRoles.filter((role) => !/software|engineer/i.test(role)).slice(0, 3);
}

function cleanArray(value: unknown, fallback: string[], maxItems: number) {
  if (!Array.isArray(value)) return fallback;

  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(cleaned)].slice(0, maxItems);
}

function cleanEvidenceBackedArray(value: unknown, fallback: string[], maxItems: number, resumeText: string, evidence: unknown) {
  const items = cleanArray(value, fallback, maxItems);
  const normalizedResume = normalizeEvidenceText(resumeText);
  const evidenceText = Array.isArray(evidence)
    ? normalizeEvidenceText(evidence.filter((item): item is string => typeof item === "string").join(" "))
    : "";
  const hardSoftwareEvidence = /\b(software engineer|software engineering|backend|frontend|full stack|full-stack|react|typescript|javascript|node|java|c\+\+|github|api|apis|deployed|web app)\b/i.test(resumeText);

  const supported = items.filter((item) => {
    const normalized = normalizeEvidenceText(item);
    if (!normalized) return false;
    if (/react|typescript|javascript|node|software|backend|frontend|full stack/i.test(item) && !hardSoftwareEvidence) return false;
    return normalizedResume.includes(normalized) || evidenceText.includes(normalized) || isAllowedNormalizedSkill(item, normalizedResume);
  });

  return supported.length ? supported.slice(0, maxItems) : fallback.slice(0, maxItems);
}

function isAllowedNormalizedSkill(skill: string, normalizedResume: string) {
  const aliases: Record<string, string[]> = {
    "Power BI": ["powerbi", "power bi"],
    "Supply Chain": ["supply chain", "supplier", "sourcing"],
    "Stakeholder Management": ["stakeholder", "cross functional"],
    "Machine Learning": ["machine learning", "ml"],
    "A/B Testing": ["a b testing", "ab testing", "experimentation"]
  };

  return (aliases[skill] ?? []).some((alias) => normalizedResume.includes(normalizeEvidenceText(alias)));
}

function buildRoleEvidenceFallback(roles: string[], resumeText: string) {
  const normalizedResume = resumeText.toLowerCase();
  const evidence = roles.map((role) => {
    const keyword = role.replace(/\b(internship|intern|full-time|part-time|job)\b/gi, "").trim();
    return `${role}: inferred from ${normalizedResume.includes(keyword.toLowerCase()) ? keyword : "resume role and domain signals"}.`;
  });

  return evidence.length ? evidence : defaultCandidateProfile.roleEvidence;
}

function buildSkillEvidenceFallback(skills: string[], resumeText: string) {
  const normalizedResume = normalizeEvidenceText(resumeText);
  const evidence = skills.map((skill) =>
    normalizedResume.includes(normalizeEvidenceText(skill))
      ? `${skill}: found in resume text.`
      : `${skill}: inferred from related resume evidence.`
  );

  return evidence.length ? evidence : defaultCandidateProfile.skillEvidence;
}

function formatRoleForSearchType(role: string, lookingFor: LookingFor) {
  const normalized = role
    .replace(/\s+Internship$/i, "")
    .replace(/\s+Intern$/i, "")
    .replace(/\s+Part[-\s]?time$/i, "")
    .replace(/\s+Full[-\s]?time$/i, "")
    .trim();

  if (lookingFor === "Internship") return /\bintern\b/i.test(role) ? role : `${normalized} Intern`;
  if (lookingFor === "Part-time job") return `Part-time ${normalized}`;
  return normalized;
}

function normalizeLookingFor(value: unknown): LookingFor {
  if (value === "Full-time job" || value === "Part-time job" || value === "Internship") return value;
  return defaultCandidateProfile.lookingFor;
}

function getProfileExtractionCacheKey(resumeText: string, visaSponsorshipNeeded: boolean, lookingFor: LookingFor) {
  return stableTextHash(`${PROFILE_EXTRACTION_VERSION}|${visaSponsorshipNeeded}|${lookingFor}|${resumeText}`);
}

function normalizeEvidenceText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
}

function normalizeTraits(value: unknown): CandidateProfile["personality"]["traits"] {
  if (!Array.isArray(value)) return defaultCandidateProfile.personality.traits;

  const traits = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const evidence = typeof record.evidence === "string" ? record.evidence.trim() : "";
      const confidence = normalizeConfidence(record.confidence);

      if (!label || !evidence) return null;

      return { label, evidence, confidence };
    })
    .filter((item): item is CandidateProfile["personality"]["traits"][number] => Boolean(item))
    .slice(0, 4);

  return traits.length ? traits : defaultCandidateProfile.personality.traits;
}

function normalizeConfidence(value: unknown): SignalConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "low";
}

const candidateProfileExtractionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "headline",
    "targetRoles",
    "skills",
    "strengths",
    "education",
    "experienceFocus",
    "extractionNotes",
    "roleEvidence",
    "skillEvidence",
    "educationEvidence",
    "confidenceNotes",
    "personality",
    "goals"
  ],
  properties: {
    headline: { type: "string" },
    targetRoles: {
      type: "array",
      maxItems: 4,
      items: { type: "string" }
    },
    skills: {
      type: "array",
      maxItems: 12,
      items: { type: "string" }
    },
    strengths: {
      type: "array",
      maxItems: 6,
      items: { type: "string" }
    },
    education: {
      type: "array",
      maxItems: 4,
      items: { type: "string" }
    },
    experienceFocus: {
      type: "array",
      maxItems: 6,
      items: { type: "string" }
    },
    extractionNotes: {
      type: "array",
      maxItems: 4,
      items: { type: "string" }
    },
    roleEvidence: {
      type: "array",
      maxItems: 6,
      items: { type: "string" }
    },
    skillEvidence: {
      type: "array",
      maxItems: 8,
      items: { type: "string" }
    },
    educationEvidence: {
      type: "array",
      maxItems: 4,
      items: { type: "string" }
    },
    confidenceNotes: {
      type: "array",
      maxItems: 5,
      items: { type: "string" }
    },
    personality: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "traits", "workStyle", "communicationStyle"],
      properties: {
        summary: { type: "string" },
        traits: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "evidence", "confidence"],
            properties: {
              label: { type: "string" },
              evidence: { type: "string" },
              confidence: {
                type: "string",
                enum: ["low", "medium", "high"]
              }
            }
          }
        },
        workStyle: {
          type: "array",
          maxItems: 4,
          items: { type: "string" }
        },
        communicationStyle: { type: "string" }
      }
    },
    goals: {
      type: "array",
      maxItems: 4,
      items: { type: "string" }
    }
  }
};
