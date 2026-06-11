import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { callGeminiJson } from "@/lib/gemini";
import { normalizeJobLocation } from "@/lib/job-location";
import type {
  CompetitionLevel,
  IngestedJobRecord,
  Job,
  JobSourceCategory,
  SponsorshipFriendliness,
  WorkType
} from "@/lib/types";

export type JobUrlSourceHint = "auto" | "company" | "linkedin" | "handshake" | "ziprecruiter" | "other";
export type JobUrlExtractionSource = "ats" | "json_ld" | "html" | "paste" | "gemini";

export type JobUrlImportInput = {
  url: string;
  pastedText?: string;
  sourceHint?: JobUrlSourceHint;
};

export type JobUrlImportResult =
  | {
      status: "imported";
      record: IngestedJobRecord;
      extractionSource: JobUrlExtractionSource;
      warnings: string[];
    }
  | {
      status: "needs_paste";
      reason: string;
      warnings: string[];
    };

type ExtractedJob = Partial<Job> & {
  sourceJobId?: string;
  sourceUrl?: string;
  rawLocation?: string;
  sourceCategory?: JobSourceCategory;
};

const maxFetchedBytes = 1_200_000;
const maxPastedChars = 32_000;
const maxGeminiChars = 24_000;
const fetchTimeoutMs = 8500;
const redirectLimit = 4;
const userAgent = "StealthJobImporter/1.0 (+https://stealth.local; student job import)";

const thirdPartyHosts = ["linkedin.com", "handshake.co", "joinhandshake.com", "ziprecruiter.com", "indeed.com"];

const skillTaxonomy = [
  "excel",
  "sql",
  "python",
  "tableau",
  "power bi",
  "forecasting",
  "inventory",
  "supply chain",
  "operations",
  "procurement",
  "logistics",
  "analytics",
  "business analytics",
  "product analytics",
  "stakeholder management",
  "sap",
  "erp",
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

export async function importJobFromUrl(input: JobUrlImportInput, importedAt = new Date().toISOString()): Promise<JobUrlImportResult> {
  const warnings: string[] = [];
  const safeUrl = validatePublicJobUrl(input.url);
  const canonicalUrl = canonicalizeUrl(safeUrl);
  const sourceHint = input.sourceHint ?? "auto";
  const pastedText = typeof input.pastedText === "string" ? input.pastedText.trim().slice(0, maxPastedChars) : "";

  if (pastedText) {
    const fromPaste = await normalizeWithGemini({
      url: canonicalUrl,
      sourceHint,
      text: pastedText,
      warnings,
      extractionSource: "paste",
      importedAt
    });
    if (fromPaste) return fromPaste;

    const deterministic = normalizeUserSubmittedJob(
      {
        ...extractFromPlainText(pastedText),
        applyUrl: canonicalUrl,
        sourceUrl: canonicalUrl
      },
      importedAt,
      [...warnings, "Imported from pasted job text."]
    );
    if (deterministic) {
      return { status: "imported", record: deterministic, extractionSource: "paste", warnings: deterministic.metadata.qualityWarnings };
    }

    return {
      status: "needs_paste",
      reason: "The pasted job text is missing a clear title, company, or description.",
      warnings: [...warnings, "Paste fallback could not be normalized."]
    };
  }

  if (isKnownThirdPartyJobBoard(canonicalUrl) || sourceHint === "linkedin" || sourceHint === "handshake" || sourceHint === "ziprecruiter") {
    return {
      status: "needs_paste",
      reason: "This job board usually blocks automated import. Paste the posting text and Stealth will normalize it into a job page.",
      warnings: [...warnings, "Protected third-party board detected; paste fallback requested."]
    };
  }

  const atsJob = await tryKnownAtsExtraction(canonicalUrl, importedAt, warnings);
  if (atsJob) return { status: "imported", record: atsJob, extractionSource: "ats", warnings: atsJob.metadata.qualityWarnings };

  const fetched = await fetchPublicText(canonicalUrl);
  if (!fetched.ok) {
    return {
      status: "needs_paste",
      reason: fetched.reason,
      warnings: [...warnings, fetched.reason]
    };
  }

  const blockedReason = detectBlockedOrLoginPage(fetched.text, safeUrl.hostname);
  if (blockedReason) {
    return {
      status: "needs_paste",
      reason: blockedReason,
      warnings: [...warnings, blockedReason]
    };
  }

  const jsonLdJob = extractJsonLdJob(fetched.text, canonicalUrl, importedAt, warnings);
  if (jsonLdJob) return { status: "imported", record: jsonLdJob, extractionSource: "json_ld", warnings: jsonLdJob.metadata.qualityWarnings };

  const htmlJob = normalizeUserSubmittedJob(extractFromHtml(fetched.text, canonicalUrl), importedAt, warnings);
  if (htmlJob && isStrongEnoughHtmlExtraction(htmlJob)) {
    return { status: "imported", record: htmlJob, extractionSource: "html", warnings: htmlJob.metadata.qualityWarnings };
  }

  const readableText = htmlToText(fetched.text).slice(0, maxGeminiChars);
  const geminiJob = await normalizeWithGemini({
    url: canonicalUrl,
    sourceHint,
    text: readableText,
    warnings,
    extractionSource: "gemini",
    importedAt
  });

  if (geminiJob) return geminiJob;

  return {
    status: "needs_paste",
    reason: getNeedsPasteReason(canonicalUrl, readableText),
    warnings: [...warnings, "Automatic extraction did not find enough usable job details."]
  };
}

export function validatePublicJobUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid job posting URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https job URLs are supported.");
  }

  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error("Private, local, and internal URLs cannot be imported.");
  }

  return parsed;
}

