import type { CandidateProfile, Job } from "@/lib/types";

export type RoleCategoryId = "supply-chain" | "operations" | "data" | "business" | "product" | "software";

export type RoleCategory = {
  id: RoleCategoryId;
  label: string;
  titleTerms: string[];
  evidenceTerms: string[];
  adjacent: RoleCategoryId[];
};

export type RoleDirection = {
  category: RoleCategory;
  score: number;
};

export type RoleAlignment = {
  category: RoleCategory;
  score: number;
  tier: "core" | "adjacent" | "weak" | "unrelated";
};

export const roleCategories: RoleCategory[] = [
  {
    id: "supply-chain",
    label: "Supply Chain",
    titleTerms: ["supply chain", "procurement", "logistics", "inventory", "demand planning", "sourcing", "purchasing"],
    evidenceTerms: [
      "supply chain",
      "procurement",
      "logistics",
      "inventory",
      "demand planning",
      "forecasting",
      "supplier",
      "vendor",
      "sourcing",
      "purchase order",
      "material planning",
      "warehouse",
      "distribution",
      "erp",
      "sap"
    ],
    adjacent: ["operations", "data", "business"]
  },
  {
    id: "operations",
    label: "Operations",
    titleTerms: ["operations", "business operations", "strategy operations", "planning analyst", "process analyst"],
    evidenceTerms: ["operations", "operational", "process improvement", "workflow", "capacity", "fulfillment", "planning", "workforce", "bottleneck"],
    adjacent: ["supply-chain", "business", "data"]
  },
  {
    id: "data",
    label: "Data Analyst",
    titleTerms: ["data analyst", "analytics analyst", "business intelligence", "data science"],
    evidenceTerms: ["data analyst", "analytics", "analysis", "dashboard", "reporting", "kpi", "metrics", "tableau", "power bi", "sql", "python"],
    adjacent: ["business", "operations", "product", "supply-chain"]
  },
  {
    id: "business",
    label: "Business Analyst",
    titleTerms: ["business analyst", "business analytics", "strategy analyst", "finance analyst", "financial analyst"],
    evidenceTerms: ["business analyst", "business analytics", "strategy", "requirements", "stakeholder", "client", "finance", "financial", "process"],
    adjacent: ["data", "operations", "supply-chain", "product"]
  },
  {
    id: "product",
    label: "Product",
    titleTerms: ["product analyst", "product operations", "product manager", "growth analyst"],
    evidenceTerms: ["product", "product analytics", "funnel", "a/b testing", "experiment", "experimentation", "user behavior", "retention", "growth"],
    adjacent: ["data", "business", "software"]
  },
  {
    id: "software",
    label: "Software Engineering",
    titleTerms: ["software engineer", "software engineering", "backend engineer", "frontend engineer", "full stack", "web developer", "ai engineer"],
    evidenceTerms: [
      "software engineer",
      "software engineering",
      "backend",
      "frontend",
      "full stack",
      "react",
      "node",
      "typescript",
      "javascript",
      "api",
      "apis",
      "java",
      "c++",
      "github",
      "deployed",
      "web app",
      "application development"
    ],
    adjacent: ["product", "data"]
  }
];

const genericAnalyticsTerms = new Set(["sql", "python", "tableau", "analytics", "analysis", "dashboard", "reporting", "metrics", "kpi"]);

export function getProfileRoleDirections(profile: CandidateProfile): RoleDirection[] {
  const profileText = normalizeRoleText(
    [
      profile.headline,
      profile.targetRoles.join(" "),
      profile.skills.join(" "),
      profile.strengths.join(" "),
      profile.experienceFocus.join(" "),
      profile.goals.join(" "),
      profile.resumeText
    ].join(" ")
  );

  const directions = roleCategories
    .map((category) => {
      const targetRoleScore = profile.targetRoles.reduce((score, role) => {
        const normalizedRole = normalizeRoleText(role);
        if (category.titleTerms.some((term) => normalizedRole.includes(normalizeRoleText(term)))) return score + 12;
        if (category.evidenceTerms.some((term) => normalizedRole.includes(normalizeRoleText(term)))) return score + 7;
        return score;
      }, 0);
      const skillScore = profile.skills.reduce((score, skill) => {
        const normalizedSkill = normalizeRoleText(skill);
        const isGenericAnalytics = genericAnalyticsTerms.has(normalizedSkill);
        const weight = isGenericAnalytics && category.id !== "data" ? 1 : 3;
        return category.evidenceTerms.some((term) => normalizeRoleText(term) === normalizedSkill) ? score + weight : score;
      }, 0);
      const evidenceScore = category.evidenceTerms.reduce((score, term) => {
        const normalizedTerm = normalizeRoleText(term);
        if (!normalizedTerm || !profileText.includes(normalizedTerm)) return score;
        return score + (genericAnalyticsTerms.has(normalizedTerm) ? 1 : 3);
      }, 0);

      return {
        category,
        score: targetRoleScore + skillScore + evidenceScore
      };
    })
    .filter(({ category, score }) => score > 0 && (category.id !== "software" || hasSoftwareEvidence(profileText, score)))
    .sort((a, b) => b.score - a.score || a.category.label.localeCompare(b.category.label));

  return directions.length ? directions : [{ category: getRoleCategory("data"), score: 1 }];
}

