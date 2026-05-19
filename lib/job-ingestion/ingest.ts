import { readIngestedJobsCache, writeIngestedJobsCache } from "@/lib/job-ingestion/cache";
import { fetchApprovedSourcePostings } from "@/lib/job-ingestion/connectors";
import { readManualJobs } from "@/lib/job-ingestion/manual";
import { dedupeJobs, isRelevantStudentRole, normalizeProviderPosting } from "@/lib/job-ingestion/normalization";
import { upsertSupabaseJobs } from "@/lib/job-ingestion/supabase-jobs";
import type { IngestedJobRecord } from "@/lib/types";

const maxCatalogJobs = 500;

export async function ingestApprovedJobs() {
  const startedAt = Date.now();
  const importedAt = new Date().toISOString();
  const sourceResults = await fetchApprovedSourcePostings();
  const records: IngestedJobRecord[] = [];
  const sourceSummaries: {
    source: IngestedJobRecord["metadata"]["source"];
    company: string;
    fetchedCount: number;
    importedCount: number;
    skippedCount: number;
    error: string;
  }[] = [];
  const skipped: {
    source: IngestedJobRecord["metadata"]["source"];
    company: string;
    sourceJobId: string;
    title: string;
    reason: string;
  }[] = [];
  const warnings: string[] = [];

  for (const result of sourceResults) {
    let importedCount = 0;
    let skippedCount = 0;

    if (result.error) {
      warnings.push(`${result.config.company} ${result.config.source}: ${result.error}`);
      sourceSummaries.push({
        source: result.config.source,
        company: result.config.company,
        fetchedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        error: result.error
      });
      continue;
    }

    for (const posting of result.postings) {
      const normalized = normalizeProviderPosting({
        source: result.config.source,
        config: result.config,
        posting,
        importedAt
      });

      if (normalized && isRelevantStudentRole(normalized)) {
        records.push(normalized);
        importedCount += 1;
      } else {
        skippedCount += 1;
        skipped.push({
          source: result.config.source,
          company: result.config.company,
          sourceJobId: getPostingId(posting),
          title: getPostingTitle(posting),
          reason: normalized ? "Outside Stealth role focus." : "Failed required validation."
        });
      }
    }

    sourceSummaries.push({
      source: result.config.source,
      company: result.config.company,
      fetchedCount: result.postings.length,
      importedCount,
      skippedCount,
      error: ""
    });
  }

  const manualRecords = await readManualJobs(importedAt);
  const merged = dedupeJobs([...records, ...manualRecords])
    .sort((a, b) => getCatalogPriority(b) - getCatalogPriority(a))
    .slice(0, maxCatalogJobs);
  await writeIngestedJobsCache(merged);
  const supabaseResult = await upsertSupabaseJobs(merged, {
    importedAt,
    sourceResults: sourceSummaries,
    skippedCount: skipped.length,
    warnings,
    durationMs: Date.now() - startedAt
  });
  if (supabaseResult.warning) warnings.push(supabaseResult.warning);

  return {
    importedAt,
    jobs: merged,
    insertedCount: supabaseResult.insertedCount,
    updatedCount: supabaseResult.updatedCount,
    closedCount: supabaseResult.closedCount,
    skipped,
    sourceResults: sourceSummaries,
    warnings
  };
}

function getCatalogPriority(record: IngestedJobRecord) {
  const title = record.title.toLowerCase();
  const directStudentRole =
    title.includes("intern") ||
    title.includes("new grad") ||
    title.includes("university") ||
    title.includes("early career")
      ? 80
      : 0;
  const roleSignal = ["analyst", "data", "software", "operations", "supply chain", "product", "procurement"].filter((signal) =>
    title.includes(signal)
  ).length * 12;
  const sponsorSignal = record.sponsorshipFriendly === "high" ? 10 : record.sponsorshipFriendly === "medium" ? 5 : 0;
  const competitionSignal = record.competitionLevel === "low" ? 6 : record.competitionLevel === "medium" ? 3 : 0;

  return directStudentRole + roleSignal + sponsorSignal + competitionSignal;
}

export async function getCachedIngestedJobs() {
  return readIngestedJobsCache();
}

function getPostingId(posting: Record<string, unknown>) {
  const value = posting.id ?? posting.requisitionId ?? posting.jobId;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "unknown";
}

function getPostingTitle(posting: Record<string, unknown>) {
  const value = posting.title ?? posting.text;
  return typeof value === "string" ? value : "Untitled posting";
}
