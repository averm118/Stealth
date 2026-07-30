import { NextResponse } from "next/server";
import {
  cleanResumeFitOperations,
  cleanResumeFitRemovalCandidates,
  cleanResumeFitSkillPruneCandidates,
  cleanResumeFitRewrites,
  cleanResumeVerifiedFitPlan
} from "@/lib/resume-fit-input";
import { fitResumeWithMicrosoftWord } from "@/lib/resume-word-fit";
import { isMicrosoftWordRendererConfigured } from "@/lib/resume-word-renderer";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  CandidateProfile,
  ResumePdfFidelityReport
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const {
      profile,
      rewrites,
      editOperations,
      fitRemovalCandidates,
      fitSkillPruneCandidates,
      verifiedFitPlan,
      referencePdfStoragePath
    } = (await request.json()) as {
      profile?: unknown;
      rewrites?: unknown;
      editOperations?: unknown;
      fitRemovalCandidates?: unknown;
      fitSkillPruneCandidates?: unknown;
      verifiedFitPlan?: unknown;
      referencePdfStoragePath?: unknown;
    };

    if (!isCandidateProfile(profile)) {
      return NextResponse.json(
        { error: "Candidate profile is required." },
        { status: 400 }
      );
    }
    if (
      !profile.resumeDocument?.exactLayoutSupported ||
      !profile.resumeDocument.storagePath
    ) {
      return NextResponse.json(
        { error: "Verified PDF export requires an uploaded DOCX resume." },
        { status: 400 }
      );
    }
    if (!isMicrosoftWordRendererConfigured()) {
      return NextResponse.json(
        {
          error:
            "Microsoft Word PDF rendering is not configured. Add the MS_GRAPH_* server environment variables."
        },
        { status: 503 }
      );
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 }
      );
    }
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    if (!profile.resumeDocument.storagePath.startsWith(`${user.id}/`)) {
      return NextResponse.json(
        { error: "Resume document does not belong to this user." },
        { status: 403 }
      );
    }

    const { data, error } = await supabase.storage
      .from("resumes")
      .download(profile.resumeDocument.storagePath);
    if (error || !data) {
      return NextResponse.json(
        { error: "Could not download the original resume document." },
        { status: 404 }
      );
    }

    const referencePdf = await loadOptionalReferencePdf(
      supabase,
      user.id,
      referencePdfStoragePath
    );
    const fitted = await fitResumeWithMicrosoftWord({
      originalDocx: Buffer.from(await data.arrayBuffer()),
      editOperations: cleanResumeFitOperations(editOperations),
      rewrites: cleanResumeFitRewrites(rewrites),
      fitRemovalCandidates:
        cleanResumeFitRemovalCandidates(fitRemovalCandidates),
      fitSkillPruneCandidates:
        cleanResumeFitSkillPruneCandidates(fitSkillPruneCandidates),
      verifiedFitPlan: cleanResumeVerifiedFitPlan(verifiedFitPlan),
      originalPdf: referencePdf ?? undefined
    });

    return new NextResponse(new Uint8Array(fitted.pdf), {
      headers: createFitHeaders(
        fitted,
        `attachment; filename="${getDownloadName(
          profile.resumeDocument.fileName
        )}"`,
        referencePdf ? "editor_reference" : "microsoft_word"
      )
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not create a verified resume PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function loadOptionalReferencePdf(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  storagePath: unknown
) {
  if (
    !supabase ||
    typeof storagePath !== "string" ||
    !storagePath.startsWith(`${userId}/`)
  ) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from("resumes")
    .download(storagePath);
  if (error || !data) {
    throw new Error("The optional original PDF reference could not be loaded.");
  }
  const pdf = Buffer.from(await data.arrayBuffer());
  if (
    pdf.byteLength < 5 ||
    pdf.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    throw new Error("The optional original PDF reference is invalid.");
  }
  return pdf;
}

function createFitHeaders(
  fitted: Awaited<ReturnType<typeof fitResumeWithMicrosoftWord>>,
  disposition: string,
  baseline: string
) {
  const stats = fitted.build.stats;
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": disposition,
    "Cache-Control": "private, no-store",
    "X-Stealth-PDF-Verified": "1",
    "X-Stealth-PDF-Pages": String(fitted.report.pageCount),
    "X-Stealth-PDF-Stable-Anchors": String(
      fitted.report.stableAnchorsChecked
    ),
    "X-Stealth-PDF-Max-Delta": String(fitted.report.maxAnchorDeltaPt),
    "X-Stealth-PDF-Retry": fitted.attempts > 1 ? "1" : "0",
    "X-Stealth-PDF-Fallback": fitted.fallbackToOriginal ? "1" : "0",
    "X-Stealth-PDF-Baseline": baseline,
    "X-Stealth-PDF-Report": encodeReport(fitted.report),
    "X-Stealth-DOCX-Applied": String(stats.appliedEdits),
    "X-Stealth-DOCX-Skipped": String(stats.skippedEdits),
    "X-Stealth-Fit-Selected": String(stats.selectedCandidateCount ?? 0),
    "X-Stealth-Fit-Shortened": String(stats.shortenedForFit ?? 0),
    "X-Stealth-Fit-Removed": String(stats.removedForFit ?? 0),
    "X-Stealth-Fit-Rejected": String(stats.rejectedForFit ?? 0),
    "X-Stealth-Fit-Replaced-Low-Relevance": String(
      stats.replacedLowRelevanceBullets ?? 0
    ),
    "X-Stealth-Fit-Skills-Pruned": String(stats.skillsPruned ?? 0),
    "X-Stealth-Fit-Font-Scale": String(stats.fontScaleApplied ?? 1),
    "X-Stealth-Fit-Target-Pages": String(stats.targetPageCount ?? 0),
    "X-Stealth-Fit-Final-Pages": String(stats.finalPageCount ?? 0),
    "X-Stealth-Fit-Removed-Ids": JSON.stringify(
      fitted.build.removedParagraphIds
    ),
    "X-Stealth-Fit-Attempts": String(fitted.attempts),
    "X-Stealth-DOCX-Skipped-By-Reason": JSON.stringify(
      stats.skippedByReason ?? {}
    ),
    "X-Stealth-Fit-Plan": Buffer.from(
      JSON.stringify(fitted.fitPlan),
      "utf8"
    ).toString("base64url")
  };
}

function isCandidateProfile(value: unknown): value is CandidateProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<CandidateProfile>;
  return (
    typeof profile.resumeText === "string" &&
    typeof profile.lookingFor === "string"
  );
}

function getDownloadName(fileName: string) {
  const base = fileName
    .replace(/\.docx$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `stealth-verified-${base || "resume"}.pdf`;
}

function encodeReport(report: ResumePdfFidelityReport) {
  return Buffer.from(JSON.stringify(report), "utf8").toString("base64url");
}
