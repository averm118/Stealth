import type {
  CompetitionLevel,
  IngestedJobRecord,
  Job,
  JobSource,
  SponsorshipFriendliness,
  WorkType
} from "@/lib/types";
import type { JobSourceConfig } from "@/lib/job-ingestion/source-registry";
import type { ManualJobInput, NormalizerInput, RawPosting, ScrapedJobInput } from "@/lib/job-ingestion/types";

const skillTaxonomy = [
  "excel",
  "sql",
  "python",
  "r",
  "tableau",
  "power bi",
  "looker",
  "forecasting",
  "inventory",
  "supply chain",
  "operations",
  "procurement",
  "supplier management",
  "logistics",
  "analytics",
  "business analytics",
  "product analytics",
  "a/b testing",
  "experimentation",
  "stakeholder management",
  "jira",
  "sap",
  "erp",
  "figma",
  "typescript",
  "javascript",
  "react",
  "next.js",
  "node.js",
  "aws",
  "machine learning",
  "data pipelines",
  "rest api"
];

const famousCompanies = new Set([
  "airbnb",
  "amazon",
  "anthropic",
  "apple",
  "databricks",
  "google",
  "meta",
  "microsoft",
  "netflix",
  "openai",
  "stripe",
  "tesla",
  "waymo"
]);

const relevantRoleKeywords = [
  "intern",
  "internship",
  "co-op",
  "co op",
  "university",
  "student",
  "new grad",
  "new graduate",
  "graduate program",
  "early career",
  "early talent",
  "university hire",
  "campus",
  "rotational",
  "development program",
  "entry level",
  "entry-level",
  "associate analyst",
  "analyst",
  "data",
  "operations",
  "supply chain",
  "procurement",
  "product analytics",
  "business analyst",
  "software engineer intern",
  "ai"
];

const seniorityExclusions = [
  "senior",
  "sr ",
  "manager",
  "lead",
  "head",
  "principal",
  "staff",
  "director"
];

export function normalizeProviderPosting(input: NormalizerInput): IngestedJobRecord | null {
  if (input.source === "greenhouse") return normalizeGreenhousePosting(input);
  if (input.source === "lever") return normalizeLeverPosting(input);
  if (input.source === "ashby") return normalizeAshbyPosting(input);
  if (input.source === "workday") return normalizeWorkdayPosting(input);
  return normalizeManualPosting(input.posting as ManualJobInput, input.importedAt);
}

export function normalizeManualPosting(posting: ManualJobInput, importedAt: string): IngestedJobRecord | null {
  const company = cleanText(posting.company);
  const title = cleanText(posting.title);
  const location = normalizeLocation(cleanText(posting.location));
  const applyUrl = cleanText(posting.applyUrl);
  const description = normalizeDescription(typeof posting.description === "string" ? posting.description.trim() : "");
  const rawLocation = cleanText(posting.location);
  const sourceJobId = cleanText(posting.sourceJobId) || stableSlug(`${company}-${title}-${applyUrl}`);
  const qualityWarnings = getQualityWarnings({ title, company, applyUrl, location, description });

  if (qualityWarnings.some((warning) => warning.startsWith("missing"))) return null;

  return {
    id: createJobId("manual", company, sourceJobId),
    company,
    title,
    location,
    workType: normalizeWorkType(posting.workType) ?? inferWorkType(`${title} ${location} ${description}`),
    postedDate: normalizeDate(posting.postedDate, importedAt),
    sponsorshipFriendly: normalizeSponsorship(posting.sponsorshipFriendly) ?? "unknown",
    competitionLevel: normalizeCompetition(posting.competitionLevel) ?? inferCompetition(company),
    skills: normalizeSkills(posting.skills, `${title} ${description}`),
    description,
    applyUrl,
    metadata: {
      source: "manual",
      sourceJobId,
      sourceUrl: cleanText(posting.sourceUrl) || applyUrl,
      sourceCategory: "operations",
      importedAt,
      rawLocation,
      qualityWarnings
    }
  };
}

