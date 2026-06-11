import { NextResponse } from "next/server";
import { importJobFromUrl, type JobUrlSourceHint, validatePublicJobUrl } from "@/lib/job-ingestion/url-import";
import {
  countRecentJobUrlImports,
  upsertUserSubmittedJob,
  writeJobUrlImportAudit
} from "@/lib/job-ingestion/supabase-jobs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { IngestedJobRecord, Job } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dailyImportLimit = 20;
const sourceHints: JobUrlSourceHint[] = ["auto", "company", "linkedin", "handshake", "ziprecruiter", "other"];

type ImportUrlBody = {
  url?: unknown;
  pastedText?: unknown;
  sourceHint?: unknown;
};

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ status: "error", error: "Supabase is not configured." }, { status: 503 });
  }

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ status: "error", error: "Sign in to import a job URL." }, { status: 401 });
  }

  let body: ImportUrlBody;
  try {
    body = (await request.json()) as ImportUrlBody;
  } catch {
    return NextResponse.json({ status: "error", error: "Send a valid JSON body." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const pastedText = typeof body.pastedText === "string" ? body.pastedText : "";
  const sourceHint = normalizeSourceHint(body.sourceHint);

  if (!url) {
    return NextResponse.json({ status: "error", error: "Job URL is required." }, { status: 400 });
  }

  try {
    validatePublicJobUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "This URL cannot be imported.";
    await safeWriteJobUrlImportAudit({
      userId: user.id,
      url,
      status: "error",
      warnings: [],
      error: message
    });
    return NextResponse.json({ status: "error", error: message }, { status: 400 });
  }

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let recentCount = 0;
  try {
    recentCount = await countRecentJobUrlImports(user.id, sinceIso);
  } catch {
    // Audit/rate-limit storage should never block the core import flow.
    recentCount = 0;
  }
  if (recentCount >= dailyImportLimit) {
    const message = "You have reached today’s job import limit. Try again tomorrow.";
    await safeWriteJobUrlImportAudit({
      userId: user.id,
      url,
      status: "error",
      warnings: [],
      error: message
    });
    return NextResponse.json({ status: "error", error: message }, { status: 429 });
  }

  try {
    const result = await importJobFromUrl({ url, pastedText, sourceHint });

    if (result.status === "needs_paste") {
      await safeWriteJobUrlImportAudit({
        userId: user.id,
        url,
        status: "needs_paste",
        warnings: result.warnings,
        error: result.reason
      });

      return NextResponse.json({
        status: "needs_paste",
        reason: result.reason,
        warnings: result.warnings
      });
    }

    const upserted = await upsertUserSubmittedJob(result.record);
    const job = toPublicJob(upserted.job);

    await safeWriteJobUrlImportAudit({
      userId: user.id,
      url,
      jobId: job.id,
      status: "imported",
      extractionSource: result.extractionSource,
      warnings: result.warnings
    });

    return NextResponse.json({
      status: "imported",
      job,
      jobUrl: `/jobs/${job.id}`,
      extractionSource: result.extractionSource,
      warnings: result.warnings,
      inserted: upserted.inserted,
      updated: upserted.updated
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Job import failed.";
    await safeWriteJobUrlImportAudit({
      userId: user.id,
      url,
      status: "error",
      warnings: [],
      error: message
    });

    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}

async function safeWriteJobUrlImportAudit(entry: Parameters<typeof writeJobUrlImportAudit>[0]) {
  try {
    await writeJobUrlImportAudit(entry);
  } catch {
    // The import itself is more important than audit/debug storage.
  }
}

function normalizeSourceHint(value: unknown): JobUrlSourceHint {
  return typeof value === "string" && sourceHints.includes(value as JobUrlSourceHint) ? (value as JobUrlSourceHint) : "auto";
}

function toPublicJob(record: IngestedJobRecord): Job {
  return {
    id: record.id,
    company: record.company,
    title: record.title,
    location: record.location,
    workType: record.workType,
    postedDate: record.postedDate,
    sponsorshipFriendly: record.sponsorshipFriendly,
    competitionLevel: record.competitionLevel,
    skills: record.skills,
    description: record.description,
    applyUrl: record.applyUrl
  };
}
