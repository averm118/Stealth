import { getRoleCategory, normalizeRoleText, roleCategories, type RoleCategoryId } from "@/lib/role-taxonomy";
import type { CandidateProfile, Job, LookingFor } from "@/lib/types";

export type RadarRoleDirection = {
  categoryId: RoleCategoryId;
  label: string;
  score: number;
};

export type RadarRoleLane = {
  id: string;
  label: string;
  categoryIds: RoleCategoryId[];
};

export type RadarMatchLevel = "strong" | "good" | "backup";

export type RadarMatch = {
  job: Job;
  matchLevel: RadarMatchLevel;
  reasons: string[];
  badges: string[];
  roleCategory: string;
  roleTier: "core" | "adjacent" | "backup";
  sortScore: number;
};

const roleLaneFallbacks: RadarRoleLane[] = [
  { id: "supply-chain", label: "Supply Chain", categoryIds: ["supply-chain"] },
  { id: "operations", label: "Operations", categoryIds: ["operations"] },
  { id: "data", label: "Data Analyst", categoryIds: ["data"] },
  { id: "business", label: "Business Analyst", categoryIds: ["business"] },
  { id: "product", label: "Product", categoryIds: ["product"] },
  { id: "software", label: "Software Engineering", categoryIds: ["software"] }
];

const genericToolTerms = new Set(["sql", "python", "tableau", "power bi", "analytics", "analysis", "dashboard", "reporting", "metrics", "kpi"]);
const minimumLaneTarget = 50;

