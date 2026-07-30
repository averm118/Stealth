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
import type { CandidateProfile } from "@/lib/types";

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
      verifiedFitPlan
    } = (await request.json()) as {
      profile?: unknown;
      rewrites?: unknown;
      editOperations?: unknown;
      fitRemovalCandidates?: unknown;
      fitSkillPruneCandidates?: unknown;
      verifiedFitPlan?: unknown;
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
        {
          error:
            "DOCX layout preservation is only available for uploaded DOCX resumes."
        },
        { status: 400 }
      );
    }
    if (!isMicrosoftWordRendererConfigured()) {
      return NextResponse.json(
        {
          error:
            "Verified DOCX export requires Microsoft Word rendering. Add the MS_GRAPH_* server environment variables."
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

    const fitted = await fitResumeWithMicrosoftWord({
      originalDocx: Buffer.from(await data.arrayBuffer()),
      editOperations: cleanResumeFitOperations(editOperations),
      rewrites: cleanResumeFitRewrites(rewrites),
      fitRemovalCandidates:
        cleanResumeFitRemovalCandidates(fitRemovalCandidates),
      fitSkillPruneCandidates:
        cleanResumeFitSkillPruneCandidates(fitSkillPruneCandidates),
      verifiedFitPlan: cleanResumeVerifiedFitPlan(verifiedFitPlan)
    });
    const stats = fitted.build.stats;

    return new NextResponse(new Uint8Array(fitted.docx), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${getDownloadName(
          profile.resumeDocument.fileName
        )}"`,
        "Cache-Control": "private, no-store",
        "X-Stealth-DOCX-Applied": String(stats.appliedEdits),
        "X-Stealth-DOCX-Inserted": String(stats.insertedBullets),
        "X-Stealth-DOCX-Removed": String(stats.removedLines),
        "X-Stealth-DOCX-Skipped": String(stats.skippedEdits),
        "X-Stealth-DOCX-Repaired": String(stats.repairedEdits ?? 0),
        "X-Stealth-DOCX-Shortened": String(stats.shortenedEdits ?? 0),
        "X-Stealth-DOCX-Converted": String(stats.convertedEdits ?? 0),
        "X-Stealth-DOCX-Word-Verified": fitted.report.status,
        "X-Stealth-DOCX-Fallback": fitted.fallbackToOriginal ? "1" : "0",
        "X-Stealth-Fit-Selected": String(
          stats.selectedCandidateCount ?? 0
        ),
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
        )
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create tailored DOCX.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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

  return `stealth-tailored-${base || "resume"}.docx`;
}
