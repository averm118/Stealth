import type { IngestedJobRecord, Job, JobSource, JobSourceCategory } from "@/lib/types";
import type { JobSourceConfig } from "@/lib/job-ingestion/source-registry";

export type RawPosting = Record<string, unknown>;

export type NormalizerInput = {
  source: Exclude<JobSource, "mock" | "company_careers">;
  config?: JobSourceConfig;
  posting: RawPosting;
  importedAt: string;
};

export type IngestionResult = {
  importedAt: string;
  jobs: IngestedJobRecord[];
  skipped: {
    source: JobSource;
    company: string;
    sourceJobId: string;
    title: string;
    reason: string;
  }[];
  warnings: string[];
};

export type ManualJobInput = Partial<Job> & {
  sourceJobId?: string;
  sourceUrl?: string;
};

export type ScrapedJobInput = Partial<Job> & {
  company: string;
  title: string;
  location: string;
  description: string;
  applyUrl: string;
  sourceJobId?: string;
  sourceUrl?: string;
  rawLocation?: string;
  sourceCategory?: JobSourceCategory;
  scrapedAt?: string;
  extractionMethod?: "beautifulsoup" | "playwright";
};
