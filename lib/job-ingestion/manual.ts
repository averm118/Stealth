import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeManualPosting } from "@/lib/job-ingestion/normalization";
import type { ManualJobInput } from "@/lib/job-ingestion/types";

const manualJobsDir = path.join(process.cwd(), "data", "manual-jobs");

export async function readManualJobs(importedAt: string) {
  try {
    const files = (await readdir(manualJobsDir)).filter((file) => file.endsWith(".json"));
    const records = await Promise.all(files.map((file) => readManualJobsFile(path.join(manualJobsDir, file), importedAt)));
    return records.flat();
  } catch {
    return [];
  }
}

async function readManualJobsFile(filePath: string, importedAt: string) {
  const file = await readFile(filePath, "utf8");
  const parsed = JSON.parse(file) as unknown;
  const inputs = Array.isArray(parsed) ? parsed : [parsed];

  return inputs
    .map((input) => normalizeManualPosting(input as ManualJobInput, importedAt))
    .filter((item) => item !== null);
}