export function normalizeScrapedJobInput(posting: ScrapedJobInput, importedAt: string): IngestedJobRecord | null {
  const company = cleanText(posting.company);
  const title = cleanText(posting.title);
  const rawLocation = cleanText(posting.rawLocation) || cleanText(posting.location);
  const location = normalizeLocation(rawLocation);
  const applyUrl = cleanText(posting.applyUrl);
  const sourceUrl = cleanText(posting.sourceUrl) || applyUrl;
  const description = normalizeDescription(cleanText(posting.description));
  const sourceJobId = cleanText(posting.sourceJobId) || stableSlug(`${company}-${title}-${applyUrl}`);
  const qualityWarnings = getQualityWarnings({ title, company, applyUrl, location, description });

  if (qualityWarnings.some((warning) => warning.startsWith("missing"))) return null;

  const extractionWarning = posting.extractionMethod ? `scraped with ${posting.extractionMethod}` : "scraped from company careers page";

  return {
    id: createJobId("company_careers", company, sourceJobId),
    company,
    title,
    location,
    workType: normalizeWorkType(posting.workType) ?? inferWorkType(`${title} ${location} ${description}`),
    postedDate: normalizeDate(posting.postedDate, importedAt),
    sponsorshipFriendly: normalizeSponsorship(posting.sponsorshipFriendly) ?? "unknown",
    competitionLevel: normalizeCompetition(posting.competitionLevel) ?? inferCompetition(company),
    skills: normalizeSkills(posting.skills, `${title} ${description}`),
    description,
    applyUrl,
    metadata: {
      source: "company_careers",
      sourceJobId,
      sourceUrl,
      sourceCategory: posting.sourceCategory,
      importedAt,
      rawLocation,
      qualityWarnings: [...qualityWarnings, extractionWarning]
    }
  };
}

function normalizeGreenhousePosting({ config, posting, importedAt }: NormalizerInput): IngestedJobRecord | null {
  if (!config) return null;
  const sourceJobId = stringify(posting.id) || stableSlug(`${config.company}-${stringify(posting.title)}`);
  const title = cleanText(posting.title);
  const rawLocation = getNestedText(posting, ["location", "name"]);
  const location = normalizeLocation(rawLocation);
  const content = stringValue(posting.content) || stringValue(posting.description);
  const applyUrl = cleanText(posting.absolute_url) || cleanText(posting.url);
  const description = normalizeDescription(content || title);
  const qualityWarnings = getQualityWarnings({ title, company: config.company, applyUrl, location, description });

  if (qualityWarnings.some((warning) => warning.startsWith("missing"))) return null;

  return buildRecord({
    source: "greenhouse",
    config,
    sourceJobId,
    sourceUrl: applyUrl,
    title,
    location,
    rawLocation,
    description,
    applyUrl,
    importedAt,
    textForSkills: `${title} ${stripHtml(content)}`
  });
}

function normalizeLeverPosting({ config, posting, importedAt }: NormalizerInput): IngestedJobRecord | null {
  if (!config) return null;
  const sourceJobId = stringify(posting.id) || stableSlug(`${config.company}-${stringify(posting.text)}`);
  const title = cleanText(posting.text) || cleanText(posting.title);
  const rawLocation = getNestedText(posting, ["categories", "location"]) || cleanText(posting.location);
  const location = normalizeLocation(rawLocation);
  const descriptionPlain = stringValue(posting.descriptionPlain) || stringValue(posting.description);
  const lists = Array.isArray(posting.lists)
    ? posting.lists
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const record = item as Record<string, unknown>;
          const heading = cleanText(record.text);
          const content = stringValue(record.content);
          return [heading, content].filter(Boolean).join("\n");
        })
        .filter(Boolean)
        .join("\n\n")
    : "";
  const hostedUrl = cleanText(posting.hostedUrl) || cleanText(posting.applyUrl);
  const description = normalizeDescription(`${descriptionPlain}\n\n${lists}`.trim() || title);
  const qualityWarnings = getQualityWarnings({ title, company: config.company, applyUrl: hostedUrl, location, description });

  if (qualityWarnings.some((warning) => warning.startsWith("missing"))) return null;

  return buildRecord({
    source: "lever",
    config,
    sourceJobId,
    sourceUrl: hostedUrl,
    title,
    location,
    rawLocation,
    description,
    applyUrl: hostedUrl,
    importedAt,
    textForSkills: `${title} ${stripHtml(descriptionPlain)} ${stripHtml(lists)}`
  });
}