export function getProfileRoleDirectionLabel(profile: CandidateProfile) {
  const directions = getProfileRoleDirections(profile).slice(0, 2);
  return directions.map(({ category }) => category.label).join(" / ");
}

export function getJobProfileAlignment(job: Job, profile: CandidateProfile): RoleAlignment {
  const directions = getProfileRoleDirections(profile);
  return getJobAlignmentForDirections(job, directions);
}

export function getJobAlignmentForDirections(job: Job, directions: RoleDirection[]): RoleAlignment {
  const primary = directions[0]?.category ?? getRoleCategory("data");
  const jobCategoryScores = getJobCategoryScores(job);
  const bestJobCategory = jobCategoryScores[0]?.category ?? getRoleCategory("data");
  const directionIds = new Set(directions.slice(0, 2).map(({ category }) => category.id));
  const adjacentIds = new Set(directions.slice(0, 2).flatMap(({ category }) => category.adjacent));
  const text = normalizeRoleText(`${job.title} ${job.description} ${job.skills.join(" ")}`);
  const supplyContext = hasAnyTerm(text, getRoleCategory("supply-chain").evidenceTerms);
  const coreCandidate = jobCategoryScores.find(({ category, score }) => directionIds.has(category.id) && score >= 6);
  const adjacentCandidate = jobCategoryScores.find(({ category, score }) => adjacentIds.has(category.id) && score >= 6);

  if (coreCandidate) {
    return { category: coreCandidate.category, score: coreCandidate.score, tier: "core" };
  }

  if (adjacentCandidate && (adjacentCandidate.category.id !== "data" || supplyContext || directionIds.has("data"))) {
    return { category: adjacentCandidate.category, score: adjacentCandidate.score, tier: "adjacent" };
  }

  if (bestJobCategory.id === "data" && supplyContext) {
    return { category: bestJobCategory, score: jobCategoryScores[0]?.score ?? 0, tier: "adjacent" };
  }

  if (hasAnyTerm(text, primary.evidenceTerms)) {
    return { category: primary, score: 1, tier: "weak" };
  }

  return { category: bestJobCategory, score: jobCategoryScores[0]?.score ?? 0, tier: "unrelated" };
}

export function getJobCategoryScores(job: Job) {
  const title = normalizeRoleText(job.title);
  const text = normalizeRoleText(`${job.title} ${job.description} ${job.skills.join(" ")}`);

  return roleCategories
    .map((category) => {
      const titleScore = category.titleTerms.reduce((score, term) => {
        const normalizedTerm = normalizeRoleText(term);
        return normalizedTerm && title.includes(normalizedTerm) ? score + 8 : score;
      }, 0);
      const evidenceScore = category.evidenceTerms.reduce((score, term) => {
        const normalizedTerm = normalizeRoleText(term);
        if (!normalizedTerm || !text.includes(normalizedTerm)) return score;
        return score + (genericAnalyticsTerms.has(normalizedTerm) ? 1 : 2);
      }, 0);

      return {
        category,
        score: titleScore + evidenceScore
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.category.label.localeCompare(b.category.label));
}

export function getRoleCategory(id: RoleCategoryId) {
  const category = roleCategories.find((item) => item.id === id);
  if (!category) throw new Error(`Unknown role category: ${id}`);
  return category;
}

function hasSoftwareEvidence(profileText: string, score: number) {
  const hardSoftwareSignals = [
    "software engineer",
    "software engineering",
    "backend",
    "frontend",
    "full stack",
    "react",
    "node",
    "typescript",
    "javascript",
    "java",
    "c++",
    "github",
    "deployed",
    "web app",
    "application development"
  ];

  return score >= 8 && hasAnyTerm(profileText, hardSoftwareSignals);
}

function hasAnyTerm(text: string, terms: string[]) {
  return terms.some((term) => {
    const normalizedTerm = normalizeRoleText(term);
    return normalizedTerm && text.includes(normalizedTerm);
  });
}

export function normalizeRoleText(value: string) {
  return value
    .toLowerCase()
    .replace(/\binternship\b|\bintern\b|\bfull time\b|\bpart time\b|\bcandidate\b|\bprofile\b/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}
