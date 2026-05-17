import { CandidateProfile, Job, MatchResult } from "@/lib/types";

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
  const targetRoleHit = profile.targetRoles.some((role) =>
    job.title.toLowerCase().includes(role.toLowerCase().replace(" intern", ""))
  );
  const skillScore = jobSkills.length ? (matchedSkills.length / jobSkills.length) * 62 : 25;
  const roleScore = targetRoleHit ? 16 : 5;
  const sponsorScore = profile.visaSponsorshipNeeded ? sponsorshipBoost[job.sponsorshipFriendly] : 5;
  const competitionScore = competitionPenalty[job.competitionLevel];
  const score = Math.max(0, Math.min(100, Math.round(18 + skillScore + roleScore + sponsorScore + competitionScore)));

  const why = [
    matchedSkills.length
      ? `Matches ${matchedSkills.slice(0, 4).join(", ")} from your profile.`
      : "Adjacent role with transferable analytics and execution skills.",
    targetRoleHit ? "Role title aligns with your target search." : "Useful stretch role for broadening your radar.",
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

export function getScoreTone(score: number) {
  if (score >= 82) return "text-emerald-600";
  if (score >= 68) return "text-indigo-600";
  if (score >= 52) return "text-amber-600";
  return "text-rose-600";
}