export function getRadarRoleDirections(profile: CandidateProfile): RadarRoleDirection[] {
  const profileText = normalizeRoleText(
    [
      profile.headline,
      profile.targetRoles.join(" "),
      profile.roleEvidence.join(" "),
      profile.education.join(" ")
    ].join(" ")
  );
  const degreeCategories = getProfileDegreeCategories(profile);

  const directions = roleCategories
    .map((category) => {
      const titleScore = category.titleTerms.reduce((score, term) => {
        const normalizedTerm = normalizeRoleText(term);
        return normalizedTerm && profileText.includes(normalizedTerm) ? score + 14 : score;
      }, 0);
      const evidenceScore = category.evidenceTerms.reduce((score, term) => {
        const normalizedTerm = normalizeRoleText(term);
        if (!normalizedTerm || genericToolTerms.has(normalizedTerm) || !profileText.includes(normalizedTerm)) return score;
        return score + 4;
      }, 0);
      const degreeScore = degreeCategories.has(category.id) ? 5 : 0;

      return {
        categoryId: category.id,
        label: category.label,
        score: titleScore + evidenceScore + degreeScore
      };
    })
    .filter((direction) => direction.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  return directions.length ? directions : [{ categoryId: "data", label: "Data Analyst", score: 1 }];
}

export function getRadarDirectionLabel(profile: CandidateProfile) {
  return getRadarRoleDirections(profile)
    .slice(0, 2)
    .map((direction) => direction.label)
    .join(" / ");
}

export function buildRadarRoleLanes(directions: RadarRoleDirection[]) {
  const matched = directions
    .map(({ categoryId }) => roleLaneFallbacks.find((lane) => lane.id === categoryId))
    .filter((lane): lane is RadarRoleLane => Boolean(lane));
  const unique = Array.from(new Map(matched.map((lane) => [lane.id, lane])).values());

  return unique.length
    ? unique.concat(roleLaneFallbacks.filter((lane) => !unique.some((item) => item.id === lane.id)).slice(0, 3))
    : roleLaneFallbacks;
}

export function buildResumeRadarLane(directions: RadarRoleDirection[]): RadarRoleLane {
  const primary = directions[0]?.categoryId ?? "data";
  const companions: RoleCategoryId[] =
    primary === "supply-chain"
      ? ["operations"]
      : primary === "operations"
        ? ["supply-chain"]
        : [];
  const categoryIds = [...new Set<RoleCategoryId>([primary, ...companions])];

  return {
    id: "resume-fit",
    label: categoryIds.map((id) => getRoleCategory(id).label).join(" / "),
    categoryIds
  };
}

export function buildRadarMatches({
  jobs,
  profile,
  lane,
  laneMode,
  query,
  viewFilter
}: {
  jobs: Job[];
  profile: CandidateProfile;
  lane: RadarRoleLane | null;
  laneMode: "resume-fit" | "role-lane" | "all";
  query: string;
  viewFilter: string;
}) {
  const directions = getRadarRoleDirections(profile);
  const directionIds = new Set((lane?.categoryIds ?? directions.slice(0, 2).map((direction) => direction.categoryId)));
  const adjacentIds = new Set(
    Array.from(directionIds).flatMap((id) => getRoleCategory(id).adjacent)
  );
  const matches = jobs
    .filter((job) => matchesLookingFor(job, profile.lookingFor))
    .filter((job) => !hasBlockedSeniority(job))
    .filter((job) => matchesViewFilter(job, viewFilter))
    .filter((job) => matchesQuery(job, query))
    .map((job) => toRadarMatch(job, profile, directionIds, adjacentIds, laneMode))
    .filter((match): match is RadarMatch => Boolean(match));

  const sponsorshipFiltered =
    profile.visaSponsorshipNeeded && matches.some((match) => match.job.sponsorshipFriendly === "low")
      ? keepLowSponsorshipOnlyWhenNeeded(matches)
      : matches;

  return sponsorshipFiltered.sort((a, b) => b.sortScore - a.sortScore || b.job.postedDate.localeCompare(a.job.postedDate));
}

export function getRoleLaneCounts(jobs: Job[], profile: CandidateProfile, lanes: RadarRoleLane[], query: string, viewFilter: string) {
  return Object.fromEntries(
    lanes.map((lane) => [
      lane.id,
      buildRadarMatches({ jobs, profile, lane, laneMode: "role-lane", query, viewFilter }).length
    ])
  );
}

export function matchesLookingFor(job: Job, lookingFor: LookingFor) {
  const text = getJobText(job);
  const hasInternshipSignal = /\b(intern|internship|co-?op|co op|student program|university program|campus|summer\s+20\d{2}|fall\s+20\d{2}|spring\s+20\d{2})\b/i.test(text);
  const hasPartTimeSignal = /\b(part[- ]time|temporary|seasonal|student assistant|contract)\b/i.test(text);
  const hasEarlyCareerSignal = /\b(new grad|new graduate|early career|early talent|university hire|campus hire|rotational|development program|entry[- ]level|associate analyst|analyst program)\b/i.test(text);

  if (lookingFor === "Internship") return hasInternshipSignal;
  if (lookingFor === "Part-time job") return hasPartTimeSignal && !hasInternshipSignal;
  return !hasInternshipSignal && !hasPartTimeSignal && (hasEarlyCareerSignal || !hasHardExperienceRequirement(job));
}

export function isBelowLaneTarget(count: number) {
  return count > 0 && count < minimumLaneTarget;
}

export function getMinimumLaneTarget() {
  return minimumLaneTarget;
}

function toRadarMatch(
  job: Job,
  profile: CandidateProfile,
  directionIds: Set<RoleCategoryId>,
  adjacentIds: Set<RoleCategoryId>,
  laneMode: "resume-fit" | "role-lane" | "all"
): RadarMatch | null {
  const categoryScores = getJobCategoryScoresWithoutSkills(job);
  const primaryScore = categoryScores[0];
  if (!primaryScore) return null;

  const core = categoryScores.find(({ categoryId, score }) => directionIds.has(categoryId) && score >= 8);
  const adjacent = categoryScores.find(({ categoryId, score }) => adjacentIds.has(categoryId) && score >= 10);
  const selected = core ?? (laneMode === "all" ? primaryScore : adjacent);
  if (!selected) return null;

  const roleTier = core ? "core" : adjacent ? "adjacent" : "backup";
  if (laneMode !== "all" && roleTier === "backup") return null;
  if (laneMode === "resume-fit" && roleTier !== "core" && !isStrongAdjacentRole(job, directionIds)) return null;

  const degree = getDegreeCompatibility(profile, job, selected.categoryId);
  if (degree === "weak" && roleTier !== "core") return null;

  const sponsorship = getSponsorshipScore(profile, job);
  const searchTypeScore = getSearchTypeScore(job, profile.lookingFor);
  const recencyScore = getRecencyScore(job.postedDate);
  const roleScore = roleTier === "core" ? 90 + selected.score : roleTier === "adjacent" ? 62 + selected.score : 35 + selected.score;
  const degreeScore = degree === "aligned" ? 18 : degree === "compatible" ? 10 : degree === "not-mentioned" ? 5 : -20;
  const sortScore = roleScore + degreeScore + sponsorship + searchTypeScore + recencyScore;
  const roleCategory = getRoleCategory(selected.categoryId).label;
  const badges = buildBadges(profile, job, roleTier, degree);

  return {
    job,
    matchLevel: roleTier === "core" && degree !== "weak" ? "strong" : roleTier === "adjacent" ? "good" : "backup",
    reasons: [buildReason(job, profile, roleCategory, degree)],
    badges,
    roleCategory,
    roleTier,
    sortScore
  };
}

function getJobCategoryScoresWithoutSkills(job: Job) {
  const title = normalizeRoleText(job.title);
  const text = normalizeRoleText(getJobText(job));

  return roleCategories
    .map((category) => {
      const titleScore = category.titleTerms.reduce((score, term) => {
        const normalizedTerm = normalizeRoleText(term);
        return normalizedTerm && title.includes(normalizedTerm) ? score + 14 : score;
      }, 0);
      const evidenceScore = category.evidenceTerms.reduce((score, term) => {
        const normalizedTerm = normalizeRoleText(term);
        if (!normalizedTerm || genericToolTerms.has(normalizedTerm) || !text.includes(normalizedTerm)) return score;
        return score + 3;
      }, 0);

      return {
        categoryId: category.id,
        score: titleScore + evidenceScore
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || getRoleCategory(a.categoryId).label.localeCompare(getRoleCategory(b.categoryId).label));
}

function isStrongAdjacentRole(job: Job, directionIds: Set<RoleCategoryId>) {
  if (directionIds.has("supply-chain") || directionIds.has("operations")) {
    return /\b(supply chain|procurement|logistics|inventory|demand planning|forecasting|supplier|sourcing|purchasing|warehouse|distribution|operations|fulfillment|planning)\b/i.test(getJobText(job));
  }
  return false;
}

function getProfileDegreeCategories(profile: CandidateProfile) {
  const text = normalizeRoleText(profile.education.join(" "));
  const categories = new Set<RoleCategoryId>();

  if (/\b(supply chain|logistics|operations|industrial engineering|manufacturing)\b/i.test(text)) {
    categories.add("supply-chain");
    categories.add("operations");
  }
  if (/\b(business|management|mba|commerce|economics)\b/i.test(text)) {
    categories.add("business");
    categories.add("operations");
  }
  if (/\b(analytics|data|statistics|information systems|business analytics)\b/i.test(text)) {
    categories.add("data");
    categories.add("business");
  }
  if (/\b(computer science|software|computer engineering|information technology|engineering)\b/i.test(text)) {
    categories.add("software");
    categories.add("data");
    categories.add("product");
  }
  if (/\b(finance|accounting)\b/i.test(text)) categories.add("business");
  if (!categories.size && /\b(bachelor|master|science|arts|degree|university|college)\b/i.test(text)) {
    categories.add("business");
    categories.add("data");
    categories.add("operations");
  }

  return categories;
}

function getDegreeCompatibility(profile: CandidateProfile, job: Job, categoryId: RoleCategoryId) {
  const degreeCategories = getProfileDegreeCategories(profile);
  const jobText = getJobText(job);
  const jobRequiresCs = /\b(computer science|computer engineering|software engineering|cs degree)\b/i.test(jobText);
  const jobRequiresBusiness = /\b(business|business analytics|management|economics|finance|accounting)\b/i.test(jobText);
  const jobRequiresSupply = /\b(supply chain|logistics|industrial engineering|operations management)\b/i.test(jobText);
  const jobRequiresStem = /\b(engineering|statistics|mathematics|data science|stem)\b/i.test(jobText);

  if (degreeCategories.has(categoryId)) return "aligned";
  if (!jobRequiresCs && !jobRequiresBusiness && !jobRequiresSupply && !jobRequiresStem) return "not-mentioned";
  if (jobRequiresCs && (degreeCategories.has("software") || degreeCategories.has("data"))) return "compatible";
  if (jobRequiresBusiness && (degreeCategories.has("business") || degreeCategories.has("data") || degreeCategories.has("operations"))) return "compatible";
  if (jobRequiresSupply && (degreeCategories.has("supply-chain") || degreeCategories.has("operations") || degreeCategories.has("business"))) return "compatible";
  if (jobRequiresStem && degreeCategories.size > 0) return "compatible";
  return "weak";
}

function getSponsorshipScore(profile: CandidateProfile, job: Job) {
  if (!profile.visaSponsorshipNeeded) return 0;
  if (job.sponsorshipFriendly === "high") return 24;
  if (job.sponsorshipFriendly === "medium") return 16;
  if (job.sponsorshipFriendly === "unknown") return 3;
  return -60;
}

function keepLowSponsorshipOnlyWhenNeeded(matches: RadarMatch[]) {
  const nonLow = matches.filter((match) => match.job.sponsorshipFriendly !== "low");
  if (nonLow.length >= minimumLaneTarget) return nonLow;
  return nonLow.concat(matches.filter((match) => match.job.sponsorshipFriendly === "low"));
}

function getSearchTypeScore(job: Job, lookingFor: LookingFor) {
  const text = getJobText(job);
  if (lookingFor === "Internship" && /\b(intern|internship|co-?op|co op|student|university|campus)\b/i.test(text)) return 20;
  if (lookingFor === "Part-time job" && /\b(part[- ]time|temporary|seasonal|student assistant)\b/i.test(text)) return 20;
  if (lookingFor === "Full-time job" && /\b(new grad|new graduate|early career|rotational|development program|entry[- ]level|associate analyst|analyst program)\b/i.test(text)) return 20;
  return 6;
}

function buildBadges(profile: CandidateProfile, job: Job, roleTier: RadarMatch["roleTier"], degree: string) {
  const badges = [roleTier === "core" ? "Role match" : roleTier === "adjacent" ? "Adjacent role" : "Backup"];
  if (degree === "aligned" || degree === "compatible") badges.push("Degree aligned");
  if (profile.visaSponsorshipNeeded && (job.sponsorshipFriendly === "high" || job.sponsorshipFriendly === "medium")) badges.push("Sponsor-friendly");
  if (matchesLookingFor(job, profile.lookingFor)) badges.push(profile.lookingFor === "Internship" ? "Student role" : profile.lookingFor);
  return badges.slice(0, 4);
}

function buildReason(job: Job, profile: CandidateProfile, roleCategory: string, degree: string) {
  const searchLabel = profile.lookingFor.toLowerCase();
  const degreeText = degree === "aligned" || degree === "compatible" ? " and broad degree fit" : "";
  const sponsorText = profile.visaSponsorshipNeeded && (job.sponsorshipFriendly === "high" || job.sponsorshipFriendly === "medium")
    ? " with stronger sponsorship signals"
    : "";
  return `${roleCategory} role aligned with your ${searchLabel} preference${degreeText}${sponsorText}.`;
}

function hasBlockedSeniority(job: Job) {
  const title = normalizeRoleText(job.title);
  if (/\b(senior|sr|staff|principal|manager|director|lead|head)\b/i.test(title)) return true;
  return hasHardExperienceRequirement(job) && !/\b(intern|internship|co-?op|co op|new grad|new graduate|early career|entry[- ]level|university|student)\b/i.test(getJobText(job));
}

function hasHardExperienceRequirement(job: Job) {
  const text = getJobText(job);
  return (
    /\b(?:minimum|min|at least|required|requires|requirement)\s+(?:of\s+)?(?:[2-9]|[1-9]\d)\+?\s+years?\b.{0,90}\bexperience\b/i.test(text) ||
    /\b(?:[2-9]|[1-9]\d)\+?\s+years?\s+(?:of\s+)?(?:professional\s+|relevant\s+|work\s+|industry\s+)?experience\b/i.test(text) ||
    /\bprofessional\s+experience\s+required\b/i.test(text)
  );
}

function matchesViewFilter(job: Job, viewFilter: string) {
  if (viewFilter === "all") return true;
  if (viewFilter === "remote") return job.workType === "Remote";
  if (viewFilter === "hybrid") return job.workType === "Hybrid";
  if (viewFilter === "onsite") return job.workType === "On-site";
  if (viewFilter === "sponsor-friendly") return job.sponsorshipFriendly === "high" || job.sponsorshipFriendly === "medium";
  if (viewFilter === "fresh-week") return postedWithinDays(job.postedDate, 7);
  if (viewFilter === "fresh-month") return postedWithinDays(job.postedDate, 30);
  return true;
}

function matchesQuery(job: Job, query: string) {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return true;
  return `${job.company} ${job.title} ${job.location} ${job.description}`.toLowerCase().includes(normalizedQuery);
}

function postedWithinDays(postedDate: string, days: number) {
  const timestamp = new Date(postedDate).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= days * 86_400_000;
}

function getRecencyScore(postedDate: string) {
  const timestamp = new Date(postedDate).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, 12 - Math.floor((Date.now() - timestamp) / 86_400_000));
}

function getJobText(job: Job) {
  return `${job.title} ${job.description}`.toLowerCase();
}
