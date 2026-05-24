import { NextResponse } from "next/server";
import { ingestApprovedJobs } from "@/lib/job-ingestion/ingest";
import type { DiscoveryMode } from "@/lib/job-ingestion/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleIngestionRequest(request);
}

export async function POST(request: Request) {
  return handleIngestionRequest(request);
}

async function handleIngestionRequest(request: Request) {
  if (!isAllowedIngestionRequest(request)) {
    return NextResponse.json({ error: "Job ingestion is not enabled for this request." }, { status: 403 });
  }

  const options = await getIngestionOptions(request);
  const result = await ingestApprovedJobs(options);

  return NextResponse.json({
    importedAt: result.importedAt,
    count: result.jobs.length,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
    closedCount: result.closedCount,
    skippedCount: result.skipped.length,
    sourceResults: result.sourceResults,
    discoveryResults: result.discoveryResults,
    skippedPreview: result.skipped.slice(0, 25),
    warnings: result.warnings
  });
}

async function getIngestionOptions(request: Request) {
  const url = new URL(request.url);
  const body = request.method === "POST" ? await readJsonBody(request) : {};
  const mode = normalizeMode(stringValue(body.mode) || url.searchParams.get("mode"));
  const batchSize = normalizeBatchSize(numberValue(body.batchSize) ?? url.searchParams.get("batchSize"));
  const forceCompany = stringValue(body.forceCompany) || url.searchParams.get("forceCompany") || undefined;

  return {
    mode,
    batchSize,
    forceCompany
  };
}

async function readJsonBody(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return {};
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeMode(value: string | null): DiscoveryMode {
  return value === "discover" || value === "full" || value === "ingest" ? value : "ingest";
}

function normalizeBatchSize(value: string | number | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(1, Math.min(50, Math.floor(numeric)));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function isAllowedIngestionRequest(request: Request) {
  if (process.env.NODE_ENV !== "production") return true;

  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (cronSecret && authorization === `Bearer ${cronSecret}`) return true;

  const configuredToken = process.env.INGEST_ADMIN_TOKEN;
  const header = request.headers.get("x-ingest-token");
  return Boolean(configuredToken && header === configuredToken);
}