function normalizeUserSubmittedJob(job: ExtractedJob, importedAt: string, warnings: string[]): IngestedJobRecord | null {
  const company = cleanInline(job.company);
  const title = cleanInline(job.title);
  const rawLocation = cleanInline(job.rawLocation || job.location || "");
  const location = normalizeJobLocation(rawLocation, "Not specified");
  const applyUrl = cleanInline(job.applyUrl || job.sourceUrl || "");
  const sourceUrl = cleanInline(job.sourceUrl || applyUrl);
  const description = normalizeDescription(job.description || "");
  const qualityWarnings = [...warnings];

  if (!title) qualityWarnings.push("missing title");
  if (!company) qualityWarnings.push("missing company");
  if (!applyUrl || !/^https?:\/\//i.test(applyUrl)) qualityWarnings.push("missing applyUrl");
  if (!rawLocation) qualityWarnings.push("missing location; stored as Not specified");
  if (rawLocation && location === "Not specified") qualityWarnings.push("unclear location; stored as Not specified");
  if (!description || description.length < 80) qualityWarnings.push("short description");

  if (!title || !company || !applyUrl || !description || description.length < 80) return null;

  const sourceJobId = cleanInline(job.sourceJobId) || sha1(`${canonicalizeUrl(new URL(applyUrl))}:${company}:${title}`).slice(0, 24);
  const textForSkills = `${title} ${description}`;

  return {
    id: `user-submitted-${stableSlug(company)}-${stableSlug(sourceJobId)}`,
    company,
    title,
    location,
    workType: normalizeWorkType(job.workType) ?? inferWorkType(`${title} ${location} ${description}`),
    postedDate: normalizeDate(job.postedDate, importedAt),
    sponsorshipFriendly: normalizeSponsorship(job.sponsorshipFriendly) ?? inferSponsorship(description),
    competitionLevel: normalizeCompetition(job.competitionLevel) ?? "medium",
    skills: normalizeSkills(job.skills, textForSkills),
    description,
    applyUrl,
    metadata: {
      source: "user_submitted",
      sourceJobId,
      sourceUrl,
      sourceCategory: job.sourceCategory ?? inferSourceCategory(textForSkills),
      importedAt,
      rawLocation,
      qualityWarnings: [...new Set(qualityWarnings)]
    }
  };
}

async function tryKnownAtsExtraction(url: string, importedAt: string, warnings: string[]) {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);

  try {
    if (hostname === "jobs.lever.co" && parts.length >= 2) {
      const [site, postingId] = parts;
      const data = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}/${encodeURIComponent(postingId)}`);
      const record = normalizeUserSubmittedJob(
        {
          company: cleanInline(site.replace(/[-_]+/g, " ")),
          title: cleanInline(data.text) || cleanInline(data.title),
          location: nestedText(data, ["categories", "location"]) || cleanInline(data.location),
          description: [data.descriptionPlain, data.description, leverListsToText(data.lists)].filter(Boolean).join("\n\n"),
          applyUrl: cleanInline(data.hostedUrl) || url,
          sourceUrl: cleanInline(data.hostedUrl) || url,
          sourceJobId: cleanInline(data.id) || postingId
        },
        importedAt,
        [...warnings, "Imported through Lever public posting API."]
      );
      return record;
    }

    if ((hostname === "boards.greenhouse.io" || hostname === "job-boards.greenhouse.io") && parts.length >= 3 && parts[1] === "jobs") {
      const board = parts[0];
      const jobId = parts[2];
      const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(jobId)}`);
      const record = normalizeUserSubmittedJob(
        {
          company: cleanInline(board.replace(/[-_]+/g, " ")),
          title: cleanInline(data.title),
          location: nestedText(data, ["location", "name"]),
          description: cleanInline(data.content) || cleanInline(data.description) || cleanInline(data.title),
          applyUrl: cleanInline(data.absolute_url) || url,
          sourceUrl: cleanInline(data.absolute_url) || url,
          sourceJobId: cleanInline(data.id) || jobId
        },
        importedAt,
        [...warnings, "Imported through Greenhouse public job board API."]
      );
      return record;
    }

    if (hostname === "jobs.ashbyhq.com" && parts.length >= 2) {
      const board = parts[0];
      const jobSlugOrId = parts[1];
      const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`);
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      const match = jobs.find((job: Record<string, unknown>) => {
        const id = cleanInline(job.id);
        const slug = cleanInline(job.slug);
        const jobUrl = cleanInline(job.jobUrl) || cleanInline(job.applyUrl);
        return id === jobSlugOrId || slug === jobSlugOrId || jobUrl.includes(jobSlugOrId);
      });

      if (match) {
        return normalizeUserSubmittedJob(
          {
            company: cleanInline(board.replace(/[-_]+/g, " ")),
            title: cleanInline(match.title),
            location: cleanInline(match.location),
            description: cleanInline(match.descriptionHtml) || cleanInline(match.description) || cleanInline(match.title),
            applyUrl: cleanInline(match.applyUrl) || cleanInline(match.jobUrl) || url,
            sourceUrl: cleanInline(match.jobUrl) || cleanInline(match.applyUrl) || url,
            sourceJobId: cleanInline(match.id) || jobSlugOrId
          },
          importedAt,
          [...warnings, "Imported through Ashby public job board API."]
        );
      }
    }
  } catch (error) {
    warnings.push(`ATS extraction failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  return null;
}

