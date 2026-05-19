import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IngestedJobRecord } from "@/lib/types";

const cachePath = path.join(process.cwd(), "data", "ingested-jobs.json");

export async function readIngestedJobsCache(): Promise<IngestedJobRecord[]> {
  try {
    const file = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(file) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isIngestedJobRecord);
  } catch {
    return [];
  }
}

export async function writeIngestedJobsCache(records: IngestedJobRecord[]) {
  await writeFile(cachePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function isIngestedJobRecord(value: unknown): value is IngestedJobRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<IngestedJobRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.company === "string" &&
    typeof record.title === "string" &&
    typeof record.applyUrl === "string" &&
    Boolean(record.metadata)
  );
}
