import { NextResponse } from "next/server";
import { dedupeJobs, isRelevantStudentRole, normalizeScrapedJobInput } from "@/lib/job-ingestion/normalization";
import { upsertSupabaseJobs } from "@/lib/job-ingestion/supabase-jobs";
import type { ScrapedJobInput } from "@/lib/job-ingestion/types";
import type { IngestedJobRecord, JobSourceCategory } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxImportRecords = 750;

type ScrapedImportBody = {
  importedAt?: string;
  jobs?: unknown;
};

export async function POST(request: Request) {
  if (!isAllowedImportRequest(request)) {
    return NextResponse.json({ error: "Scraped job import is not enabled for this request." }, { status: 403 });
  }

  const startedAt = Date.now();
  const body = await readJsonBody(request);
  const importedAt = normalizeImportedAt(body.importedAt);
  const rawJobs = Array.isArray(body.jobs) ? body.jobs.slice(0, maxImportRecords) : [];
  const records: IngestedJobRecord[] = [];
  const skipped: { company: string; title: string; reason: string }[] = [];

  for (const rawJob of rawJobs) {
    const scrapedJob = normalizeScrapedInput(rawJob);

    if (!scrapedJob) {
      skipped.push({ company: "unknown", title: "Untitled posting", reason: "Malformed scraped job payload." });
      continue;
    }

    const normalized = normalizeScrapedJobInput(scrapedJob, importedAt);

    if (!normalized) {
      skipped.push({ company: scrapedJob.company, title: scrapedJob.title, reason: "Failed required validation." });
      continue;
    }

    if (!isRelevantStudentRole(normalized)) {
      skipped.push({ company: normalized.company, title: normalized.title, reason: "Outside student-first role focus." });
      continue;
    }

    records.push(normalized);
  }

  const jobs = dedupeJobs(records);
  const sourceResults = summarizeScrapedSources(jobs, skipped);
  const warnings = rawJobs.length > maxImportRecords ? [`Import truncated to ${maxImportRecords} records.`] : [];
  const result = await upsertSupabaseJobs(jobs, {
    importedAt,
    sourceResults,
    skippedCount: skipped.length,
    warnings,
    durationMs: Date.now() - startedAt
  });

  if (result.warning) warnings.push(result.warning);

  return NextResponse.json({
    importedAt,
    count: jobs.length,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
    closedCount: result.closedCount,
    skippedCount: skipped.length,
    sourceResults,
    skippedPreview: skipped.slice(0, 25),
    warnings
  });
}

async function readJsonBody(request: Request): Promise<ScrapedImportBody> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ScrapedImportBody) : {};
  } catch {
    return {};
  }
}

function normalizeScrapedInput(value: unknown): ScrapedJobInput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const company = stringValue(record.company);
  const title = stringValue(record.title);
  const location = stringValue(record.location);
  const description = stringValue(record.description);
  const applyUrl = stringValue(record.applyUrl);

  if (!company || !title || !location || !description || !applyUrl) return null;

  return {
    company,
    title,
    location,
    description,
    applyUrl,
    sourceJobId: stringValue(record.sourceJobId) || undefined,
    sourceUrl: stringValue(record.sourceUrl) || applyUrl,
    rawLocation: stringValue(record.rawLocation) || location,
    sourceCategory: normalizeCategory(record.sourceCategory),
    postedDate: stringValue(record.postedDate) || undefined,
    workType: normalizeWorkType(record.workType),
    sponsorshipFriendly: normalizeSponsorship(record.sponsorshipFriendly),
    competitionLevel: normalizeCompetition(record.competitionLevel),
    skills: Array.isArray(record.skills) ? record.skills.filter((item): item is string => typeof item === "string") : undefined,
    scrapedAt: stringValue(record.scrapedAt) || undefined,
    extractionMethod: record.extractionMethod === "playwright" ? "playwright" : "beautifulsoup"
  };
}

function summarizeScrapedSources(records: IngestedJobRecord[], skipped: { company: string; title: string; reason: string }[]) {
  const companies = new Map<string, { importedCount: number; skippedCount: number }>();

  for (const record of records) {
    const current = companies.get(record.company) ?? { importedCount: 0, skippedCount: 0 };
    current.importedCount += 1;
    companies.set(record.company, current);
  }

  for (const item of skipped) {
    const current = companies.get(item.company) ?? { importedCount: 0, skippedCount: 0 };
    current.skippedCount += 1;
    companies.set(item.company, current);
  }

  return [...companies.entries()].map(([company, counts]) => ({
    source: "company_careers" as const,
    company,
    fetchedCount: counts.importedCount,
    importedCount: counts.importedCount,
    skippedCount: counts.skippedCount,
    error: ""
  }));
}

function normalizeImportedAt(value: unknown) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWorkType(value: unknown) {
  return value === "Remote" || value === "Hybrid" || value === "On-site" ? value : undefined;
}

function normalizeSponsorship(value: unknown) {
  return value === "high" || value === "medium" || value === "low" || value === "unknown" ? value : undefined;
}

function normalizeCompetition(value: unknown) {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function normalizeCategory(value: unknown): JobSourceCategory | undefined {
  return value === "tech" ||
    value === "ai-software" ||
    value === "logistics" ||
    value === "retail" ||
    value === "manufacturing" ||
    value === "finance" ||
    value === "operations"
    ? value
    : undefined;
}

function isAllowedImportRequest(request: Request) {
  if (process.env.NODE_ENV !== "production") return true;

  const configuredToken = process.env.INGEST_ADMIN_TOKEN;
  const header = request.headers.get("x-ingest-token");
  return Boolean(configuredToken && header === configuredToken);
}