async function normalizeWithGemini({
  url,
  sourceHint,
  text,
  warnings,
  extractionSource,
  importedAt
}: {
  url: string;
  sourceHint: JobUrlSourceHint;
  text: string;
  warnings: string[];
  extractionSource: JobUrlExtractionSource;
  importedAt: string;
}): Promise<JobUrlImportResult | null> {
  if (text.trim().length < 120) return null;

  try {
    const parsed = await callGeminiJson<ExtractedJob>({
      task: "job_import",
      maxTokens: 1800,
      schemaName: "job_url_import_normalization",
      schema: jobUrlImportSchema,
      messages: [
        {
          role: "system",
          content: [
            "You normalize public job postings into a concise job record for a student career app.",
            "Use only facts present in the provided URL/text.",
            "Do not invent company names, locations, sponsorship claims, requirements, dates, or skills.",
            "If a field is missing, leave it empty. Keep description factual and compact."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            `Source hint: ${sourceHint}`,
            `Original URL: ${url}`,
            "Return the job posting details as JSON.",
            "Use applyUrl as the original URL unless the posting text clearly contains a better application URL.",
            "Description should preserve the important responsibilities, requirements, and student/new-grad notes.",
            "",
            text.slice(0, maxGeminiChars)
          ].join("\n")
        }
      ]
    });

    const normalized = normalizeUserSubmittedJob(
      {
        ...parsed,
        applyUrl: parsed.applyUrl || url,
        sourceUrl: url
      },
      importedAt,
      [...warnings, extractionSource === "paste" ? "Imported from pasted job text." : "Normalized with Gemini from fetched job content."]
    );

    if (!normalized) return null;
    return { status: "imported", record: normalized, extractionSource, warnings: normalized.metadata.qualityWarnings };
  } catch (error) {
    warnings.push(`Gemini normalization failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  }
}

async function fetchPublicText(url: string): Promise<{ ok: true; text: string; finalUrl: string } | { ok: false; reason: string }> {
  let current = url;

  for (let redirects = 0; redirects <= redirectLimit; redirects += 1) {
    const parsed = validatePublicJobUrl(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      const response = await fetch(parsed.toString(), {
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.8"
        },
        redirect: "manual",
        signal: controller.signal
      });

      clearTimeout(timeout);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) return { ok: false, reason: "The job URL redirected without a destination." };
        current = new URL(location, parsed).toString();
        continue;
      }

      if (response.status === 401 || response.status === 403) return { ok: false, reason: "This posting is login-gated or blocked. Paste the job text to import it." };
      if (response.status === 429) return { ok: false, reason: "This posting is rate limited. Paste the job text to import it." };
      if (!response.ok) return { ok: false, reason: `The posting returned HTTP ${response.status}. Paste the job text to import it.` };

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxFetchedBytes) {
        return { ok: false, reason: "This posting page is too large to import automatically. Paste the job text instead." };
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxFetchedBytes) {
        return { ok: false, reason: "This posting page is too large to import automatically. Paste the job text instead." };
      }

      return { ok: true, text: new TextDecoder().decode(buffer), finalUrl: parsed.toString() };
    } catch (error) {
      clearTimeout(timeout);
      return {
        ok: false,
        reason: error instanceof Error && error.name === "AbortError"
          ? "The job page took too long to respond. Paste the job text to import it."
          : "The job page could not be fetched. Paste the job text to import it."
      };
    }
  }

  return { ok: false, reason: "The job URL redirected too many times. Paste the job text to import it." };
}

async function fetchJson(url: string) {
  const fetched = await fetchPublicText(url);
  if (!fetched.ok) throw new Error(fetched.reason);
  return JSON.parse(fetched.text) as Record<string, unknown>;
}

function extractJsonLdJob(html: string, sourceUrl: string, importedAt: string, warnings: string[]) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    const rawJson = decodeHtmlEntities(script[1] ?? "").trim();
    if (!rawJson) continue;

    try {
      const parsed = JSON.parse(rawJson);
      const posting = findJobPosting(parsed);
      if (!posting) continue;

      const hiringOrg = nestedObject(posting, ["hiringOrganization"]);
      const jobLocation = getJsonLdLocation(posting.jobLocation);
      const applyUrl = cleanInline(posting.url) || cleanInline(posting.applyUrl) || sourceUrl;
      const normalized = normalizeUserSubmittedJob(
        {
          company: cleanInline(hiringOrg?.name) || extractCompanyFromTitle(html),
          title: cleanInline(posting.title),
          location: jobLocation,
          rawLocation: jobLocation,
          description: cleanInline(posting.description) || htmlToText(cleanInline(posting.responsibilities)),
          applyUrl,
          sourceUrl,
          sourceJobId: cleanInline(posting.identifier) || sha1(`${sourceUrl}:${cleanInline(posting.title)}`).slice(0, 24),
          postedDate: cleanInline(posting.datePosted)
        },
        importedAt,
        [...warnings, "Imported from JSON-LD JobPosting data."]
      );
      if (normalized) return normalized;
    } catch {
      warnings.push("Malformed JSON-LD job data was skipped.");
    }
  }

  return null;
}

function extractFromHtml(html: string, sourceUrl: string): ExtractedJob {
  const title =
    metaContent(html, "property", "og:title") ||
    metaContent(html, "name", "title") ||
    tagText(html, "title");
  const description =
    metaContent(html, "property", "og:description") ||
    metaContent(html, "name", "description") ||
    htmlToText(html).slice(0, 8000);
  const company = extractCompanyFromTitle(html) || inferCompanyFromUrl(sourceUrl);
  const location = findLocationText(htmlToText(html));

  return {
    company,
    title: cleanJobTitle(title, company),
    location,
    rawLocation: location,
    description,
    applyUrl: sourceUrl,
    sourceUrl,
    sourceJobId: sha1(sourceUrl).slice(0, 24)
  };
}

function extractFromPlainText(text: string): ExtractedJob {
  const lines = text.split(/\n+/).map((line) => cleanInline(line)).filter(Boolean);
  const title = lines.find((line) => /intern|analyst|engineer|associate|manager|specialist|program|co-?op/i.test(line)) ?? lines[0] ?? "";
  const companyLine = lines.find((line) => /company\s*:/i.test(line));
  const locationLine = lines.find((line) => /location\s*:/i.test(line)) ?? lines.find((line) => /\b(remote|hybrid|on-site|onsite|[A-Z][a-z]+,\s*[A-Z]{2})\b/.test(line));

  return {
    title,
    company: companyLine?.replace(/^company\s*:\s*/i, "") ?? "",
    location: locationLine?.replace(/^location\s*:\s*/i, "") ?? "",
    description: text
  };
}

function isStrongEnoughHtmlExtraction(record: IngestedJobRecord) {
  if (record.metadata.qualityWarnings.some((warning) => warning.startsWith("missing"))) return false;
  if (record.company === inferCompanyFromUrl(record.applyUrl) && /job|career|opening/i.test(record.title) && record.description.length < 500) return false;
  return record.description.length >= 180;
}

function detectBlockedOrLoginPage(text: string, hostname: string) {
  const normalized = text.toLowerCase();
  const thirdParty = thirdPartyHosts.some((host) => hostname.toLowerCase().endsWith(host) || hostname.toLowerCase().includes(`.${host}`));
  if (normalized.includes("captcha") || normalized.includes("unusual traffic")) return "This posting is protected by anti-bot checks. Paste the job text to import it.";
  if (thirdParty && /sign in|log in|login|create an account|join to apply|not authorized/.test(normalized)) {
    return "This job board requires a login. Paste the job text to import it.";
  }
  return "";
}

function getNeedsPasteReason(url: string, text: string) {
  const host = new URL(url).hostname;
  const thirdParty = thirdPartyHosts.some((item) => host.endsWith(item) || host.includes(`.${item}`));
  if (thirdParty) return "This job board did not expose enough public details. Paste the job text to import it.";
  if (text.length < 160) return "The job page did not include enough readable text. Paste the job text to import it.";
  return "Stealth could not confidently identify the job details. Paste the job text to import it.";
}

function isKnownThirdPartyJobBoard(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  return thirdPartyHosts.some((item) => host === item || host.endsWith(`.${item}`));
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
  if (types.some((item) => item.toLowerCase() === "jobposting")) return record;

  const graph = record["@graph"];
  if (Array.isArray(graph)) return findJobPosting(graph);

  for (const item of Object.values(record)) {
    const found = findJobPosting(item);
    if (found) return found;
  }

  return null;
}

function getJsonLdLocation(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(getJsonLdLocation).filter(Boolean).join(", ");
  if (typeof value !== "object") return cleanInline(value);

  const record = value as Record<string, unknown>;
  const address = nestedObject(record, ["address"]);
  return [
    cleanInline(address?.addressLocality),
    cleanInline(address?.addressRegion),
    cleanInline(address?.addressCountry) || cleanInline(record.name)
  ].filter(Boolean).join(", ");
}

function leverListsToText(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return [cleanInline(record.text), cleanInline(record.content)].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function htmlToText(html: string) {
  return normalizeDescription(html);
}

function normalizeDescription(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
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
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12000);
}

function cleanInline(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return decodeHtmlEntities(String(value)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanJobTitle(value: string, company: string) {
  let title = cleanInline(value);
  if (company) title = title.replace(new RegExp(`\\s*[|\\-•]\\s*${escapeRegex(company)}\\s*$`, "i"), "");
  return title.replace(/\s*[|•]\s*(careers|jobs).*$/i, "").trim();
}

function extractCompanyFromTitle(html: string) {
  const siteName = metaContent(html, "property", "og:site_name") || metaContent(html, "name", "application-name");
  if (siteName) return cleanInline(siteName).replace(/\s+careers$/i, "");
  const title = tagText(html, "title");
  const parts = title.split(/\s+[|–-]\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1].replace(/\s+careers$/i, "") : "";
}

function inferCompanyFromUrl(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const domain = host.split(".").slice(-2, -1)[0] || host.split(".")[0] || "Unknown company";
  return domain.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function findLocationText(text: string) {
  const lines = text.split(/\n+/).map((line) => cleanInline(line)).filter(Boolean);
  const locationLine = lines.find((line) => /^location\s*:/i.test(line));
  if (locationLine) return locationLine.replace(/^location\s*:\s*/i, "");
  const remoteLine = lines.find((line) => /\b(remote|hybrid|on-site|onsite)\b/i.test(line));
  if (remoteLine && remoteLine.length < 120) return remoteLine;
  const cityState = lines.find((line) => /\b[A-Z][a-zA-Z .'-]+,\s*[A-Z]{2}\b/.test(line) && line.length < 140);
  return cityState ?? "";
}

function metaContent(html: string, attr: "name" | "property", value: string) {
  const pattern = new RegExp(`<meta[^>]+${attr}=["']${escapeRegex(value)}["'][^>]*>`, "i");
  const tag = html.match(pattern)?.[0] ?? "";
  return tag.match(/\scontent=["']([^"']*)["']/i)?.[1] ?? "";
}

function tagText(html: string, tag: string) {
  return cleanInline(html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "");
}

function nestedText(record: unknown, path: string[]) {
  return cleanInline(getNested(record, path));
}

function nestedObject(record: unknown, path: string[]) {
  const value = getNested(record, path);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getNested(record: unknown, path: string[]) {
  let current = record;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function canonicalizeUrl(url: URL) {
  const next = new URL(url.toString());
  next.hash = "";
  for (const key of [...next.searchParams.keys()]) {
    if (/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) next.searchParams.delete(key);
  }
  return next.toString();
}

function isPrivateOrLocalHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return true;
  const ipVersion = isIP(host);
  if (!ipVersion) return false;
  if (host === "::1") return true;
  if (ipVersion === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
}

function normalizeWorkType(value: unknown): WorkType | null {
  return value === "Remote" || value === "Hybrid" || value === "On-site" ? value : null;
}

function inferWorkType(text: string): WorkType {
  const normalized = text.toLowerCase();
  if (normalized.includes("remote")) return "Remote";
  if (normalized.includes("hybrid")) return "Hybrid";
  return "On-site";
}

function normalizeSponsorship(value: unknown): SponsorshipFriendliness | null {
  return value === "high" || value === "medium" || value === "low" || value === "unknown" ? value : null;
}

function inferSponsorship(text: string): SponsorshipFriendliness {
  const normalized = text.toLowerCase();
  if (/will not sponsor|no sponsorship|unable to sponsor/.test(normalized)) return "low";
  if (/sponsor|visa|opt|cpt|h-?1b/.test(normalized)) return "medium";
  return "unknown";
}

function normalizeCompetition(value: unknown): CompetitionLevel | null {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function normalizeDate(value: unknown, importedAt: string) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }
  return importedAt.slice(0, 10);
}

function normalizeSkills(skills: unknown, fallbackText: string) {
  if (Array.isArray(skills)) {
    const cleaned = skills.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (cleaned.length) return [...new Set(cleaned)].slice(0, 8);
  }
  const normalized = fallbackText.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ");
  const detected = skillTaxonomy.filter((skill) => normalized.includes(skill));
  return detected.length ? detected.slice(0, 8) : ["analytics"];
}

function inferSourceCategory(text: string): JobSourceCategory {
  const normalized = text.toLowerCase();
  if (/supply chain|logistics|procurement|inventory|demand planning/.test(normalized)) return "logistics";
  if (/manufacturing|plant|quality|production/.test(normalized)) return "manufacturing";
  if (/finance|accounting|investment|risk/.test(normalized)) return "finance";
  if (/software|engineer|developer|ai|machine learning|data pipeline/.test(normalized)) return "ai-software";
  if (/retail|store|merchandising/.test(normalized)) return "retail";
  if (/operations|business analyst|program/.test(normalized)) return "operations";
  return "tech";
}

function stableSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sha1(value: string) {
  return createHash("sha1").update(value).digest("hex");
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

const jobUrlImportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["company", "title", "location", "description", "applyUrl", "postedDate", "skills", "sponsorshipFriendly", "competitionLevel"],
  properties: {
    company: { type: "string" },
    title: { type: "string" },
    location: { type: "string" },
    description: { type: "string" },
    applyUrl: { type: "string" },
    postedDate: { type: "string" },
    skills: {
      type: "array",
      items: { type: "string" }
    },
    sponsorshipFriendly: {
      type: "string",
      enum: ["high", "medium", "low", "unknown"]
    },
    competitionLevel: {
      type: "string",
      enum: ["low", "medium", "high"]
    }
  }
};
