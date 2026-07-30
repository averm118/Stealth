import { NextResponse } from "next/server";
import { compileResumeLatex, createResumeLatexSource, inspectResumeLatexPdf } from "@/lib/resume-latex";
import { createResumeLayoutMapFromDocx } from "@/lib/resume-docx";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { CandidateProfile, ResumeLayoutAdjustment, ResumeLayoutMap } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const maxResumeChars = 50_000;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      profile?: unknown;
      tailoredResumeText?: unknown;
      resumeLayoutMap?: unknown;
      layoutAdjustment?: unknown;
      format?: unknown;
      documentTitle?: unknown;
      fileName?: unknown;
    };

    if (!isCandidateProfile(body.profile)) {
      return NextResponse.json({ error: "Candidate profile is required." }, { status: 400 });
    }

    if (!isNativeLatexResume(body.profile)) {
      return NextResponse.json(
        {
          error:
            "LaTeX export is available only for resumes originally uploaded as .tex source. DOCX resumes use exact-format Word rendering."
        },
        { status: 409 }
      );
    }

    if (typeof body.tailoredResumeText !== "string" || !body.tailoredResumeText.trim()) {
      return NextResponse.json({ error: "Tailored resume text is required." }, { status: 400 });
    }

    if (body.tailoredResumeText.length > maxResumeChars) {
      return NextResponse.json({ error: "Tailored resume text is too large to typeset." }, { status: 413 });
    }

    const providedLayoutMap = isResumeLayoutMap(body.resumeLayoutMap) ? body.resumeLayoutMap : null;
    const serverLayoutMap = providedLayoutMap ?? (await loadServerResumeLayoutMap(body.profile));
    const layoutAdjustment = cleanLayoutAdjustment(body.layoutAdjustment);
    let latexBuild = createResumeLatexSource({
      tailoredResumeText: body.tailoredResumeText,
      layoutMap: serverLayoutMap,
      layoutAdjustment,
      documentTitle: typeof body.documentTitle === "string" ? body.documentTitle : undefined
    });
    const baseName = getDownloadBaseName(
      typeof body.fileName === "string" ? body.fileName : body.profile.resumeDocument?.fileName
    );

    if (body.format === "tex") {
      return new NextResponse(latexBuild.source, {
        headers: {
          "Content-Type": "application/x-tex; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseName}.tex"`,
          "X-Stealth-Latex-Layout": latexBuild.blueprint.source,
          "X-Stealth-Latex-Paragraphs": String(latexBuild.blueprint.paragraphCount)
        }
      });
    }

    let compiled = await compileResumeLatex(latexBuild.source);
    let inspection = await inspectResumeLatexPdf(compiled.pdf, latexBuild.blueprint);
    let fitRetry = false;

    if (inspection.pageCount > 1 && layoutAdjustment.fontScale > 0.92) {
      fitRetry = true;
      latexBuild = createResumeLatexSource({
        tailoredResumeText: body.tailoredResumeText,
        layoutMap: serverLayoutMap,
        layoutAdjustment: {
          fontScale: 0.92,
          reason: "Retried at the minimum safe scale after LaTeX detected page overflow."
        },
        documentTitle: typeof body.documentTitle === "string" ? body.documentTitle : undefined
      });
      compiled = await compileResumeLatex(latexBuild.source);
      inspection = await inspectResumeLatexPdf(compiled.pdf, latexBuild.blueprint);
    }

    if (inspection.pageCount > 1) {
      return NextResponse.json(
        {
          error:
            "The tailored content would change the original one-page layout. Stealth stopped the export instead of shrinking or clipping it."
        },
        { status: 422 }
      );
    }

    return new NextResponse(new Uint8Array(compiled.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Stealth-Latex-Engine": compiled.engine,
        "X-Stealth-Latex-Layout": latexBuild.blueprint.source,
        "X-Stealth-Latex-Paragraphs": String(latexBuild.blueprint.paragraphCount),
        "X-Stealth-Latex-Pages": String(inspection.pageCount),
        "X-Stealth-Latex-Fit-Retry": fitRetry ? "1" : "0"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not typeset the tailored resume.";
    const status = message.includes("not configured for production") ? 503 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}

function isNativeLatexResume(profile: CandidateProfile) {
  const document = profile.resumeDocument;
  return Boolean(
    document &&
      (/\.tex$/i.test(document.fileName) ||
        /(?:application\/x-tex|text\/x-tex|text\/latex)/i.test(document.fileType))
  );
}

async function loadServerResumeLayoutMap(profile: CandidateProfile): Promise<ResumeLayoutMap | null> {
  const document = profile.resumeDocument;
  if (!document?.exactLayoutSupported || !document.storagePath || document.storagePath.startsWith("indexeddb://")) {
    return null;
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user || !document.storagePath.startsWith(`${user.id}/`)) return null;
  const { data, error } = await supabase.storage.from("resumes").download(document.storagePath);
  if (error || !data) return null;
  return createResumeLayoutMapFromDocx(Buffer.from(await data.arrayBuffer()));
}

function isCandidateProfile(value: unknown): value is CandidateProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<CandidateProfile>;
  return (
    typeof profile.resumeText === "string" &&
    typeof profile.lookingFor === "string" &&
    Array.isArray(profile.targetRoles)
  );
}

function isResumeLayoutMap(value: unknown): value is ResumeLayoutMap {
  if (!value || typeof value !== "object") return false;
  const layoutMap = value as Partial<ResumeLayoutMap>;
  return (
    layoutMap.source === "docx" &&
    Array.isArray(layoutMap.paragraphs) &&
    layoutMap.paragraphs.length > 0 &&
    layoutMap.paragraphs.length <= 180 &&
    Array.isArray(layoutMap.sectionNames)
  );
}

function cleanLayoutAdjustment(value: unknown): ResumeLayoutAdjustment {
  const adjustment = value && typeof value === "object" ? (value as Partial<ResumeLayoutAdjustment>) : null;
  const fontScale =
    typeof adjustment?.fontScale === "number" && Number.isFinite(adjustment.fontScale)
      ? Math.max(0.92, Math.min(1, adjustment.fontScale))
      : 1;

  return {
    fontScale,
    reason: typeof adjustment?.reason === "string" ? adjustment.reason.slice(0, 240) : "LaTeX layout reconstruction."
  };
}

function getDownloadBaseName(value?: string) {
  const base = (value || "resume")
    .replace(/\.(docx|pdf|txt|md|tex)$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `stealth-tailored-${base || "resume"}`;
}
