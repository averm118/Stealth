import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { normalizeJobLocation } from "@/lib/job-location";
import type { IngestedJobRecord, Job, JobSource, JobSourceCategory } from "@/lib/types";

export type JobsQuery = {
  role?: string;
  workType?: string;
  sponsorship?: string;
  q?: string;
  limit?: number;
  includeInactive?: boolean;
};

type SourceRunSummary = {
  source: JobSource;
  company: string;
  fetchedCount: number;
  importedCount: number;
  skippedCount: number;
  error: string;
};

type UpsertJobsOptions = {
  importedAt: string;
  sourceResults: SourceRunSummary[];
  skippedCount: number;
  warnings: string[];
  durationMs: number;
};

export type JobUrlImportAudit = {
  userId: string;
  url: string;
  jobId?: string | null;
  status: "imported" | "needs_paste" | "error";
  extractionSource?: string | null;
  warnings: string[];
  error?: string | null;
};

type JobRow = {
  id: string;
  company: string;
  title: string;
  location: string;
  work_type: string;
  posted_date: string;
  sponsorship_friendly: string;
  competition_level: string;
  skills: string[];
  description: string;
  apply_url: string;
  source: string;
  source_job_id: string | null;
  source_url: string | null;
  source_category?: string | null;
  raw_location: string | null;
  quality_warnings: string[];
  imported_at: string;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  closed_at?: string | null;
  is_active?: boolean | null;
  description_hash?: string | null;
};

export async function readSupabaseJobs(query: JobsQuery = {}) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  let request = supabase.from("jobs").select("*").order("posted_date", { ascending: false });

  if (!query.includeInactive) request = request.eq("is_active", true);
  if (query.workType) request = request.eq("work_type", query.workType);
  if (query.sponsorship) request = request.eq("sponsorship_friendly", query.sponsorship);
  if (query.q) {
    const term = `%${query.q.replace(/[%_]/g, "")}%`;
    request = request.or(`company.ilike.${term},title.ilike.${term},location.ilike.${term},description.ilike.${term}`);
  }
  if (query.limit) request = request.limit(query.limit);

  const { data, error } = await request;
  if (error) throw error;

  return (data ?? []).map(rowToJob).filter(matchesRoleQuery(query.role));
}

export async function readSupabaseJobsMetadata() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const { data, error, count } = await supabase
    .from("jobs")
    .select("last_seen_at,imported_at", { count: "exact" })
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  return {
    count: count ?? 0,
    lastImportedAt: data?.[0]?.last_seen_at ?? data?.[0]?.imported_at ?? null
  };
}

export async function upsertSupabaseJobs(records: IngestedJobRecord[], options: UpsertJobsOptions) {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    return {
      insertedCount: 0,
      updatedCount: 0,
      closedCount: 0,
      warning: "Missing SUPABASE_SERVICE_ROLE_KEY. Wrote local ingestion cache only."
    };
  }

  if (!records.length) {
    await writeIngestionRun({
      insertedCount: 0,
      updatedCount: 0,
      closedCount: 0,
      importedCount: 0,
      options
    });
    return { insertedCount: 0, updatedCount: 0, closedCount: 0, warning: "" };
  }

  const ids = records.map((record) => record.id);
  const { data: existing, error: existingError } = await supabase.from("jobs").select("id").in("id", ids);
  if (existingError) throw existingError;

  const existingIds = new Set((existing ?? []).map((row) => row.id as string));
  const rows = records.map((record) => recordToRow(record, options.importedAt));
  const { error } = await supabase.from("jobs").upsert(rows, { onConflict: "id" });
  if (error) throw error;

  const closedCount = await closeMissingJobsForSuccessfulSources(supabase, records, options);
  const insertedCount = records.filter((record) => !existingIds.has(record.id)).length;
  const updatedCount = records.filter((record) => existingIds.has(record.id)).length;
  await writeIngestionRun({
    insertedCount,
    updatedCount,
    closedCount,
    importedCount: records.length,
    options
  });

  return {
    insertedCount,
    updatedCount,
    closedCount,
    warning: ""
  };
}

export async function upsertUserSubmittedJob(record: IngestedJobRecord) {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY. User-submitted jobs require Supabase writes.");
  }

  const importedAt = record.metadata.importedAt;
  const candidateIds = [record.id];

  const existingId = await findExistingSubmittedJobId(record);
  if (existingId && !candidateIds.includes(existingId)) {
    record = { ...record, id: existingId };
  }

  const { data: existingById, error: existingError } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", record.id)
    .maybeSingle();

  if (existingError) throw existingError;

  const { error } = await supabase.from("jobs").upsert(recordToRow(record, importedAt), { onConflict: "id" });
  if (error) throw error;

  return {
    job: record,
    inserted: !existingById,
    updated: Boolean(existingById)
  };
}

async function findExistingSubmittedJobId(record: IngestedJobRecord) {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return "";

  const urls = [record.metadata.sourceUrl, record.applyUrl].filter(Boolean);
  for (const value of urls) {
    const { data: bySourceUrl, error: sourceUrlError } = await supabase
      .from("jobs")
      .select("id")
      .eq("source_url", value)
      .limit(1);

    if (sourceUrlError) throw sourceUrlError;
    if (bySourceUrl?.[0]?.id) return bySourceUrl[0].id as string;

    const { data: byApplyUrl, error: applyUrlError } = await supabase
      .from("jobs")
      .select("id")
      .eq("apply_url", value)
      .limit(1);

    if (applyUrlError) throw applyUrlError;
    if (byApplyUrl?.[0]?.id) return byApplyUrl[0].id as string;
  }

  return "";
}

