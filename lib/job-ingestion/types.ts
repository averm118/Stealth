import type { IngestedJobRecord, Job, JobSource } from "@/lib/types";
import type { JobSourceConfig } from "@/lib/job-ingestion/source-registry";

export type RawPosting = Record<string, unknown>;

export type NormalizerInput = {
  source: Exclude<JobSource, "mock">;
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
