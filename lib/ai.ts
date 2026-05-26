import { CandidateProfile, SignalConfidence } from "@/lib/types";

type SkillRule = {
  label: string;
  aliases: string[];
};

type RoleRule = {
  label: string;
  signals: string[];
};

const skillRules: SkillRule[] = [
  { label: "Excel", aliases: ["excel", "microsoft excel", "pivot table", "pivot tables", "vlookup", "xlookup"] },
  { label: "SQL", aliases: ["sql", "mysql", "postgresql", "postgres", "snowflake", "bigquery"] },
  { label: "Python", aliases: ["python", "pandas", "numpy", "scikit-learn", "sklearn"] },
  { label: "Tableau", aliases: ["tableau"] },
  { label: "Power BI", aliases: ["power bi", "powerbi", "dax"] },
  { label: "R", aliases: ["r programming", "r studio", "rstudio"] },
  { label: "Looker", aliases: ["looker", "looker studio"] },
  { label: "Figma", aliases: ["figma"] },
  { label: "Jira", aliases: ["jira", "confluence"] },
  { label: "SAP", aliases: ["sap"] },
  { label: "ERP", aliases: ["erp", "enterprise resource planning"] },
  { label: "Procurement", aliases: ["procurement", "sourcing", "purchase orders", "purchasing"] },
  { label: "Forecasting", aliases: ["forecasting", "forecast", "demand planning", "demand forecast"] },
  { label: "Inventory", aliases: ["inventory", "stockout", "stockouts", "safety stock"] },
  { label: "Logistics", aliases: ["logistics", "transportation", "warehouse", "distribution"] },
  { label: "Supply Chain", aliases: ["supply chain", "supplier", "suppliers", "material planning"] },
  { label: "Analytics", aliases: ["analytics", "analysis", "analyst", "insights", "kpi", "metrics"] },
  { label: "Machine Learning", aliases: ["machine learning", "ml", "predictive model", "classification model"] },
  { label: "React", aliases: ["react", "react.js", "reactjs"] },
  { label: "TypeScript", aliases: ["typescript", "ts"] },
  { label: "Next.js", aliases: ["next.js", "nextjs"] },
  { label: "Node.js", aliases: ["node.js", "nodejs", "express.js"] },
  { label: "Supabase", aliases: ["supabase"] },
  { label: "AWS", aliases: ["aws", "amazon web services", "s3", "lambda"] },
  { label: "Product Analytics", aliases: ["product analytics", "funnel analysis", "user behavior", "retention"] },
  { label: "Operations", aliases: ["operations", "operational", "process improvement", "workflow"] },
  { label: "A/B Testing", aliases: ["a/b testing", "ab testing", "experiment", "experimentation"] },
  { label: "Stakeholder Management", aliases: ["stakeholder", "stakeholders", "cross-functional", "client-facing"] }
];

const roleRules: RoleRule[] = [
  {
    label: "Supply Chain Analyst",
    signals: ["supply chain", "inventory", "logistics", "forecasting", "demand planning", "supplier", "material planning"]
  },
  {
    label: "Data Analyst",
    signals: ["data analyst", "sql", "python", "tableau", "power bi", "dashboard", "analytics", "kpi", "metrics"]
  },
  {
    label: "Business Analyst",
    signals: ["business analyst", "business analytics", "requirements", "stakeholder", "process", "jira", "client"]
  },
  {
    label: "Product Analyst",
    signals: ["product analyst", "product analytics", "funnel", "a/b testing", "experiment", "user behavior", "retention"]
  },
  {
    label: "Operations Analyst",
    signals: ["operations analyst", "operations", "workflow", "process improvement", "operational", "capacity"]
  },
  {
    label: "Procurement Intern",
    signals: ["procurement", "sourcing", "purchase order", "supplier", "vendor", "spend analysis"]
  },
  {
    label: "AI/Software Intern",
    signals: ["software", "react", "typescript", "next.js", "node.js", "machine learning", "ai", "api", "full-stack"]
  }
];