export async function countRecentJobUrlImports(userId: string, sinceIso: string) {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return 0;

  const { count, error } = await supabase
    .from("job_url_imports")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", sinceIso);

  if (error) {
    if (isMissingOptionalTableError(error)) return 0;
    throw error;
  }

  return count ?? 0;
}

export async function writeJobUrlImportAudit(entry: JobUrlImportAudit) {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return;

  const { error } = await supabase.from("job_url_imports").insert({
    user_id: entry.userId,
    url: entry.url,
    job_id: entry.jobId ?? null,
    status: entry.status,
    extraction_source: entry.extractionSource ?? null,
    warnings: entry.warnings,
    error: entry.error ?? null
  });

  if (error && !isMissingOptionalTableError(error)) throw error;
}

function isMissingOptionalTableError(error: { code?: string; message?: string }) {
  const message = error.message ?? "";
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache|job_url_imports/i.test(message);
}

function recordToRow(record: IngestedJobRecord, importedAt: string) {
  const location = normalizeJobLocation(record.location, "Not specified");

  return {
    id: record.id,
    company: record.company,
    title: record.title,
    location,
    work_type: record.workType,
    posted_date: record.postedDate,
    sponsorship_friendly: record.sponsorshipFriendly,
    competition_level: record.competitionLevel,
    skills: record.skills,
    description: record.description,
    apply_url: record.applyUrl,
    source: record.metadata.source,
    source_job_id: record.metadata.sourceJobId,
    source_url: record.metadata.sourceUrl,
    source_category: record.metadata.sourceCategory ?? null,
    raw_location: record.metadata.rawLocation,
    quality_warnings: record.metadata.qualityWarnings,
    imported_at: record.metadata.importedAt,
    last_seen_at: importedAt,
    closed_at: null,
    is_active: true,
    description_hash: hashText(record.description)
  };
}

async function closeMissingJobsForSuccessfulSources(
  supabase: NonNullable<ReturnType<typeof createServiceRoleSupabaseClient>>,
  records: IngestedJobRecord[],
  options: UpsertJobsOptions
) {
  const successfulSources = options.sourceResults.filter((result) => !result.error && result.fetchedCount > 0);
  let closedCount = 0;

  for (const source of successfulSources) {
    const activeIds = new Set(
      records
        .filter((record) => record.metadata.source === source.source && record.company === source.company)
        .map((record) => record.id)
    );

    const { data, error } = await supabase
      .from("jobs")
      .select("id")
      .eq("source", source.source)
      .eq("company", source.company)
      .eq("is_active", true);

    if (error) throw error;

    const staleIds = (data ?? [])
      .map((row) => row.id as string)
      .filter((id) => !activeIds.has(id));

    for (const batch of chunk(staleIds, 100)) {
      const { error: updateError } = await supabase
        .from("jobs")
        .update({ is_active: false, closed_at: options.importedAt })
        .in("id", batch);

      if (updateError) throw updateError;
      closedCount += batch.length;
    }
  }

  return closedCount;
}

async function writeIngestionRun({
  insertedCount,
  updatedCount,
  closedCount,
  importedCount,
  options
}: {
  insertedCount: number;
  updatedCount: number;
  closedCount: number;
  importedCount: number;
  options: UpsertJobsOptions;
}) {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return;

  const { error } = await supabase.from("job_ingestion_runs").insert({
    imported_at: options.importedAt,
    imported_count: importedCount,
    inserted_count: insertedCount,
    updated_count: updatedCount,
    closed_count: closedCount,
    skipped_count: options.skippedCount,
    source_results: options.sourceResults,
    warnings: options.warnings,
    duration_ms: options.durationMs
  });

  if (error) throw error;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    location: normalizeJobLocation(row.location, "Not specified"),
    workType: row.work_type === "Remote" || row.work_type === "Hybrid" ? row.work_type : "On-site",
    postedDate: row.posted_date,
    sponsorshipFriendly:
      row.sponsorship_friendly === "high" ||
      row.sponsorship_friendly === "medium" ||
      row.sponsorship_friendly === "low" ||
      row.sponsorship_friendly === "unknown"
        ? row.sponsorship_friendly
        : "unknown",
    competitionLevel:
      row.competition_level === "low" || row.competition_level === "high" ? row.competition_level : "medium",
    skills: Array.isArray(row.skills) ? row.skills : [],
    description: row.description,
    applyUrl: row.apply_url
  };
}

function matchesRoleQuery(role?: string) {
  if (!role) return () => true;
  const normalizedRole = normalizeRole(role);

  return (job: Job) => {
    const haystack = normalizeRole(`${job.title} ${job.description} ${job.skills.join(" ")}`);
    return haystack.includes(normalizedRole);
  };
}

function normalizeRole(value: string) {
  return value.toLowerCase().replace(/\binternship\b|\bintern\b|\bfull time\b|\bpart time\b/g, "").replace(/[^a-z0-9+#]+/g, " ").trim();
}

function hashText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