function normalizeAshbyPosting({ config, posting, importedAt }: NormalizerInput): IngestedJobRecord | null {
  if (!config) return null;
  const sourceJobId = stringify(posting.id) || stableSlug(`${config.company}-${stringify(posting.title)}`);
  const title = cleanText(posting.title);
  const rawLocation = cleanText(posting.location) || getNestedText(posting, ["location", "name"]);
  const location = normalizeLocation(rawLocation);
  const descriptionHtml = stringValue(posting.descriptionHtml) || stringValue(posting.description);
  const description = normalizeDescription(descriptionHtml || title);
  const applyUrl = cleanText(posting.applyUrl) || cleanText(posting.jobUrl) || cleanText(posting.url);
  const qualityWarnings = getQualityWarnings({ title, company: config.company, applyUrl, location, description });

  if (qualityWarnings.some((warning) => warning.startsWith("missing"))) return null;

  return buildRecord({
    source: "ashby",
    config,
    sourceJobId,
    sourceUrl: applyUrl,
    title,
    location,
    rawLocation,
    description,
    applyUrl,
    importedAt,
    textForSkills: `${title} ${stripHtml(descriptionHtml)}`
  });
}

function normalizeWorkdayPosting({ config, posting, importedAt }: NormalizerInput): IngestedJobRecord | null {
  if (!config?.workday) return null;
  const detail = getNestedObject(posting, ["_workdayDetail"]);
  const info = getNestedObject(detail, ["jobPostingInfo"]) || detail || {};
  const sourceJobId =
    cleanText(info.jobReqId) ||
    cleanText(info.jobRequisitionId) ||
    cleanText(info.id) ||
    cleanText(posting.bulletFields) ||
    cleanText(posting.externalPath) ||
    stableSlug(`${config.company}-${stringify(posting.title)}`);
  const title = cleanText(info.title) || cleanText(posting.title);
  const rawLocation =
    cleanText(info.jobRequisitionLocationText) ||
    cleanText(info.location) ||
    cleanText(info.locationText) ||
    cleanText(posting.locationsText) ||
    getWorkdayLocationsText(posting.locations);
  const location = normalizeLocation(rawLocation);
  const descriptionHtml = stringValue(info.jobDescription) || stringValue(info.description) || stringValue(posting.description);
  const description = normalizeDescription(descriptionHtml || title);
  const externalPath = cleanText(posting.externalPath);
  const sourceUrl = getWorkdaySourceUrl(config, externalPath);
  const applyUrl = normalizeUrl(cleanText(info.externalUrl) || cleanText(info.applyUrl) || sourceUrl, config.workday.host);
  const postedDate = normalizeWorkdayDate(cleanText(posting.postedOn) || cleanText(info.postedOn) || cleanText(info.startDate), importedAt);
  const qualityWarnings = getQualityWarnings({ title, company: config.company, applyUrl, location, description });

  if (qualityWarnings.some((warning) => warning.startsWith("missing"))) return null;

  return {
    ...buildRecord({
      source: "workday",
      config,
      sourceJobId,
      sourceUrl,
      title,
      location,
      rawLocation,
      description,
      applyUrl,
      importedAt,
      textForSkills: `${title} ${stripHtml(descriptionHtml)} ${rawLocation} ${cleanText(posting.bulletFields)}`
    }),
    postedDate
  };
}

