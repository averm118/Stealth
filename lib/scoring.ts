import { CandidateProfile, Job, MatchResult } from "@/lib/types";
import { getJobProfileAlignment, normalizeRoleText } from "@/lib/role-taxonomy";

const sponsorshipBoost = {
  high: 14,
  medium: 7,
  low: -10,
  unknown: 0
};

const competitionPenalty = {
  low: 6,
  medium: 0,
  high: -7
};

export function scoreJob(job: Job, profile: CandidateProfile): MatchResult {
  const candidateSkills = profile.skills.map((skill) => skill.toLowerCase());
  const jobSkills = job.skills.map((skill) => skill.toLowerCase());
  const matchedSkills = job.skills.filter((skill) => candidateSkills.includes(skill.toLowerCase()));
  const missingSkills = job.skills.filter((skill) => !candidateSkills.includes(skill.toLowerCase())).slice(0, 5);
  const alignment = getJobProfileAlignment(job, profile);
  const roleMatch = getRoleMatchStrength(job, profile);
  const skillScore = jobSkills.length ? (matchedSkills.length / jobSkills.length) * 34 : 12;
  const roleScore = getRoleScore(alignment.tier, roleMatch);
  const sponsorScore = profile.visaSponsorshipNeeded ? sponsorshipBoost[job.sponsorshipFriendly] : 5;
  const competitionScore = competitionPenalty[job.competitionLevel];
  const rawScore = Math.round(16 + skillScore + roleScore + sponsorScore + competitionScore);
  const score = capScoreForAlignment(Math.max(0, Math.min(100, rawScore)), alignment.tier);

  const why = [
    matchedSkills.length
      ? `Matches ${matchedSkills.slice(0, 4).join(", ")} from your profile.`
      : "Adjacent role with transferable analytics and execution skills.",
    alignment.tier === "core"
      ? `Role category aligns with your ${alignment.category.label.toLowerCase()} direction.`
      : alignment.tier === "adjacent"
        ? `Adjacent ${alignment.category.label.toLowerCase()} role connected to your resume direction.`
        : alignment.tier === "weak"
          ? "Some resume language overlaps, but the role category is not a primary match."
          : "Role category is outside your primary resume direction.",
    profile.visaSponsorshipNeeded
      ? `${job.company} is marked ${job.sponsorshipFriendly} for sponsorship friendliness.`
      : "Sponsorship sensitivity is not weighted heavily for your current settings."
  ];

  return {
    score,
    matchedSkills,
    missingSkills,
    why,
    suggestedKeywords: [...new Set([...missingSkills, ...matchedSkills].slice(0, 7))]
  };
}

function getRoleScore(tier: ReturnType<typeof getJobProfileAlignment>["tier"], roleMatch: number) {
  if (tier === "core") return roleMatch >= 4 ? 40 : 34;
  if (tier === "adjacent") return roleMatch >= 3 ? 25 : 20;
  if (tier === "weak") return 7;
  return 0;
}

function capScoreForAlignment(score: number, tier: ReturnType<typeof getJobProfileAlignment>["tier"]) {
  if (tier === "unrelated") return Math.min(score, 44);
  if (tier === "weak") return Math.min(score, 58);
  if (tier === "adjacent") return Math.min(score, 82);
  return score;
}

function getRoleMatchStrength(job: Job, profile: CandidateProfile) {
  const title = normalizeRoleText(job.title);
  const haystack = normalizeRoleText(`${job.title} ${job.description} ${job.skills.join(" ")}`);

  return profile.targetRoles.reduce((score, role) => {
    const normalizedRole = normalizeRoleText(role);
    const roleTokens = normalizedRole.split(" ").filter((token) => token.length > 2 && token !== "candidate");
    const titleTokenHits = roleTokens.filter((token) => title.includes(token)).length;
    const bodyTokenHits = roleTokens.filter((token) => haystack.includes(token)).length;
    const exactTitleHit = normalizedRole && title.includes(normalizedRole) ? 3 : 0;

    return Math.max(score, exactTitleHit + titleTokenHits + Math.min(bodyTokenHits, 2));
  }, 0);
}

export function getScoreTone(score: number) {
  if (score >= 82) return "text-emerald-600";
  if (score >= 68) return "text-indigo-600";
  if (score >= 52) return "text-amber-600";
  return "text-rose-600";
}
