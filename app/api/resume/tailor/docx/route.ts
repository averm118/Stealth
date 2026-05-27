import { NextResponse } from "next/server";
import { createTailoredDocxBuildResultFromOriginal } from "@/lib/resume-docx";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { CandidateProfile, ResumeBulletRewrite, ResumeEditOperation, ResumeLayoutAdjustment } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { profile, rewrites, editOperations, layoutAdjustment } = (await request.json()) as {
      profile?: unknown;
      rewrites?: unknown;
      editOperations?: unknown;
      layoutAdjustment?: unknown;
    };

    if (!isCandidateProfile(profile)) {
      return NextResponse.json({ error: "Candidate profile is required." }, { status: 400 });
    }

    if (!profile.resumeDocument?.exactLayoutSupported || !profile.resumeDocument.storagePath) {
      return NextResponse.json({ error: "DOCX layout preservation is only available for uploaded DOCX resumes." }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
    }

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    if (!profile.resumeDocument.storagePath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: "Resume document does not belong to this user." }, { status: 403 });
    }

    const { data, error } = await supabase.storage.from("resumes").download(profile.resumeDocument.storagePath);
    if (error || !data) {
      return NextResponse.json({ error: "Could not download the original resume document." }, { status: 404 });
    }

    const originalDocx = Buffer.from(await data.arrayBuffer());
    const tailoredDocx = await createTailoredDocxBuildResultFromOriginal(originalDocx, {
      editOperations: cleanEditOperations(editOperations),
      rewrites: cleanRewrites(rewrites),
      layoutAdjustment: cleanLayoutAdjustment(layoutAdjustment)
    });

    return new NextResponse(new Uint8Array(tailoredDocx.buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${getDownloadName(profile.resumeDocument.fileName)}"`,
        "X-Stealth-DOCX-Applied": String(tailoredDocx.stats.appliedEdits),
        "X-Stealth-DOCX-Inserted": String(tailoredDocx.stats.insertedBullets),
        "X-Stealth-DOCX-Removed": String(tailoredDocx.stats.removedLines),
        "X-Stealth-DOCX-Skipped": String(tailoredDocx.stats.skippedEdits)
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create tailored DOCX.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isCandidateProfile(value: unknown): value is CandidateProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<CandidateProfile>;
  return typeof profile.resumeText === "string" && typeof profile.lookingFor === "string";
}

function cleanEditOperations(value: unknown): ResumeEditOperation[] {
  if (!Array.isArray(value)) return [];

  const cleaned: Array<ResumeEditOperation | null> = value.map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<ResumeEditOperation>;
      if (
        !isAllowedOperationType(record.type) ||
        typeof record.original !== "string" ||
        (record.type !== "remove_low_priority_paragraph" && typeof record.replacement !== "string")
      ) {
        return null;
      }

      return {
        type: record.type,
        paragraphId: typeof record.paragraphId === "string" ? record.paragraphId : undefined,
        insertAfterParagraphId: typeof record.insertAfterParagraphId === "string" ? record.insertAfterParagraphId : undefined,
        targetSection: typeof record.targetSection === "string" ? record.targetSection : undefined,
        sectionName: typeof record.sectionName === "string" ? record.sectionName : undefined,
        original: record.original,
        replacement: typeof record.replacement === "string" ? record.replacement : "",
        keywords: Array.isArray(record.keywords) ? record.keywords.filter((item): item is string => typeof item === "string") : [],
        reason: typeof record.reason === "string" ? record.reason : "Tailored for this role."
      };
    });

  return cleaned
    .filter((item): item is ResumeEditOperation => Boolean(item))
    .slice(0, 28);
}

function isAllowedOperationType(value: unknown): value is ResumeEditOperation["type"] {
  return (
    value === "replace_line" ||
    value === "append_to_line" ||
    value === "shorten_line" ||
    value === "replace_paragraph_text" ||
    value === "append_to_paragraph" ||
    value === "replace_bullet" ||
    value === "insert_bullet_after" ||
    value === "shorten_paragraph" ||
    value === "remove_low_priority_paragraph"
  );
}

function cleanRewrites(value: unknown): ResumeBulletRewrite[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<ResumeBulletRewrite>;
      if (typeof record.original !== "string" || typeof record.rewrite !== "string") return null;
      return {
        original: record.original,
        rewrite: record.rewrite,
        reason: typeof record.reason === "string" ? record.reason : "Tailored for this role."
      };
    })
    .filter((item): item is ResumeBulletRewrite => Boolean(item))
    .slice(0, 12);
}

function cleanLayoutAdjustment(value: unknown): ResumeLayoutAdjustment {
  const record = value && typeof value === "object" ? (value as Partial<ResumeLayoutAdjustment>) : null;
  const fontScale = typeof record?.fontScale === "number" && Number.isFinite(record.fontScale) ? record.fontScale : 1;

  return {
    fontScale: Math.max(0.9, Math.min(1, fontScale)),
    reason: typeof record?.reason === "string" ? record.reason : "No layout adjustment applied."
  };
}

function getDownloadName(fileName: string) {
  const base = fileName
    .replace(/\.docx$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `stealth-tailored-${base || "resume"}.docx`;
}
