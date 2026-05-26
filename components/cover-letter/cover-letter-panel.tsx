"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, FileText, Loader2, MailPlus, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { COVER_LETTER_VERSION } from "@/lib/ai-versions";
import type { CandidateProfile, CoverLetterResult, Job } from "@/lib/types";

type CoverLetterPanelProps = {
  job: Job;
  profile: CandidateProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CoverLetterPanel({ job, profile, open, onOpenChange }: Readonly<CoverLetterPanelProps>) {
  const [result, setResult] = useState<CoverLetterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  const cacheKey = useMemo(
    () => `stealth.coverLetter.${COVER_LETTER_VERSION}.${job.id}.${hashCoverLetterProfile(profile)}`,
    [job.id, profile]
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
    if (!cached) {
      setResult(null);
      setError("");
      return;
    }

    try {
      const parsed = JSON.parse(cached) as CoverLetterResult;
      if (isCoverLetterResult(parsed)) {
        setResult(parsed);
        setError("");
        return;
      }
      window.localStorage.removeItem(cacheKey);
    } catch {
      window.localStorage.removeItem(cacheKey);
    }

    setResult(null);
    setError("");
  }, [cacheKey, open]);

  async function generateCoverLetter() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/resume/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          profile
        })
      });
      const payload = (await response.json()) as { result?: CoverLetterResult; error?: string };

      if (!response.ok || !payload.result) throw new Error(payload.error ?? "Cover letter generation failed. Please try again.");

      setResult(payload.result);
      window.localStorage.setItem(cacheKey, JSON.stringify(payload.result));
    } catch {
      setResult(null);
      setError("Cover letter generation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf() {
    if (!result?.coverLetterText) return;

    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    renderOnePageCoverLetterPdf(doc, result.coverLetterText);

    doc.save(`stealth-cover-letter-${slugify(job.company)}-${slugify(job.title)}.pdf`);
  }

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100]">
          <motion.button
            type="button"
            aria-label="Close cover letter panel"
            className="fixed inset-0 bg-[#171b24]/16 backdrop-blur-[6px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
          />
          <motion.aside
            className="fixed bottom-2 left-2 right-2 top-2 flex flex-col overflow-hidden rounded-[30px] border border-black/[0.08] bg-[#fbfcff]/95 shadow-[0_30px_90px_rgba(20,25,34,0.22)] backdrop-blur-2xl sm:bottom-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[540px] sm:rounded-l-[34px] sm:rounded-r-none sm:border-y-0 sm:border-r-0"
            initial={{ opacity: 0, x: 42 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 42 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="shrink-0 border-b border-black/[0.06] bg-white/45 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-[#5661d8]">
                    <MailPlus size={16} />
                    Cover letter
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
              <div className="space-y-4">
                {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

                {!result && !loading && (
                  <div className="rounded-[26px] border border-black/[0.06] bg-white/70 p-5 shadow-sm">
                    <p className="text-sm font-medium text-[#171b24]">Generate a humanized letter for this role.</p>
                    <p className="mt-2 text-sm leading-6 text-[#687180]">
                      Stealth will use your uploaded resume and this job description, without inventing experience.
                    </p>
                  </div>
                )}

                {loading && (
                  <div className="rounded-[26px] border border-black/[0.06] bg-white/70 p-6 shadow-sm">
                    <div className="flex items-center gap-3">
                      <Loader2 className="animate-spin text-[#5661d8]" size={20} />
                      <div>
                        <p className="text-sm font-medium text-[#171b24]">Writing your cover letter</p>
                        <p className="mt-1 text-sm text-[#687180]">Grounding it in your resume and the job description.</p>
                      </div>
                    </div>
                    <div className="mt-6 space-y-3">
                      <span className="block h-3 w-11/12 animate-pulse rounded-full bg-black/[0.06]" />
                      <span className="block h-3 w-4/5 animate-pulse rounded-full bg-black/[0.06]" />
                      <span className="block h-3 w-5/6 animate-pulse rounded-full bg-black/[0.06]" />
                    </div>
                  </div>
                )}

                {result && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-[0.6fr_1.4fr]">
                      <PanelCard title="Readiness">
                        <div className="flex items-end gap-2">
                          <span className="text-4xl font-semibold tracking-[-0.06em] text-[#171b24]">{result.score}</span>
                          <span className="pb-2 text-sm font-medium text-[#8a92a0]">/100</span>
                        </div>
                      </PanelCard>
                      <PanelCard title="Tone">
                        <SimpleList items={result.toneNotes} fallback="Clear, warm, and specific to the role." />
                      </PanelCard>
                    </div>

                    <PanelCard title="Talking points">
                      <SimpleList items={result.talkingPoints} fallback="Resume-backed points will appear here." />
                    </PanelCard>

                    <PanelCard title="Cover letter draft" muted>
                      <div className="max-h-[460px] overflow-y-auto whitespace-pre-wrap rounded-[18px] border border-black/[0.06] bg-white/75 p-4 text-sm leading-7 text-[#4d5665] shadow-sm">
                        {result.coverLetterText}
                      </div>
                    </PanelCard>
                  </>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-black/[0.06] bg-white/65 px-6 py-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button className="sm:flex-1" onClick={() => void generateCoverLetter()} disabled={loading}>
                  {loading ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
                  {result ? "Regenerate cover letter" : "Generate cover letter"}
                </Button>
                {result && (
                  <Button variant="outline" className="sm:flex-1" onClick={() => void downloadPdf()} disabled={!result.coverLetterText}>
                    <Download size={16} />
                    Download PDF
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

function PanelCard({
  title,
  children,
  muted = false
}: Readonly<{
  title: string;
  children: ReactNode;
  muted?: boolean;
}>) {
  return (
    <section className="rounded-[24px] border border-black/[0.06] bg-white/70 p-4 shadow-sm">
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">{title}</p>
      <div className={muted ? "" : "text-sm leading-6 text-[#4d5665]"}>{children}</div>
    </section>
  );
}

function SimpleList({ items, fallback }: Readonly<{ items: string[]; fallback: string }>) {
  if (!items.length) return <p className="text-sm leading-6 text-[#8a92a0]">{fallback}</p>;

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="text-sm leading-6 text-[#4d5665]">
          {item}
        </li>
      ))}
    </ul>
  );
}

function isCoverLetterResult(value: unknown): value is CoverLetterResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<CoverLetterResult>;
  return typeof result.coverLetterText === "string" && typeof result.score === "number";
}

function hashCoverLetterProfile(profile: CandidateProfile) {
  const input = JSON.stringify({
    resumeText: profile.resumeText,
    headline: profile.headline,
    targetRoles: profile.targetRoles,
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

type JsPdfInstance = InstanceType<typeof import("jspdf").jsPDF>;

type CoverLetterLayout = {
  margin: number;
  fontSize: number;
  lineHeight: number;
  paragraphGap: number;
};

function renderOnePageCoverLetterPdf(doc: JsPdfInstance, text: string) {
  const paragraphs = text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const layout = chooseCoverLetterLayout(doc, paragraphs);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - layout.margin * 2;
  let y = layout.margin;

  doc.setTextColor(18, 22, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(layout.fontSize);

  for (const paragraph of paragraphs) {
    const lines = doc.splitTextToSize(paragraph, maxWidth);
    const requiredHeight = lines.length * layout.lineHeight + layout.paragraphGap;
    if (y + requiredHeight > pageHeight - layout.margin) break;

    for (const line of lines) {
      doc.text(line, layout.margin, y);
      y += layout.lineHeight;
    }

    y += layout.paragraphGap;
  }
}

function chooseCoverLetterLayout(doc: JsPdfInstance, paragraphs: string[]): CoverLetterLayout {
  const layouts: CoverLetterLayout[] = [
    { margin: 62, fontSize: 11, lineHeight: 15.5, paragraphGap: 8 },
    { margin: 56, fontSize: 10.4, lineHeight: 14.3, paragraphGap: 6 },
    { margin: 50, fontSize: 9.8, lineHeight: 13.2, paragraphGap: 5 },
    { margin: 44, fontSize: 9.2, lineHeight: 12.2, paragraphGap: 4 },
    { margin: 40, fontSize: 8.6, lineHeight: 11.4, paragraphGap: 3 }
  ];

  return layouts.find((layout) => estimateCoverLetterPages(doc, paragraphs, layout) <= 1) ?? layouts[layouts.length - 1];
}

function estimateCoverLetterPages(doc: JsPdfInstance, paragraphs: string[], layout: CoverLetterLayout) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - layout.margin * 2;
  let y = layout.margin;
  let pages = 1;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(layout.fontSize);

  for (const paragraph of paragraphs) {
    const lines = doc.splitTextToSize(paragraph, maxWidth);
    const requiredHeight = lines.length * layout.lineHeight + layout.paragraphGap;
    if (y + requiredHeight > pageHeight - layout.margin) {
      pages += 1;
      y = layout.margin;
    }
    y += requiredHeight;
  }

  return pages;
}