const personalityRules = [
  {
    label: "Analytical",
    terms: ["analytics", "analysis", "sql", "python", "tableau", "power bi", "forecasting", "dashboard", "model", "metrics"],
    fallbackEvidence: "analytics tools, reporting, or quantitative project language"
  },
  {
    label: "Execution-oriented",
    terms: ["built", "created", "developed", "implemented", "delivered", "launched", "optimized", "improved", "automated"],
    fallbackEvidence: "build, delivery, or improvement verbs"
  },
  {
    label: "Process-minded",
    terms: ["operations", "supply chain", "procurement", "inventory", "logistics", "workflow", "process"],
    fallbackEvidence: "operations, process, or systems language"
  },
  {
    label: "Collaborative communicator",
    terms: ["stakeholder", "cross-functional", "collaborated", "team", "client", "presented", "communicated"],
    fallbackEvidence: "stakeholder, team, client, or presentation language"
  },
  {
    label: "Learning-driven",
    terms: ["student", "coursework", "project", "research", "certification", "learning", "graduate", "university"],
    fallbackEvidence: "academic, project, or learning signals"
  },
  {
    label: "Leadership-oriented",
    terms: ["led", "lead", "managed", "mentored", "coordinated", "president", "captain", "organized"],
    fallbackEvidence: "leadership or coordination language"
  },
  {
    label: "Detail-conscious",
    terms: ["audit", "quality", "validation", "accuracy", "reconcile", "compliance", "documentation", "testing"],
    fallbackEvidence: "quality, accuracy, or validation language"
  }
];

export const defaultCandidateProfile: CandidateProfile = {
  resumeText: "",
  resumeDocument: null,
  headline: "ASU student exploring analyst and AI internship roles",
  targetRoles: ["Data Analyst", "Business Analyst", "Supply Chain Analyst"],
  skills: ["Excel", "SQL", "Python", "Tableau", "Analytics", "Stakeholder Management"],
  strengths: ["structured problem solving", "cross-functional communication"],
  education: ["Student profile not extracted yet"],
  experienceFocus: ["analytics", "operations"],
  extractionNotes: ["Paste a resume to extract stronger signals from education, projects, tools, and outcomes."],
  roleEvidence: ["Default demo role direction; upload a resume for evidence-backed roles."],
  skillEvidence: ["Default demo skills; upload a resume for evidence-backed skills."],
  educationEvidence: ["Education has not been extracted yet."],
  confidenceNotes: ["Default demo profile; confidence improves after resume upload."],
  personality: {
    summary: "Analytical, curious, and structured based on the default demo profile.",
    traits: [
      {
        label: "Analytical",
        evidence: "Excel, SQL, Python, Tableau, Analytics",
        confidence: "medium"
      },
      {
        label: "Collaborative communicator",
        evidence: "Stakeholder Management",
        confidence: "medium"
      }
    ],
    workStyle: ["structured problem solver", "data-informed decision maker"],
    communicationStyle: "Likely concise and business-oriented when explaining analysis."
  },
  goals: ["land a summer internship", "build experience in analytics and operations"],
  visaSponsorshipNeeded: true,
  lookingFor: "Internship"
};

export function extractCandidateProfile(resumeText: string): CandidateProfile {
  // Later: replace this deterministic placeholder with an OpenAI/Claude extraction call.
  // Supabase integration can persist the normalized profile per authenticated user.
  const normalized = normalizeText(resumeText);
  const lower = normalized.toLowerCase();
  const skills = extractSkills(normalized);
  const roleMatches = inferTargetRoles(normalized);
  const targetRoles = roleMatches.length > 0 ? roleMatches.map((match) => match.label) : defaultCandidateProfile.targetRoles;
  const education = extractEducation(normalized);
  const experienceFocus = extractExperienceFocus(normalized, skills, targetRoles);
  const visaSponsorshipNeeded = /sponsorship|h-1b|h1b|f-1|f1|opt|cpt|international student|work authorization/.test(lower);
  const personality = extractPersonalitySignals(normalized);
  const strengths = extractStrengths(normalized, personality);
  const roleEvidence = buildRoleEvidence(roleMatches);
  const skillEvidence = buildSkillEvidence(normalized, skills);
  const educationEvidence = education.length ? education.map((item) => `Education signal found: ${item}.`) : defaultCandidateProfile.educationEvidence;

  return {
    resumeText,
    resumeDocument: null,
    headline: buildHeadline({ education, skills, targetRoles, normalized }),
    targetRoles,
    skills: skills.length > 0 ? skills : defaultCandidateProfile.skills,
    strengths,
    education,
    experienceFocus,
    extractionNotes: buildExtractionNotes({ normalized, roleMatches, skills, education }),
    roleEvidence,
    skillEvidence,
    educationEvidence,
    confidenceNotes: buildConfidenceNotes({ roleMatches, skills, education, normalized }),
    personality,
    goals: inferGoals(normalized, targetRoles, visaSponsorshipNeeded),
    visaSponsorshipNeeded,
    lookingFor: defaultCandidateProfile.lookingFor
  };
}