function buildRecord({
  source,
  config,
  sourceJobId,
  sourceUrl,
  title,
  location,
  rawLocation,
  description,
  applyUrl,
  importedAt,
  textForSkills
}: {
  source: Exclude<JobSource, "mock" | "manual" | "company_careers">;
  config: JobSourceConfig;
  sourceJobId: string;
  sourceUrl: string;
  title: string;
  location: string;
  rawLocation: string;
  description: string;
  applyUrl: string;
  importedAt: string;
  textForSkills: string;
}): IngestedJobRecord {
  const qualityWarnings = getQualityWarnings({ title, company: config.company, applyUrl, location, description });

  return {
    id: createJobId(source, config.company, sourceJobId),
    company: config.company,
    title,
    location,
    workType: inferWorkType(`${title} ${location} ${description}`),
    postedDate: importedAt.slice(0, 10),
    sponsorshipFriendly: config.sponsorshipFriendly ?? "unknown",
    competitionLevel: config.competitionLevel ?? inferCompetition(config.company),
    skills: extractSkills(textForSkills),
    description,
    applyUrl,
    metadata: {
      source,
      sourceJobId,
      sourceUrl,
      sourceCategory: config.category,
      importedAt,
      rawLocation,
      qualityWarnings
    }
  };
}

export function dedupeJobs(records: IngestedJobRecord[]) {
  const seen = new Set<string>();
  const deduped: IngestedJobRecord[] = [];

  for (const record of records) {
    const key = record.id || stableSlug(`${record.company}-${record.title}-${record.location}`);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}

export function toUiJob(record: IngestedJobRecord): Job {
  const { metadata: _metadata, ...job } = record;
  return job;
}

export function isRelevantStudentRole(record: IngestedJobRecord) {
  const title = normalizeSearchText(record.title);
  const fullText = normalizeSearchText(`${record.title} ${record.description}`);
  if (hasSeniorityExclusion(title)) return false;
  const hasRelevantTitle = relevantRoleKeywords.some((keyword) => hasKeyword(title, keyword));
  const hasStudentSignal = hasExplicitStudentSignal(fullText);
  if (!hasRelevantTitle && !hasStudentSignal) return false;
  if (hasHardExperienceRequirement(fullText) && !hasStudentSignal) return false;
  return true;
}

function hasSeniorityExclusion(title: string) {
  return seniorityExclusions.some((keyword) => {
    const normalized = normalizeSearchText(keyword).trim();
    if (!normalized) return false;
    return new RegExp(`(^|\\s)${escapeRegex(normalized)}(\\s|$)`).test(title);
  });
}

function hasExplicitStudentSignal(text: string) {
  return [
    "intern",
    "internship",
    "co op",
    "co-op",
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
    "entry-level"
  ].some((term) => hasKeyword(text, term));
}

function hasHardExperienceRequirement(text: string) {
  const protectedText = text.replace(/\b0\s*-\s*[2-9]\s+years?\b/g, "0 years").replace(/\b0\s+to\s+[2-9]\s+years?\b/g, "0 years");
  const patterns = [
    /\b(?:minimum|min|at least|required|requires|requirement)\s+(?:of\s+)?(?:[2-9]|[1-9]\d)\+?\s+years?\b.{0,90}\bexperience\b/i,
    /\b(?:[2-9]|[1-9]\d)\+?\s+years?\s+(?:of\s+)?(?:professional\s+|relevant\s+|work\s+|industry\s+)?experience\b/i,
    /\bexperience\s+(?:of|with)\s+(?:[2-9]|[1-9]\d)\+?\s+years?\b/i,
    /\b(?:[2-9]|[1-9]\d)\+?\s+years?\s+in\s+(?:a\s+)?(?:professional|similar|related|relevant)\b/i,
    /\bprofessional\s+experience\s+required\b/i
  ];

  return patterns.some((pattern) => pattern.test(protectedText));
}

function getQualityWarnings({
  title,
  company,
  applyUrl,
  location,
  description
}: {
  title: string;
  company: string;
  applyUrl: string;
  location: string;
  description: string;
}) {
  const warnings: string[] = [];
  if (!title) warnings.push("missing title");
  if (!company) warnings.push("missing company");
  if (!applyUrl || !/^https?:\/\//i.test(applyUrl)) warnings.push("missing applyUrl");
  if (!location) warnings.push("missing location");
  if (!description || description.length < 24) warnings.push("short description");
  return warnings;
}

function extractSkills(text: string) {
  const normalized = normalizeSearchText(text);
  const skills = skillTaxonomy.filter((skill) => hasSkill(normalized, skill));
  return skills.length ? skills.slice(0, 8) : ["analytics"];
}

function normalizeSkills(skills: unknown, fallbackText: string) {
  if (!Array.isArray(skills)) return extractSkills(fallbackText);
  const cleaned = skills.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return [...new Set(cleaned)].slice(0, 8).length ? [...new Set(cleaned)].slice(0, 8) : extractSkills(fallbackText);
}

function inferWorkType(text: string): WorkType {
  const normalized = normalizeSearchText(text);
  if (normalized.includes("remote")) return "Remote";
  if (normalized.includes("hybrid")) return "Hybrid";
  return "On-site";
}

function normalizeWorkType(value: unknown): WorkType | null {
  if (value === "Remote" || value === "Hybrid" || value === "On-site") return value;
  return null;
}

function normalizeSponsorship(value: unknown): SponsorshipFriendliness | null {
  if (value === "high" || value === "medium" || value === "low" || value === "unknown") return value;
  return null;
}

function normalizeCompetition(value: unknown): CompetitionLevel | null {
  if (value === "high" || value === "medium" || value === "low") return value;
  return null;
}

function inferCompetition(company: string): CompetitionLevel {
  return famousCompanies.has(company.toLowerCase()) ? "high" : "medium";
}

function normalizeDate(value: unknown, importedAt: string) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return importedAt.slice(0, 10);
}

function normalizeLocation(value: string) {
  const cleaned = cleanText(value);
  if (!cleaned) return "";
  return cleaned.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDescription(value: string) {
  return formatJobDescription(value).slice(0, 12000).trim();
}

function stripHtml(value: string) {
  return cleanText(formatJobDescription(value));
}

function formatJobDescription(value: string) {
  const withoutUnsafe = decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const withStructure = withoutUnsafe
    .replace(/<(h[1-6])[^>]*>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<div[^>]*>/gi, "")
    .replace(/<\/section>/gi, "\n\n")
    .replace(/<section[^>]*>/gi, "")
    .replace(/<\/ul>|<\/ol>/gi, "\n")
    .replace(/<ul[^>]*>|<ol[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<strong[^>]*>|<b[^>]*>/gi, "")
    .replace(/<\/strong>|<\/b>/gi, "")
    .replace(/<[^>]+>/g, " ");

  return withStructure
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?:^|\n)-\s*(?=\n|$)/g, "\n")
    .trim();
}

function getNestedText(record: RawPosting, path: string[]) {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return cleanText(current);
}

function getNestedObject(record: unknown, path: string[]) {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === "object" ? (current as RawPosting) : null;
}

function getWorkdayLocationsText(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return cleanText(record.location) || cleanText(record.descriptor) || cleanText(record.name);
      }
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringify(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

function normalizeUrl(value: string, host: string) {
  if (/^https?:\/\//i.test(value)) return value;
  if (!value) return "";
  return `${host.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
}

function getWorkdaySourceUrl(config: JobSourceConfig, externalPath: string) {
  const host = config.workday?.host.replace(/\/+$/, "") ?? "";
  if (!host || !externalPath) return "";
  return `${host}/${externalPath.replace(/^\/+/, "")}`;
}

function normalizeWorkdayDate(value: string, importedAt: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const daysAgo = value.match(/posted\s+(\d+)\s+days?\s+ago/i)?.[1];
  if (daysAgo) {
    const date = new Date(importedAt);
    date.setUTCDate(date.getUTCDate() - Number(daysAgo));
    return date.toISOString().slice(0, 10);
  }
  if (/posted\s+yesterday/i.test(value)) {
    const date = new Date(importedAt);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }
  return importedAt.slice(0, 10);
}

function createJobId(source: JobSource, company: string, sourceJobId: string) {
  return `${source}-${stableSlug(company)}-${stableSlug(sourceJobId)}`;
}

function stableSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ");
}

function hasSkill(normalizedText: string, skill: string) {
  return hasKeyword(normalizedText, skill);
}

function hasKeyword(normalizedText: string, skill: string) {
  const normalizedSkill = normalizeSearchText(skill).trim();
  if (normalizedSkill.length <= 2) {
    return new RegExp(`(^|\\s)${escapeRegex(normalizedSkill)}(\\s|$)`).test(normalizedText);
  }

  return normalizedText.includes(normalizedSkill);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
