"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, FileText, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ResumeSuggestionCard } from "@/components/resume-tailor/resume-suggestion-card";
import { Button } from "@/components/ui/button";
import { TAILOR_RESUME_VERSION } from "@/lib/ai-versions";
import {
  createTailoredDocxFromLocalDocument,
  getBestResumeDocument,
  type LocalResumeDocumentMetadata
} from "@/lib/resume-local-document";
import type { CandidateProfile, Job, ResumeBulletRewrite, ResumeDocumentMetadata, TailoredResumeResult } from "@/lib/types";
import { cn } from "@/lib/utils";

type TailorResumePanelProps = {
  job: Job;
  profile: CandidateProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type TailorMode = "analyze" | "generate";

export function TailorResumePanel({ job, profile, open, onOpenChange }: Readonly<TailorResumePanelProps>) {
  const [result, setResult] = useState<TailoredResumeResult | null>(null);
  const [loadingMode, setLoadingMode] = useState<TailorMode | null>(null);
  const [error, setError] = useState("");
  const [hasGenerated, setHasGenerated] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [resumeDocument, setResumeDocument] = useState<ResumeDocumentMetadata | LocalResumeDocumentMetadata | null>(
    profile.resumeDocument ?? null
  );

  const cacheKey = useMemo(
    () => `stealth.tailoredResume.${TAILOR_RESUME_VERSION}.${job.id}.${hashTailorProfile(profile)}`,
    [job.id, profile]
  );
  const changedLineIndexes = useMemo(
    () => getChangedLineIndexes(profile.resumeText, result?.tailoredResumeText ?? "", result?.bulletRewrites ?? []),
    [profile.resumeText, result?.bulletRewrites, result?.tailoredResumeText]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setResumeDocument(getBestResumeDocument(profile));
  }, [mounted, profile]);

  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;

    const cached = window.localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as TailoredResumeResult;
        if (isTailoredResumeResult(parsed)) {
          setResult(parsed);
          setHasGenerated(parsed.source === "original_resume" || parsed.tailoredResumeText !== profile.resumeText);
          setError("");
          return;
        }
      } catch {
        window.localStorage.removeItem(cacheKey);
      }
    }

    setResult(null);
    setHasGenerated(false);
    void requestTailoring("analyze");
  }, [cacheKey, open]);

  async function requestTailoring(mode: TailorMode) {
    setLoadingMode(mode);
    setError("");

    try {
      const response = await fetch("/api/resume/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          profile,
          mode
        })
      });
      const payload = (await response.json()) as { result?: TailoredResumeResult; error?: string };

      if (!response.ok || !payload.result) throw new Error(payload.error ?? "Could not tailor this resume.");

      setResult(payload.result);
      setHasGenerated(mode === "generate");
      window.localStorage.setItem(cacheKey, JSON.stringify(payload.result));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Could not tailor this resume.";
      setError(message);
      const fallback: TailoredResumeResult = {
        score: 0,
        missingKeywords: [],
        suggestedSkills: [],
        editOperations: [],
        appliedChanges: [],
        skippedChanges: [],
        layoutAdjustment: {
          fontScale: 1,
          reason: "No layout adjustment applied."
        },
        bulletRewrites: [],
        atsNotes: ["AI tailoring failed. Showing your original resume."],
        tailoredResumeText: profile.resumeText || "",
        source: "original_resume",
        generatedAt: new Date().toISOString()
      };
      setResult(fallback);
      if (mode === "generate") setHasGenerated(true);
    } finally {
      setLoadingMode(null);
    }
  }

  async function downloadPdf() {
    if (!result?.tailoredResumeText) return;

    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    renderApplyReadyResumePdf({
      doc,
      tailoredText: result.tailoredResumeText
    });

    doc.save(`stealth-tailored-resume-${slugify(job.company)}-${slugify(job.title)}.pdf`);
  }

  function downloadTextResume() {
    if (!result?.tailoredResumeText) return;

    const { extension, mimeType } = getTextExportDetails(profile);
    const blob = new Blob([result.tailoredResumeText], { type: mimeType });
    downloadBlob(blob, `stealth-tailored-resume-${slugify(job.company)}-${slugify(job.title)}.${extension}`);
  }

  async function downloadDocx() {
    if (!result?.tailoredResumeText || !resumeDocument?.exactLayoutSupported) return;

    if (isLocalResumeDocument(resumeDocument)) {
      try {
        const buffer = await createTailoredDocxFromLocalDocument({
          editOperations: result.editOperations,
          rewrites: result.bulletRewrites,
          layoutAdjustment: result.layoutAdjustment
        });
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        });
        downloadBlob(blob, `stealth-tailored-resume-${slugify(job.company)}-${slugify(job.title)}.docx`);
      } catch {
        setError("Could not create the layout-preserved DOCX from local storage. Please re-upload your DOCX resume.");
      }
      return;
    }

    const response = await fetch("/api/resume/tailor/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile,
        rewrites: result.bulletRewrites,
        editOperations: result.editOperations,
        layoutAdjustment: result.layoutAdjustment
      })
    });

    if (!response.ok) {
      setError("Could not create the layout-preserved DOCX. Please try again.");
      return;
    }

    const blob = await response.blob();
    downloadBlob(blob, `stealth-tailored-resume-${slugify(job.company)}-${slugify(job.title)}.docx`);
  }

  const isLoading = Boolean(loadingMode);
  const isOriginalFallback = result?.source === "original_resume";
  const exportMode = getResumeExportMode(profile, resumeDocument);
  const hasLayoutPreservingDocx = exportMode === "docx";
  const isPdfTemplateExport = exportMode === "pdf" || exportMode === "unknown";
  const isTextExport = exportMode === "text" || exportMode === "markdown";

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100]">
          <motion.button
            type="button"
            aria-label="Close tailor resume panel"
            className="fixed inset-0 bg-[#171b24]/16 backdrop-blur-[6px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
          />
          <motion.aside
            className="fixed bottom-2 left-2 right-2 top-2 flex flex-col overflow-hidden rounded-[30px] border border-black/[0.08] bg-[#fbfcff]/95 shadow-[0_30px_90px_rgba(20,25,34,0.22)] backdrop-blur-2xl sm:bottom-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[560px] sm:rounded-l-[34px] sm:rounded-r-none sm:border-y-0 sm:border-r-0"
            initial={{ opacity: 0, x: 42 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 42 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="shrink-0 border-b border-black/[0.06] bg-white/45 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-[#5661d8]">
                    <Sparkles size={16} />
                    Tailor resume
                  </p>
                  <h2 className="mt-3 line-clamp-2 text-2xl font-semibold tracking-[-0.045em] text-[#171b24]">{job.title}</h2>
                  <p className="mt-1 text-sm text-[#687180]">{job.company}</p>
                  <p className="mt-3 inline-flex rounded-full border border-black/[0.06] bg-white/70 px-3 py-1 text-xs font-medium text-[#687180]">
                    {getExportBadgeLabel(exportMode)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-white/75 text-[#687180] shadow-sm transition hover:bg-white hover:text-[#171b24]"
                  aria-label="Close panel"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {isLoading && !result ? (
                <PanelLoadingState />
              ) : (
                <div className="space-y-4">
                  {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
                  {isOriginalFallback && (
                    <p className="rounded-2xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-800">
                      {result.atsNotes[0] || "AI tailoring failed. Showing your original resume."}
                    </p>
                  )}
                  <ExportModeNotice mode={exportMode} />
                  {hasGenerated && result && <TailoringChangeSummary result={result} />}

                  <div className="grid gap-3 sm:grid-cols-[0.72fr_1.28fr]">
                    <ResumeSuggestionCard title="Score">
                      <div className="flex items-end gap-2">
                        <span className="text-4xl font-semibold tracking-[-0.06em] text-[#171b24]">{result?.score ?? 0}</span>
                        <span className="pb-2 text-sm font-medium text-[#8a92a0]">/100</span>
                      </div>
                    </ResumeSuggestionCard>
                    <ResumeSuggestionCard title="Missing keywords">
                      <KeywordList items={result?.missingKeywords ?? []} fallback="No missing keywords yet." />
                    </ResumeSuggestionCard>
                  </div>

                  <ResumeSuggestionCard title="Recommended bullet rewrites">
                    <BulletRewriteList items={result?.bulletRewrites ?? []} />
                  </ResumeSuggestionCard>

                  <ResumeSuggestionCard title="Suggested skills">
                    <KeywordList items={result?.suggestedSkills ?? []} fallback="No safe skill additions found." />
                  </ResumeSuggestionCard>

                  <ResumeSuggestionCard title={hasGenerated ? "Resume draft" : "ATS notes"} muted>
                    {hasGenerated ? (
                      <ResumeDraftPreview
                        text={result?.tailoredResumeText || profile.resumeText || "No resume text available."}
                        changedLineIndexes={changedLineIndexes}
                      />
                    ) : (
                      <ul className="space-y-2">
                        {(result?.atsNotes?.length ? result.atsNotes : ["Keep the original structure. Generate when you are ready."]).map(
                          (note) => (
                            <li key={note} className="text-sm leading-6 text-[#5f6877]">
                              {note}
                            </li>
                          )
                        )}
                      </ul>
                    )}
                  </ResumeSuggestionCard>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-black/[0.06] bg-white/65 px-6 py-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant={hasGenerated ? "outline" : "default"} className="sm:flex-1" onClick={() => void requestTailoring("generate")} disabled={isLoading}>
                  {loadingMode === "generate" ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
                  {hasGenerated ? "Regenerate" : "Generate tailored resume"}
                </Button>
                {hasGenerated && (
                  <>
                    {hasLayoutPreservingDocx && (
                      <Button
                        className="sm:flex-1"
                        onClick={() => void downloadDocx()}
                        disabled={!result?.tailoredResumeText}
                      >
                        <Download size={16} />
                        Download tailored DOCX
                      </Button>
                    )}
                    {isPdfTemplateExport && (
                      <Button variant="outline" className="sm:flex-1" onClick={() => void downloadPdf()} disabled={!result?.tailoredResumeText}>
                        <Download size={16} />
                        Download template PDF
                      </Button>
                    )}
                    {isTextExport && (
                      <Button variant="outline" className="sm:flex-1" onClick={downloadTextResume} disabled={!result?.tailoredResumeText}>
                        <Download size={16} />
                        {exportMode === "markdown" ? "Download tailored MD" : "Download tailored TXT"}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function ExportModeNotice({ mode }: Readonly<{ mode: ResumeExportMode }>) {
  const copy = getExportModeCopy(mode);

  return (
    <div className="rounded-[22px] border border-black/[0.06] bg-white/65 px-4 py-3 text-sm leading-6 text-[#687180] shadow-sm">
      <span className="font-medium text-[#171b24]">{copy.title}</span> {copy.body}
    </div>
  );
}

function PanelLoadingState() {
  return (
    <div className="rounded-[26px] border border-black/[0.06] bg-white/70 p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <Loader2 className="animate-spin text-[#5661d8]" size={20} />
        <div>
          <p className="text-sm font-medium text-[#171b24]">Reading resume against this role</p>
          <p className="mt-1 text-sm text-[#687180]">Keeping structure intact and looking for only necessary changes.</p>
        </div>
      </div>
      <div className="mt-6 space-y-3">
        <span className="block h-3 w-11/12 animate-pulse rounded-full bg-black/[0.06]" />
        <span className="block h-3 w-3/4 animate-pulse rounded-full bg-black/[0.06]" />
        <span className="block h-3 w-5/6 animate-pulse rounded-full bg-black/[0.06]" />
      </div>
    </div>
  );
}

function TailoringChangeSummary({ result }: Readonly<{ result: TailoredResumeResult }>) {
  const appliedCount = result.appliedChanges?.length ?? 0;
  const skippedCount = result.skippedChanges?.filter((change) => change.skipReason !== "Preview only. Generate to apply this change.").length ?? 0;
  const fontScale = result.layoutAdjustment?.fontScale ?? 1;

  return (
    <div className="flex flex-wrap gap-2">
      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
        Applied {appliedCount} {appliedCount === 1 ? "change" : "changes"}
      </span>
      {fontScale < 0.995 && (
        <span className="rounded-full border border-[#cfd5ff] bg-[#f1f3ff] px-3 py-1.5 text-xs font-medium text-[#5661d8]">
          Font adjusted for one-page fit
        </span>
      )}
      {skippedCount > 0 && (
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
          {skippedCount} unmapped {skippedCount === 1 ? "edit" : "edits"}
        </span>
      )}
    </div>
  );
}

function KeywordList({ items, fallback }: Readonly<{ items: string[]; fallback: string }>) {
  if (!items.length) return <p className="text-sm leading-6 text-[#8a92a0]">{fallback}</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className="rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-xs font-medium text-[#4d5665] shadow-sm">
          {item}
        </span>
      ))}
    </div>
  );
}

function BulletRewriteList({ items }: Readonly<{ items: ResumeBulletRewrite[] }>) {
  if (!items.length) {
    return <p className="text-sm leading-6 text-[#8a92a0]">Generate suggestions to see high-impact rewrites.</p>;
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={`${item.original}-${item.rewrite}`} className="rounded-[18px] border border-black/[0.06] bg-white/60 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#9aa1ad]">Original</p>
          <p className="mt-2 text-sm leading-6 text-[#687180]">{item.original}</p>
          <p className="mt-4 text-xs font-medium uppercase tracking-[0.14em] text-[#9aa1ad]">Rewrite</p>
          <p className="mt-2 text-sm leading-6 text-[#171b24]">{item.rewrite}</p>
          <p className="mt-3 text-xs leading-5 text-[#8a92a0]">{item.reason}</p>
        </div>
      ))}
    </div>
  );
}

function ResumeDraftPreview({
  text,
  changedLineIndexes
}: Readonly<{
  text: string;
  changedLineIndexes: Set<number>;
}>) {
  const lines = text.split(/\n/);
  const hasHighlights = changedLineIndexes.size > 0;

  return (
    <div>
      {hasHighlights && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#cfd5ff] bg-[#f1f3ff] px-3 py-1.5 text-xs font-medium text-[#5661d8]">
          <span className="h-2 w-2 rounded-full bg-[#626eea]" />
          Highlighted lines changed here; downloads stay clean
        </div>
      )}
      <div className="max-h-[420px] overflow-y-auto rounded-[18px] border border-black/[0.06] bg-white/75 p-3 font-mono text-[11px] leading-5 text-[#4d5665] shadow-sm">
        {lines.map((line, index) => {
          const highlighted = changedLineIndexes.has(index) && line.trim().length > 0;

          return (
            <div
              key={`${index}-${line}`}
              className={cn(
                "min-h-5 whitespace-pre-wrap rounded-lg px-2 py-0.5",
                highlighted && "border border-[#dce0ff] bg-[#f1f3ff] text-[#28306f]"
              )}
            >
              {line || "\u00A0"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isTailoredResumeResult(value: unknown): value is TailoredResumeResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<TailoredResumeResult>;
  return typeof result.tailoredResumeText === "string" && Array.isArray(result.missingKeywords);
}

function hashTailorProfile(profile: CandidateProfile) {
  const input = JSON.stringify({
    resumeText: profile.resumeText,
    targetRoles: profile.targetRoles,
    headline: profile.headline,
    education: profile.education,
    lookingFor: profile.lookingFor,
    visaSponsorshipNeeded: profile.visaSponsorshipNeeded
  });
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

type ResumeExportMode = "docx" | "pdf" | "markdown" | "text" | "unknown";

function getResumeExportMode(profile: CandidateProfile, resumeDocument?: ResumeDocumentMetadata | null): ResumeExportMode {
  const document = resumeDocument ?? profile.resumeDocument;
  const fileName = document?.fileName?.toLowerCase() ?? "";
  const fileType = document?.fileType?.toLowerCase() ?? "";

  if (document?.exactLayoutSupported || fileName.endsWith(".docx")) return "docx";
  if (fileType.includes("pdf") || fileName.endsWith(".pdf")) return "pdf";
  if (fileType.includes("markdown") || fileName.endsWith(".md")) return "markdown";
  if (fileType.startsWith("text/") || fileName.endsWith(".txt")) return "text";

  return "unknown";
}

function getExportBadgeLabel(mode: ResumeExportMode) {
  switch (mode) {
    case "docx":
      return "Layout preserved: DOCX";
    case "pdf":
      return "Template export: PDF";
    case "markdown":
      return "Text export: MD";
    case "text":
      return "Text export: TXT";
    default:
      return "Template export";
  }
}

function getExportModeCopy(mode: ResumeExportMode) {
  switch (mode) {
    case "docx":
      return {
        title: "Exact layout preserved.",
        body: "Your tailored download keeps the uploaded Word layout. For an exact PDF, open the tailored DOCX in Word or Google Docs and export as PDF."
      };
    case "pdf":
      return {
        title: "Template PDF export.",
        body: "Your uploaded PDF is used for resume text and matching. Exact layout preservation requires uploading a DOCX version."
      };
    case "markdown":
      return {
        title: "Markdown export.",
        body: "Your tailored resume downloads as Markdown so it stays in the same uploaded format."
      };
    case "text":
      return {
        title: "Text export.",
        body: "Your tailored resume downloads as plain text so it stays in the same uploaded format."
      };
    default:
      return {
        title: "Template export.",
        body: "Upload a DOCX resume when you want exact Word layout preservation."
      };
  }
}

function getTextExportDetails(profile: CandidateProfile) {
  const mode = getResumeExportMode(profile, getBestResumeDocument(profile));
  if (mode === "markdown") return { extension: "md", mimeType: "text/markdown;charset=utf-8" };
  return { extension: "txt", mimeType: "text/plain;charset=utf-8" };
}

function isLocalResumeDocument(document: ResumeDocumentMetadata | LocalResumeDocumentMetadata): document is LocalResumeDocumentMetadata {
  return "localKey" in document || document.storagePath.startsWith("indexeddb://");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function getChangedLineIndexes(originalResume: string, tailoredResume: string, rewrites: ResumeBulletRewrite[]) {
  const changed = new Set<number>();
  const comparableOriginal = getRenderableResumeText(originalResume);
  const comparableTailored = getRenderableResumeText(tailoredResume);
  if (!comparableTailored.trim() || normalizeResumeForDiff(comparableOriginal) === normalizeResumeForDiff(comparableTailored)) return changed;

  const originalLines = new Set(
    comparableOriginal
      .split(/\n/)
      .map(normalizeLineForDiff)
      .filter(Boolean)
  );
  const rewriteNeedles = rewrites
    .map((rewrite) => rewrite.rewrite)
    .map(normalizeLineForDiff)
    .filter((item) => item.length > 12);

  comparableTailored.split(/\n/).forEach((line, index) => {
    const normalized = normalizeLineForDiff(line);
    if (!normalized) return;

    const matchesRewrite = rewriteNeedles.some((needle) => normalized.includes(needle) || needle.includes(normalized));
    const isNewOrChanged = !originalLines.has(normalized);

    if (matchesRewrite || isNewOrChanged) changed.add(index);
  });

  return changed;
}

function normalizeResumeForDiff(value: string) {
  return value.split(/\n/).map(normalizeLineForDiff).filter(Boolean).join("\n");
}

function normalizeLineForDiff(value: string) {
  return value
    .toLowerCase()
    .replace(/^[\-•*]\s*/, "")
    .replace(/[^\w+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type JsPdfInstance = InstanceType<typeof import("jspdf").jsPDF>;

type ResumePdfLine = {
  text: string;
  kind: "header" | "section" | "body" | "blank";
};

type ResumePdfLayout = {
  marginX: number;
  marginTop: number;
  marginBottom: number;
  fontSize: number;
  headerFontSize: number;
  sectionFontSize: number;
  lineHeight: number;
  sectionGap: number;
  paragraphGap: number;
};

function renderApplyReadyResumePdf({
  doc,
  tailoredText
}: {
  doc: JsPdfInstance;
  tailoredText: string;
}) {
  const lines = parseResumePdfLines(tailoredText);
  const layout = chooseResumePdfLayout(doc, lines);

  drawResumeLines(doc, lines, layout);
}

function parseResumePdfLines(text: string): ResumePdfLine[] {
  const rawLines = getRenderableResumeText(text)
    .split(/\n/)
    .map((line) => line.replace(/\s+$/g, ""));

  const firstSectionIndex = rawLines.findIndex((line) => isResumeSectionHeading(line));

  return rawLines.map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return { text: "", kind: "blank" };
    if (isResumeSectionHeading(trimmed)) return { text: normalizeDisplaySectionHeading(trimmed), kind: "section" };
    if (firstSectionIndex === -1 || index < firstSectionIndex) return { text: trimmed, kind: "header" };
    return { text: normalizeResumeBullet(trimmed), kind: "body" };
  });
}

function getRenderableResumeText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return true;
      if (/^STRUCTURED_RESUME_UPLOAD:/i.test(line)) return false;
      if (/^SOURCE_TYPE:/i.test(line)) return false;
      if (/^DETECTED_SECTIONS:/i.test(line)) return false;
      if (/^--- PAGE \d+ OF \d+ ---$/i.test(line)) return false;
      return true;
    })
    .map((line) => {
      const sectionMatch = line.match(/^SECTION:\s*(.+)$/i);
      if (!sectionMatch) return line;
      const section = sectionMatch[1]?.trim() ?? "";
      return /^resume header$/i.test(section) ? "" : section.toUpperCase();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chooseResumePdfLayout(doc: JsPdfInstance, lines: ResumePdfLine[]): ResumePdfLayout {
  const layouts: ResumePdfLayout[] = [
    { marginX: 46, marginTop: 46, marginBottom: 42, fontSize: 9.6, headerFontSize: 11, sectionFontSize: 10.5, lineHeight: 12.4, sectionGap: 7, paragraphGap: 3 },
    { marginX: 42, marginTop: 42, marginBottom: 38, fontSize: 9.1, headerFontSize: 10.4, sectionFontSize: 10, lineHeight: 11.7, sectionGap: 6, paragraphGap: 2 },
    { marginX: 38, marginTop: 38, marginBottom: 34, fontSize: 8.6, headerFontSize: 9.8, sectionFontSize: 9.4, lineHeight: 11, sectionGap: 5, paragraphGap: 1.5 },
    { marginX: 34, marginTop: 34, marginBottom: 32, fontSize: 8.1, headerFontSize: 9.3, sectionFontSize: 9, lineHeight: 10.4, sectionGap: 4, paragraphGap: 1 },
    { marginX: 30, marginTop: 30, marginBottom: 28, fontSize: 7.4, headerFontSize: 8.7, sectionFontSize: 8.3, lineHeight: 9.4, sectionGap: 3, paragraphGap: 0.5 },
    { marginX: 28, marginTop: 28, marginBottom: 26, fontSize: 6.8, headerFontSize: 8, sectionFontSize: 7.7, lineHeight: 8.6, sectionGap: 2, paragraphGap: 0 }
  ];

  return (
    layouts.find((layout) => estimateResumePageCount(doc, lines, layout) <= 1) ??
    layouts[layouts.length - 1]
  );
}

function drawResumeLines(doc: JsPdfInstance, lines: ResumePdfLine[], layout: ResumePdfLayout) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - layout.marginX * 2;
  let y = layout.marginTop;
  let headerLineCount = 0;

  doc.setTextColor(18, 22, 32);

  for (const line of lines) {
    if (line.kind === "blank") {
      y += layout.paragraphGap + 2;
      continue;
    }

    const style = getPdfLineStyle(line, headerLineCount);
    const fontSize = resolvePdfFontSize(line, headerLineCount, layout);
    const lineHeight = resolvePdfLineHeight(line, headerLineCount, layout);

    doc.setFont("helvetica", style.fontStyle);
    doc.setFontSize(fontSize);

    const wrapped = doc.splitTextToSize(line.text, maxWidth - style.indent);
    const requiredHeight = wrapped.length * lineHeight + style.before + style.after;

    if (y + requiredHeight > pageHeight - layout.marginBottom) break;

    y += style.before;

    if (line.kind === "section") {
      doc.setFillColor(246, 247, 251);
      doc.roundedRect(layout.marginX - 4, y - fontSize + 1, maxWidth + 8, fontSize + 6, 3, 3, "F");
    }

    wrapped.forEach((wrappedLine: string) => {
      const textWidth = doc.getTextWidth(wrappedLine);
      const x = style.align === "center" ? (pageWidth - textWidth) / 2 : layout.marginX + style.indent;
      doc.text(wrappedLine, x, y);
      y += lineHeight;
    });

    y += style.after;
    if (line.kind === "header") headerLineCount += 1;
  }
}

function getPdfLineStyle(line: ResumePdfLine, headerLineCount: number) {
  if (line.kind === "section") {
    return {
      align: "left" as const,
      before: 9,
      after: 5,
      fontSize: undefined,
      fontStyle: "bold" as const,
      indent: 0,
      lineHeight: undefined
    };
  }

  if (line.kind === "header") {
    return {
      align: "center" as const,
      before: headerLineCount === 0 ? 0 : 1.5,
      after: headerLineCount === 0 ? 2 : 0,
      fontSize: undefined,
      fontStyle: headerLineCount === 0 ? ("bold" as const) : ("normal" as const),
      indent: 0,
      lineHeight: undefined
    };
  }

  const isBullet = /^[•\-*]/.test(line.text);
  return {
    align: "left" as const,
    before: 0.5,
    after: 1.5,
    fontSize: undefined,
    fontStyle: "normal" as const,
    indent: isBullet ? 10 : 0,
    lineHeight: undefined
  };
}

function resolvePdfFontSize(line: ResumePdfLine, headerLineCount: number, layout: ResumePdfLayout) {
  if (line.kind === "section") return layout.sectionFontSize;
  if (line.kind === "header") return headerLineCount === 0 ? layout.headerFontSize : layout.fontSize;
  return layout.fontSize;
}

function resolvePdfLineHeight(line: ResumePdfLine, headerLineCount: number, layout: ResumePdfLayout) {
  if (line.kind === "header" && headerLineCount === 0) return layout.lineHeight + 1;
  if (line.kind === "section") return layout.lineHeight;
  return layout.lineHeight;
}

function estimateResumePageCount(doc: JsPdfInstance, lines: ResumePdfLine[], layout: ResumePdfLayout) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - layout.marginX * 2;
  let y = layout.marginTop;
  let pages = 1;
  let headerLineCount = 0;

  for (const line of lines) {
    if (line.kind === "blank") {
      y += layout.paragraphGap + 2;
      continue;
    }

    const style = getPdfLineStyle(line, headerLineCount);
    doc.setFont("helvetica", style.fontStyle);
    doc.setFontSize(resolvePdfFontSize(line, headerLineCount, layout));
    const wrapped = doc.splitTextToSize(line.text, maxWidth - style.indent);
    const requiredHeight = wrapped.length * resolvePdfLineHeight(line, headerLineCount, layout) + style.before + style.after;

    if (y + requiredHeight > pageHeight - layout.marginBottom) {
      pages += 1;
      y = layout.marginTop;
    }

    y += requiredHeight;
    if (line.kind === "header") headerLineCount += 1;
  }

  return pages;
}

function getOriginalResumePageCount(text: string) {
  const explicitPageCounts = [...text.matchAll(/--- PAGE \d+ OF (\d+) ---/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (explicitPageCounts.length) return Math.max(...explicitPageCounts);

  const renderableLineCount = getRenderableResumeText(text)
    .split(/\n/)
    .filter((line) => line.trim()).length;

  return Math.max(1, Math.ceil(renderableLineCount / 52));
}

function isResumeSectionHeading(line: string) {
  const cleaned = line.replace(/^SECTION:\s*/i, "").replace(/[:|]+$/g, "").trim();
  if (!cleaned || cleaned.length > 42) return false;

  const known = [
    "education",
    "skills",
    "experience",
    "professional experience",
    "work experience",
    "projects",
    "academic projects",
    "leadership",
    "certifications",
    "awards",
    "honors",
    "activities",
    "summary",
    "objective"
  ];

  if (known.includes(cleaned.toLowerCase())) return true;
  return /^[A-Z][A-Z\s/&-]{2,40}$/.test(cleaned) && cleaned.split(/\s+/).length <= 4;
}

function normalizeDisplaySectionHeading(line: string) {
  return line.replace(/^SECTION:\s*/i, "").replace(/[:|]+$/g, "").trim().toUpperCase();
}

function normalizeResumeBullet(line: string) {
  return line.replace(/^[*]\s+/, "• ");
}