function buildRoleEvidence(roleMatches: ReturnType<typeof inferTargetRoles>) {
  const evidence = roleMatches
    .filter((match) => match.matchedSignals.length)
    .map((match) => `${match.label}: ${match.matchedSignals.slice(0, 4).join(", ")}.`);

  return evidence.length ? evidence : defaultCandidateProfile.roleEvidence;
}

function buildSkillEvidence(text: string, skills: string[]) {
  const evidence = skills.map((skill) => {
    const rule = skillRules.find((item) => item.label === skill);
    const matchedAlias = rule?.aliases.find((alias) => hasPhrase(text, alias)) ?? skill;
    return `${skill}: found "${matchedAlias}" in resume text.`;
  });

  return evidence.length ? evidence : defaultCandidateProfile.skillEvidence;
}

function buildConfidenceNotes({
  roleMatches,
  skills,
  education,
  normalized
}: {
  roleMatches: ReturnType<typeof inferTargetRoles>;
  skills: string[];
  education: string[];
  normalized: string;
}) {
  const notes = [
    roleMatches.length ? "Target roles are supported by resume language." : "Target role evidence is limited.",
    skills.length >= 4 ? "Several concrete skills were detected." : "Skill evidence is thin.",
    education.length ? "Education signal was detected." : "Education signal was not clearly detected.",
    normalized.length > 1200 ? "Resume text has enough detail for a moderate confidence profile." : "Resume text is short, so extraction confidence should be cautious."
  ];

  return notes;
}

function extractSkills(text: string) {
  const found = skillRules
    .filter((rule) => rule.aliases.some((alias) => hasPhrase(text, alias)))
    .map((rule) => rule.label);

  return [...new Set(found)].slice(0, 14);
}

function inferTargetRoles(text: string) {
  return roleRules
    .map((rule) => {
      const matchedSignals = rule.signals.filter((signal) => hasPhrase(text, signal));
      const exactTitleBoost = hasPhrase(text, rule.label) ? 2 : 0;
      const isSoftwareRole = rule.label === "AI/Software Intern";
      const hasHardSoftwareEvidence = [
        "software engineer",
        "software engineering",
        "backend",
        "frontend",
        "full-stack",
        "full stack",
        "react",
        "typescript",
        "node.js",
        "nodejs",
        "javascript",
        "java",
        "c++",
        "github",
        "api",
        "apis",
        "deployed",
        "web app"
      ].some((signal) => hasPhrase(text, signal));
      const score = isSoftwareRole && !hasHardSoftwareEvidence ? 0 : matchedSignals.length + exactTitleBoost;
      return {
        label: rule.label,
        score,
        matchedSignals
      };
    })
    .filter((match) => match.score >= 2)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 4);
}

