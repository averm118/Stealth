import { NextResponse } from "next/server";
import { ingestApprovedJobs } from "@/lib/job-ingestion/ingest";

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

  const result = await ingestApprovedJobs();

  return NextResponse.json({
    importedAt: result.importedAt,
    count: result.jobs.length,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
    closedCount: result.closedCount,
    skippedCount: result.skipped.length,
    sourceResults: result.sourceResults,
    skippedPreview: result.skipped.slice(0, 25),
    warnings: result.warnings
  });
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
