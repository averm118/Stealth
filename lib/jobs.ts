import { jobs as mockJobs } from "@/data/jobs";
import { getCachedIngestedJobs } from "@/lib/job-ingestion/ingest";
import { toUiJob } from "@/lib/job-ingestion/normalization";
import { readSupabaseJobs, readSupabaseJobsMetadata, type JobsQuery } from "@/lib/job-ingestion/supabase-jobs";
import { normalizeJobLocation } from "@/lib/job-location";
import type { Job } from "@/lib/types";

export async function getJobs(query: JobsQuery = {}): Promise<Job[]> {
  const cachedJobs = applyLocalQuery((await getCachedIngestedJobs()).map(toUiJob).map(sanitizeUiJob), query);

  try {
    const supabaseJobs = await readSupabaseJobs(query);
    if (supabaseJobs.length) {
      const merged = cachedJobs.length ? dedupeUiJobs([...cachedJobs, ...supabaseJobs.map(sanitizeUiJob)]) : dedupeUiJobs(supabaseJobs.map(sanitizeUiJob));
      return merged.sort((a, b) => b.postedDate.localeCompare(a.postedDate));
    }
  } catch (error) {
    console.warn("Could not read Supabase jobs; using local fallback.", error);
  }

  const merged = cachedJobs.length ? dedupeUiJobs(cachedJobs) : dedupeUiJobs(applyLocalQuery(mockJobs.map(sanitizeUiJob), query));
  return merged.sort((a, b) => b.postedDate.localeCompare(a.postedDate));
}

export async function getJobById(id: string) {
  const jobs = await getJobs();
  return jobs.find((job) => job.id === id);
}

export async function getJobsMetadata() {
  try {
    const metadata = await readSupabaseJobsMetadata();
    if (metadata && metadata.count > 0) return metadata;
  } catch (error) {
    console.warn("Could not read Supabase job metadata.", error);
  }

  const ingested = await getCachedIngestedJobs();
  const importedAt = ingested
    .map((record) => record.metadata.importedAt)
    .sort((a, b) => b.localeCompare(a))[0] ?? null;

  return {
    count: ingested.length || mockJobs.length,
    lastImportedAt: importedAt
  };
}

function dedupeUiJobs(jobs: Job[]) {
  const seen = new Set<string>();
  const deduped: Job[] = [];

  for (const job of jobs) {
    const key = job.id || `${job.company}-${job.title}-${job.location}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(job);
  }

  return deduped;
}

function sanitizeUiJob(job: Job): Job {
  return {
    ...job,
    location: normalizeJobLocation(job.location, "Not specified")
  };
}

function applyLocalQuery(jobs: Job[], query: JobsQuery) {
  const normalizedQuery = query.q?.toLowerCase().trim();
  const normalizedRole = query.role ? normalizeRole(query.role) : "";

  return jobs
    .filter((job) => !query.workType || job.workType === query.workType)
    .filter((job) => !query.sponsorship || job.sponsorshipFriendly === query.sponsorship)
    .filter((job) => {
      if (!normalizedQuery) return true;
      const haystack = `${job.company} ${job.title} ${job.location} ${job.skills.join(" ")} ${job.description}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .filter((job) => {
      if (!normalizedRole) return true;
      const haystack = normalizeRole(`${job.title} ${job.description} ${job.skills.join(" ")}`);
      return haystack.includes(normalizedRole);
    })
    .sort((a, b) => b.postedDate.localeCompare(a.postedDate))
    .slice(0, query.limit);
}

function normalizeRole(value: string) {
  return value.toLowerCase().replace(/\binternship\b|\bintern\b|\bfull time\b|\bpart time\b/g, "").replace(/[^a-z0-9+#]+/g, " ").trim();
}