function extractEducation(text: string) {
  const education: string[] = [];
  const degreePatterns = [
    /\b(?:m\.?s\.?|master(?:'s)?|masters)\s+(?:of\s+|in\s+)?[a-z& ]{3,45}/gi,
    /\b(?:b\.?s\.?|bachelor(?:'s)?|bachelors)\s+(?:of\s+|in\s+)?[a-z& ]{3,45}/gi,
    /\b(?:mba|ph\.?d\.?|doctorate)\b(?:\s+in\s+[a-z& ]{3,45})?/gi
  ];

  degreePatterns.forEach((pattern) => {
    const matches = text.match(pattern) ?? [];
    matches.forEach((match) => education.push(toTitleCase(cleanPhrase(match))));
  });

  const schoolMatches = text.match(/\b(?:asu|arizona state university|university of [a-z ]+|[a-z ]+ university)\b/gi) ?? [];
  schoolMatches.forEach((match) => education.push(toTitleCase(cleanPhrase(match))));

  return [...new Set(education)].slice(0, 4);
}

function extractExperienceFocus(text: string, skills: string[], targetRoles: string[]) {
  const focusSignals = [
    hasPhrase(text, "dashboard") || hasPhrase(text, "report") ? "dashboarding and reporting" : "",
    hasPhrase(text, "forecast") || hasPhrase(text, "demand planning") ? "forecasting and planning" : "",
    hasPhrase(text, "inventory") || hasPhrase(text, "optimization") ? "inventory optimization" : "",
    hasPhrase(text, "funnel") || hasPhrase(text, "product analytics") ? "product funnel analysis" : "",
    hasPhrase(text, "stakeholder") || hasPhrase(text, "client") ? "stakeholder-facing analysis" : "",
    hasPhrase(text, "operations") || hasPhrase(text, "workflow") ? "operations improvement" : "",
    hasPhrase(text, "machine learning") || hasPhrase(text, "predictive") ? "predictive modeling" : ""
  ].filter(Boolean);

  const roleFocus = targetRoles.slice(0, 2).map((role) => role.replace(" Intern", "").toLowerCase());
  const skillFocus = skills.slice(0, 3).map((skill) => `${skill.toLowerCase()}-based analysis`);

  return [...new Set([...focusSignals, ...roleFocus, ...skillFocus])].slice(0, 6);
}

function buildHeadline({
  education,
  skills,
  targetRoles,
  normalized
}: {
  education: string[];
  skills: string[];
  targetRoles: string[];
  normalized: string;
}) {
  const topRole = targetRoles[0] ?? "Analyst";
  const degree = education.find((item) => /master|m\.?s\.?|mba|bachelor|b\.?s\.?/i.test(item));
  const topSkills = skills.slice(0, 3).join(", ");

  if (degree && topSkills) return `${degree} candidate for ${topRole} roles with ${topSkills}`;
  if (hasPhrase(normalized, "student") && topSkills) return `Student targeting ${topRole} roles with ${topSkills}`;
  if (topSkills) return `${topRole} candidate with ${topSkills}`;
  return defaultCandidateProfile.headline;
}

function extractStrengths(text: string, personality: CandidateProfile["personality"]) {
  const strengths = [
    hasPhrase(text, "project") || hasPhrase(text, "built") || hasPhrase(text, "developed") ? "applied project execution" : "",
    hasPhrase(text, "stakeholder") || hasPhrase(text, "presented") || hasPhrase(text, "client") ? "stakeholder communication" : "",
    hasPhrase(text, "forecasting") || hasPhrase(text, "optimization") || hasPhrase(text, "model") ? "quantitative problem solving" : "",
    hasPhrase(text, "operations") || hasPhrase(text, "supply chain") || hasPhrase(text, "process") ? "process improvement mindset" : "",
    hasPhrase(text, "lead") || hasPhrase(text, "led") || hasPhrase(text, "coordinated") ? "leadership and coordination" : "",
    hasOutcomeMetric(text) ? "outcome-oriented storytelling" : ""
  ].filter(Boolean);

  const traitStrengths = personality.traits
    .filter((trait) => trait.confidence !== "low")
    .slice(0, 2)
    .map((trait) => `${trait.label.toLowerCase()} work style`);

  return [...new Set([...strengths, ...traitStrengths])].slice(0, 6);
}

function extractPersonalitySignals(resumeText: string): CandidateProfile["personality"] {
  const traits = personalityRules
    .map((rule) => {
      const matchedTerms = rule.terms.filter((term) => hasPhrase(resumeText, term));
      if (matchedTerms.length === 0) return null;

      return {
        label: rule.label,
        evidence: getEvidenceSnippet(resumeText, matchedTerms) ?? rule.fallbackEvidence,
        confidence: getConfidence(matchedTerms.length)
      };
    })
    .filter((trait): trait is NonNullable<typeof trait> => Boolean(trait))
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
    .slice(0, 5);

  const safeTraits =
    traits.length > 0
      ? traits
      : [
          {
            label: "Early-career explorer",
            evidence: "Not enough resume detail yet; add projects, outcomes, tools, and team context.",
            confidence: "low" as SignalConfidence
          }
        ];

  const workStyle = [
    hasPhrase(resumeText, "dashboard") || hasPhrase(resumeText, "tableau") || hasPhrase(resumeText, "power bi")
      ? "visualizes complex information"
      : "",
    hasPhrase(resumeText, "optimization") || hasPhrase(resumeText, "improved") || hasPhrase(resumeText, "optimized")
      ? "looks for measurable improvements"
      : "",
    hasPhrase(resumeText, "operations") || hasPhrase(resumeText, "supply chain") || hasPhrase(resumeText, "inventory")
      ? "thinks in systems and workflows"
      : "",
    hasPhrase(resumeText, "stakeholder") || hasPhrase(resumeText, "client") || hasPhrase(resumeText, "presented")
      ? "translates analysis for non-technical partners"
      : "",
    hasPhrase(resumeText, "project") || hasPhrase(resumeText, "built") ? "learns by building applied projects" : ""
  ].filter(Boolean);

  return {
    summary: buildPersonalitySummary(safeTraits),
    traits: safeTraits,
    workStyle: workStyle.length > 0 ? [...new Set(workStyle)].slice(0, 4) : ["needs more resume evidence"],
    communicationStyle: getCommunicationStyle(resumeText)
  };
}

function inferGoals(text: string, targetRoles: string[], visaSponsorshipNeeded: boolean) {
  const goals = [
    `prioritize ${targetRoles[0]?.toLowerCase() ?? "analyst"} internships with strong skill overlap`,
    visaSponsorshipNeeded ? "focus on sponsorship-friendly employers" : "",
    hasPhrase(text, "supply chain") || hasPhrase(text, "operations") ? "build experience in operations and planning teams" : "",
    hasPhrase(text, "product") || hasPhrase(text, "funnel") ? "grow into product analytics work" : "",
    hasPhrase(text, "machine learning") || hasPhrase(text, "software") ? "apply technical skills in AI/software teams" : ""
  ].filter(Boolean);

  return [...new Set(goals)].slice(0, 4);
}

function buildExtractionNotes({
  normalized,
  roleMatches,
  skills,
  education
}: {
  normalized: string;
  roleMatches: ReturnType<typeof inferTargetRoles>;
  skills: string[];
  education: string[];
}) {
  const notes = [
    roleMatches.length
      ? `Top role inferred from ${roleMatches[0].matchedSignals.slice(0, 4).join(", ")}.`
      : "Role confidence is low; add target titles, project domains, or responsibilities.",
    skills.length ? `${skills.length} skills matched with alias-aware parsing.` : "No clear tools detected; add technical skills explicitly.",
    education.length ? "Education signals detected from degree or school text." : "Education not detected; include degree, major, and university for stronger matching.",
    hasOutcomeMetric(normalized) ? "Quantified outcomes found, which improves profile confidence." : "Add numbers like %, $, time saved, users, or volume to improve accuracy."
  ];

  return notes;
}

function getEvidenceSnippet(resumeText: string, terms: string[]) {
  const normalized = normalizeText(resumeText);
  const lower = normalized.toLowerCase();
  const term = terms.find((item) => hasPhrase(normalized, item));
  if (!term) return null;
  const index = lower.indexOf(term.toLowerCase());
  const start = Math.max(0, index - 42);
  const end = Math.min(normalized.length, index + term.length + 58);
  const snippet = normalized.slice(start, end).trim();
  return `${start > 0 ? "..." : ""}${snippet}${end < normalized.length ? "..." : ""}`;
}

function getCommunicationStyle(text: string) {
  if (hasPhrase(text, "stakeholder") || hasPhrase(text, "client") || hasPhrase(text, "presented") || hasPhrase(text, "communicated")) {
    return "Business-facing communicator who can frame analysis for stakeholders.";
  }
  if (hasPhrase(text, "dashboard") || hasPhrase(text, "tableau") || hasPhrase(text, "power bi") || hasPhrase(text, "report")) {
    return "Visual communicator who appears comfortable turning data into dashboards or reports.";
  }
  if (hasPhrase(text, "research") || hasPhrase(text, "model") || hasPhrase(text, "python") || hasPhrase(text, "sql")) {
    return "Analytical communicator who likely explains decisions through data and method.";
  }
  return "Not enough direct communication evidence yet; add presentations, teamwork, or stakeholder examples.";
}

function hasPhrase(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i").test(text);
}

function hasOutcomeMetric(text: string) {
  return /\b\d+(?:\.\d+)?\s*(?:%|percent|k|m|hours?|days?|weeks?|users?|orders?|units?|\$)\b/i.test(text);
}

function getConfidence(matchCount: number): SignalConfidence {
  if (matchCount >= 4) return "high";
  if (matchCount >= 2) return "medium";
  return "low";
}

function confidenceRank(confidence: SignalConfidence) {
  return { low: 1, medium: 2, high: 3 }[confidence];
}

function buildPersonalitySummary(traits: CandidateProfile["personality"]["traits"]) {
  const topTraits = traits.slice(0, 3).map((trait) => trait.label.toLowerCase());
  if (traits[0]?.confidence === "low") {
    return "Personality confidence is low until the resume includes more outcomes, teamwork, and leadership evidence.";
  }
  return `Likely ${topTraits.join(", ")} based on resume language and project signals.`;
}

function normalizeText(text: string) {
  return text.replace(/[•·]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanPhrase(text: string) {
  return text.replace(/[.,;:|()[\]{}]+$/g, "").replace(/\s+/g, " ").trim();
}

function toTitleCase(text: string) {
  return text
    .toLowerCase()
    .split(" ")
    .map((word) => {
      if (["asu", "mba", "ph.d."].includes(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
