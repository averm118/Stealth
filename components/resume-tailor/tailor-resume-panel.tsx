"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, FileText, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ResumeSuggestionCard } from "@/components/resume-tailor/resume-suggestion-card";
import { Button } from "@/components/ui/button";
import { TAILOR_RESUME_VERSION } from "@/lib/ai-versions";
import type { CandidateProfile, Job, ResumeBulletRewrite, TailoredResumeResult } from "@/lib/types";
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
    const margin = 54;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth - margin * 2;
    let y = margin;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);

    const resumeLines = result.tailoredResumeText.split(/\n/);

    for (const [lineIndex, paragraph] of resumeLines.entries()) {
      const line = paragraph.trim();
      const lines = line ? doc.splitTextToSize(line, maxWidth) : [""];
      const shouldHighlight = changedLineIndexes.has(lineIndex) && Boolean(line);

      if (shouldHighlight && y + lines.length * 15 + 8 > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }

      if (shouldHighlight) {
        doc.setFillColor(241, 243, 255);
        doc.roundedRect(margin - 8, y - 11, maxWidth + 16, lines.length * 15 + 7, 5, 5, "F");
      }

      for (const item of lines) {
        if (y > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }

        doc.text(item, margin, y);
        y += 15;
      }

      y += line ? 5 : 8;
    }

    doc.save(`stealth-tailored-resume-${slugify(job.company)}-${slugify(job.title)}.pdf`);
  }

  const isLoading = Boolean(loadingMode);
  const isOriginalFallback = result?.source === "original_resume";

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
                <Button className="sm:flex-1" onClick={() => void requestTailoring("generate")} disabled={isLoading}>
                  {loadingMode === "generate" ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
                  Generate tailored resume
                </Button>
                {hasGenerated && (
                  <Button variant="outline" className="sm:flex-1" onClick={() => void downloadPdf()} disabled={!result?.tailoredResumeText}>
                    <Download size={16} />
                    {isOriginalFallback ? "Download original PDF" : "Download PDF"}
                  </Button>
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
          Highlighted lines were changed or added
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

function getChangedLineIndexes(originalResume: string, tailoredResume: string, rewrites: ResumeBulletRewrite[]) {
  const changed = new Set<number>();
  if (!tailoredResume.trim() || normalizeResumeForDiff(originalResume) === normalizeResumeForDiff(tailoredResume)) return changed;

  const originalLines = new Set(
    originalResume
      .split(/\n/)
      .map(normalizeLineForDiff)
      .filter(Boolean)
  );
  const rewriteNeedles = rewrites
    .map((rewrite) => rewrite.rewrite)
    .map(normalizeLineForDiff)
    .filter((item) => item.length > 12);

  tailoredResume.split(/\n/).forEach((line, index) => {
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
