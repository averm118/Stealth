"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Download,
  FileCheck2,
  FileText,
  Gauge,
  LayoutTemplate,
  Loader2,
  LockKeyhole,
  ScanLine,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { TAILOR_RESUME_VERSION } from "@/lib/ai-versions";
import {
  getBestResumeDocument,
  getLocalResumeLayoutMap,
  type LocalResumeDocumentMetadata
} from "@/lib/resume-local-document";
import type {
  CandidateProfile,
  Job,
  ResumeBulletRewrite,
  ResumeDocumentMetadata,
  ResumeLayoutMap,
  ResumePdfFidelityReport,
  ResumeVerifiedFitPlan,
  TailoredResumeResult
} from "@/lib/types";

type TailorResumePanelProps = {
  job: Job;
  profile: CandidateProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type TailorMode = "analyze" | "generate";

type DisplayedRewrite = ResumeBulletRewrite & {
  impactGain?: number;
  candidateLabel?: "Primary" | "Concise" | "Slot-safe";
};

type VerifiedPdf = {
  blob: Blob;
  url: string;
  report: ResumePdfFidelityReport;
  retried: boolean;
  fallbackToOriginal: boolean;
  appliedEdits: number;
  skippedEdits: number;
  selectedCandidateCount: number;
  shortenedForFit: number;
  removedForFit: number;
  rejectedForFit: number;
  replacedLowRelevanceBullets: number;
  skillsPruned: number;
  fontScaleApplied: number;
  targetPageCount: number;
  finalPageCount: number;
  removedParagraphIds: string[];
  fitPlan: ResumeVerifiedFitPlan | null;
  attempts: number;
  skippedByReason: Record<string, number>;
};

export function TailorResumePanel({ job, profile, open, onOpenChange }: Readonly<TailorResumePanelProps>) {
  const [result, setResult] = useState<TailoredResumeResult | null>(null);
  const [loadingMode, setLoadingMode] = useState<TailorMode | null>(null);
  const [error, setError] = useState("");
  const [hasGenerated, setHasGenerated] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pdfExport, setPdfExport] = useState<"verifying" | "downloading" | null>(null);
  const [verifiedPdf, setVerifiedPdf] = useState<VerifiedPdf | null>(null);
  const [activeLayoutMap, setActiveLayoutMap] = useState<ResumeLayoutMap | null>(null);
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
  const exportMode = getResumeExportMode(profile, resumeDocument);
  const hasLayoutPreservingDocx = exportMode === "docx";
  const isTextExport = exportMode === "text" || exportMode === "markdown";
  const canRenderVerifiedPdf =
    hasLayoutPreservingDocx &&
    Boolean(resumeDocument?.exactLayoutSupported) &&
    Boolean(resumeDocument && !isLocalResumeDocument(resumeDocument));
  const verificationKey = `${cacheKey}.${result?.generatedAt ?? "none"}`;
  const requestedVerificationRef = useRef("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setResumeDocument(getBestResumeDocument(profile));
  }, [mounted, profile]);

  useEffect(() => {
    return () => {
      if (verifiedPdf?.url) window.URL.revokeObjectURL(verifiedPdf.url);
    };
  }, [verifiedPdf?.url]);

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
          setResult({
            ...parsed,
            fitRemovalCandidates: Array.isArray(parsed.fitRemovalCandidates)
              ? parsed.fitRemovalCandidates
              : [],
            fitSkillPruneCandidates: Array.isArray(
              parsed.fitSkillPruneCandidates
            )
              ? parsed.fitSkillPruneCandidates
              : []
          });
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
    setVerifiedPdf(null);
    requestedVerificationRef.current = "";
    void requestTailoring("analyze");
  }, [cacheKey, open]);

  useEffect(() => {
    if (
      !open ||
      !hasGenerated ||
      !result?.tailoredResumeText ||
      !canRenderVerifiedPdf ||
      requestedVerificationRef.current === verificationKey
    ) {
      return;
    }

    requestedVerificationRef.current = verificationKey;
    void prepareVerifiedPdf(false);
  }, [canRenderVerifiedPdf, hasGenerated, open, result?.tailoredResumeText, verificationKey]);

  async function requestTailoring(mode: TailorMode, options?: { resumeLayoutMap?: ResumeLayoutMap | null }) {
    setLoadingMode(mode);
    setError("");

    try {
      const response = await fetch("/api/resume/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          profile,
          mode,
          resumeLayoutMap: options?.resumeLayoutMap ?? null
        })
      });
      const payload = (await response.json()) as { result?: TailoredResumeResult; error?: string };

      if (!response.ok || !payload.result) throw new Error(payload.error ?? "Could not tailor this resume.");

      setResult(payload.result);
      setHasGenerated(mode === "generate");
      setVerifiedPdf(null);
      requestedVerificationRef.current = "";
      window.localStorage.setItem(cacheKey, JSON.stringify(payload.result));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Could not tailor this resume.";
      setError(message);
      const fallback: TailoredResumeResult = {
        score: 0,
        missingKeywords: [],
        suggestedSkills: [],
        editOperations: [],
        fitRemovalCandidates: [],
        fitSkillPruneCandidates: [],
        appliedChanges: [],
        skippedChanges: [],
        layoutAdjustment: {
          fontScale: 1,
          reason: "No layout adjustment applied."
        },
        docxEditStats: {
          appliedEdits: 0,
          insertedBullets: 0,
          removedLines: 0,
          skippedEdits: 0,
          validationStatus: "not_generated",
          fontScale: 1,
          warning: "AI tailoring failed. Showing your original resume."
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

  async function generateTailoredResume() {
    let resumeLayoutMap: ResumeLayoutMap | null = null;
    if (resumeDocument?.exactLayoutSupported && isLocalResumeDocument(resumeDocument)) {
      try {
        resumeLayoutMap = await getLocalResumeLayoutMap();
        setActiveLayoutMap(resumeLayoutMap);
      } catch (layoutError) {
        const message = layoutError instanceof Error ? layoutError.message : "Could not read the uploaded resume layout.";
        setError(`Could not read the uploaded resume layout. ${message}`);
        return;
      }
    }

    await requestTailoring("generate", { resumeLayoutMap });
  }

  async function prepareVerifiedPdf(downloadWhenReady: boolean) {
    if (!result?.tailoredResumeText || !canRenderVerifiedPdf) return;
    if (verifiedPdf) {
      if (downloadWhenReady) {
        downloadBlob(
          verifiedPdf.blob,
          `stealth-verified-resume-${slugify(job.company)}-${slugify(job.title)}.pdf`
        );
      }
      return;
    }

    setPdfExport(downloadWhenReady ? "downloading" : "verifying");
    setError("");

    try {
      const response = await fetch("/api/resume/tailor/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          rewrites: result.bulletRewrites,
          editOperations: result.editOperations,
          fitRemovalCandidates: result.fitRemovalCandidates,
          fitSkillPruneCandidates: result.fitSkillPruneCandidates
        })
      });

      if (!response.ok) {
        const details = (await response.json().catch(() => null)) as
          | { error?: string; report?: ResumePdfFidelityReport }
          | null;
        throw new Error(
          details?.error ||
            "The tailored resume could not pass exact Word-layout verification."
        );
      }

      const blob = await response.blob();
      const report = decodePdfReport(response.headers.get("X-Stealth-PDF-Report"));
      if (!report || report.status !== "verified") {
        throw new Error("The Word renderer returned a PDF without a valid fidelity receipt.");
      }

      const nextVerifiedPdf: VerifiedPdf = {
        blob,
        url: window.URL.createObjectURL(blob),
        report,
        retried: response.headers.get("X-Stealth-PDF-Retry") === "1",
        fallbackToOriginal:
          response.headers.get("X-Stealth-PDF-Fallback") === "1",
        appliedEdits: Number(response.headers.get("X-Stealth-DOCX-Applied") ?? 0),
        skippedEdits: Number(response.headers.get("X-Stealth-DOCX-Skipped") ?? 0),
        selectedCandidateCount: Number(
          response.headers.get("X-Stealth-Fit-Selected") ?? 0
        ),
        shortenedForFit: Number(
          response.headers.get("X-Stealth-Fit-Shortened") ?? 0
        ),
        removedForFit: Number(
          response.headers.get("X-Stealth-Fit-Removed") ?? 0
        ),
        rejectedForFit: Number(
          response.headers.get("X-Stealth-Fit-Rejected") ?? 0
        ),
        replacedLowRelevanceBullets: Number(
          response.headers.get("X-Stealth-Fit-Replaced-Low-Relevance") ?? 0
        ),
        skillsPruned: Number(
          response.headers.get("X-Stealth-Fit-Skills-Pruned") ?? 0
        ),
        fontScaleApplied: Number(
          response.headers.get("X-Stealth-Fit-Font-Scale") ?? 1
        ),
        targetPageCount: Number(
          response.headers.get("X-Stealth-Fit-Target-Pages") ?? 0
        ),
        finalPageCount: Number(
          response.headers.get("X-Stealth-Fit-Final-Pages") ?? 0
        ),
        removedParagraphIds: decodeRemovedParagraphIds(
          response.headers.get("X-Stealth-Fit-Removed-Ids")
        ),
        fitPlan: decodeVerifiedFitPlan(
          response.headers.get("X-Stealth-Fit-Plan")
        ),
        attempts: Number(
          response.headers.get("X-Stealth-Fit-Attempts") ?? 0
        ),
        skippedByReason: decodeCountRecord(
          response.headers.get("X-Stealth-DOCX-Skipped-By-Reason")
        )
      };
      setVerifiedPdf(nextVerifiedPdf);

      if (downloadWhenReady) {
        downloadBlob(
          blob,
          `stealth-verified-resume-${slugify(job.company)}-${slugify(job.title)}.pdf`
        );
      }
    } catch (exportError) {
      const message =
        exportError instanceof Error
          ? exportError.message
          : "Could not verify the tailored resume with Microsoft Word.";
      setError(message);
    } finally {
      setPdfExport(null);
    }
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
      setError(
        "Apply-ready DOCX export requires the server-stored original so Microsoft Word can verify page fit. Re-upload the DOCX while signed in."
      );
      return;
    }

    const response = await fetch("/api/resume/tailor/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile,
        rewrites: result.bulletRewrites,
        editOperations: result.editOperations,
        layoutAdjustment: result.layoutAdjustment,
        fitRemovalCandidates: result.fitRemovalCandidates,
        fitSkillPruneCandidates: result.fitSkillPruneCandidates,
        verifiedFitPlan: verifiedPdf?.fitPlan
      })
    });

    if (!response.ok) {
      const details = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(details?.error || "Could not create the tailored resume. Please try again.");
      return;
    }

    const blob = await response.blob();
    const wordVerification = response.headers.get("X-Stealth-DOCX-Word-Verified");
    const fallbackToOriginal =
      response.headers.get("X-Stealth-DOCX-Fallback") === "1";
    const skippedEdits = Number(response.headers.get("X-Stealth-DOCX-Skipped") ?? 0);
    if (fallbackToOriginal && skippedEdits > 0) {
      setError(
        `No complete fitted edit plan passed Word verification. ${skippedEdits} ${
          skippedEdits === 1 ? "edit" : "edits"
        } were rejected and the downloaded DOCX is your unchanged original.`
      );
    } else if (wordVerification !== "verified") {
      setError("The DOCX could not be verified by Microsoft Word.");
    }
    downloadBlob(blob, `stealth-tailored-resume-${slugify(job.company)}-${slugify(job.title)}.docx`);
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
            className="fixed inset-2 mx-auto flex max-w-[1480px] flex-col overflow-hidden rounded-[26px] border border-black/[0.1] bg-[#f7f8fc]/98 shadow-[0_34px_110px_rgba(20,25,34,0.28)] sm:inset-4"
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.985 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="shrink-0 border-b border-black/[0.07] bg-white px-4 py-3 sm:px-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#171b24] text-white">
                    <ShieldCheck size={19} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5661d8]">
                      Layout-locked tailoring
                    </p>
                    <h2 className="truncate text-base font-semibold text-[#171b24]">
                      {job.title} <span className="font-normal text-[#7b8492]">at {job.company}</span>
                    </h2>
                  </div>
                </div>

                <div className="hidden items-center gap-2 lg:flex">
                  <WorkspaceStatus icon={LockKeyhole} label="Evidence locked" active />
                  <WorkspaceStatus icon={LayoutTemplate} label={getExportBadgeLabel(exportMode)} active />
                  <WorkspaceStatus
                    icon={FileCheck2}
                    label="Word layout verified"
                    active={verifiedPdf?.report.status === "verified"}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-black/[0.08] bg-white text-[#687180] transition hover:border-black/[0.16] hover:text-[#171b24]"
                  aria-label="Close panel"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[240px_minmax(0,1fr)_340px] lg:overflow-hidden">
              {isLoading && !result ? (
                <div className="col-span-full grid min-h-[620px] place-items-center">
                  <PanelLoadingState />
                </div>
              ) : (
                <>
                  <aside className="border-b border-black/[0.07] bg-white px-5 py-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9299a5]">Alignment</p>
                    <div className="mt-3 flex items-end gap-2">
                      <span className="text-5xl font-semibold tracking-[-0.07em] text-[#171b24]">{result?.score ?? 0}</span>
                      <span className="pb-2 text-sm font-medium text-[#9299a5]">/100</span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e7e9ef]">
                      <motion.div
                        className="h-full rounded-full bg-[#5661d8]"
                        initial={{ width: 0 }}
                        animate={{ width: `${result?.score ?? 0}%` }}
                        transition={{ duration: 0.55 }}
                      />
                    </div>

                    <div className="mt-7 border-t border-black/[0.07] pt-5">
                      <p className="flex items-center gap-2 text-xs font-semibold text-[#171b24]">
                        <Gauge size={15} className="text-[#5661d8]" />
                        Job signals
                      </p>
                      <div className="mt-3">
                        <KeywordList items={result?.missingKeywords ?? []} fallback="No major gaps detected." />
                      </div>
                    </div>

                    <div className="mt-7 border-t border-black/[0.07] pt-5">
                      <p className="flex items-center gap-2 text-xs font-semibold text-[#171b24]">
                        <LayoutTemplate size={15} className="text-[#0f766e]" />
                        Layout contract
                      </p>
                      <ul className="mt-3 space-y-2.5">
                        {[
                          verifiedPdf && verifiedPdf.fontScaleApplied < 0.999
                            ? `Protected typography locked · body text ${Math.round(
                                verifiedPdf.fontScaleApplied * 100
                              )}%`
                            : "Protected typography locked",
                          "Dates and tab stops locked",
                          "Only verified fit bullets may be removed",
                          "Word-rendered PDF checked"
                        ].map(
                          (item) => (
                            <li key={item} className="flex items-start gap-2 text-xs leading-5 text-[#687180]">
                              <Check size={14} className="mt-0.5 shrink-0 text-[#0f766e]" />
                              {item}
                            </li>
                          )
                        )}
                      </ul>
                    </div>

                    <div className="mt-7 border-t border-black/[0.07] pt-5">
                      <ExportModeNotice mode={exportMode} />
                    </div>
                  </aside>

                  <main className="relative min-h-[680px] overflow-hidden bg-[#e9ebf1] p-4 sm:p-7 lg:overflow-y-auto">
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(23,27,36,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(23,27,36,0.035)_1px,transparent_1px)] bg-[size:24px_24px]" />
                    <div className="relative mx-auto max-w-[760px]">
                      {error && (
                        <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {error}
                        </p>
                      )}
                      {isOriginalFallback && (
                        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          {result.atsNotes[0] || "AI tailoring failed. Showing your original resume."}
                        </p>
                      )}
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7b8492]">
                            {verifiedPdf
                              ? "Verified Word preview"
                              : pdfExport
                                ? "Verifying Word layout"
                                : hasGenerated
                                  ? "Text-only preview"
                                  : "Original structure"}
                          </p>
                          <p className="mt-1 text-xs text-[#9299a5]">
                            {verifiedPdf
                              ? "This is the actual server-rendered PDF."
                              : "The exact document preview appears after Word verification."}
                          </p>
                        </div>
                        <span className="rounded-full border border-[#cfd5ff] bg-[#f5f6ff] px-3 py-1 text-[11px] font-semibold text-[#5661d8]">
                          {verifiedPdf
                            ? `${verifiedPdf.report.pageCount} ${
                                verifiedPdf.report.pageCount === 1 ? "page" : "pages"
                              } · verified`
                            : "Original geometry locked"}
                        </span>
                      </div>
                      {verifiedPdf ? (
                        <VerifiedPdfPreview url={verifiedPdf.url} />
                      ) : pdfExport ? (
                        <PdfVerificationState />
                      ) : (
                        <ResumeTextPreview
                          text={
                            result?.tailoredResumeText ||
                            profile.resumeText ||
                            "No resume text available."
                          }
                          changedLineIndexes={
                            hasGenerated ? changedLineIndexes : new Set<number>()
                          }
                        />
                      )}
                    </div>
                  </main>

                  <aside className="border-t border-black/[0.07] bg-[#fbfbfd] px-5 py-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9299a5]">Change queue</p>
                        <p className="mt-1 text-sm font-semibold text-[#171b24]">
                          {verifiedPdf
                            ? `${verifiedPdf.appliedEdits} Word-verified ${
                                verifiedPdf.appliedEdits === 1 ? "edit" : "edits"
                              }`
                            : `${result?.editOperations.length ?? 0} proposed ${
                                result?.editOperations.length === 1 ? "edit" : "edits"
                              }`}
                        </p>
                      </div>
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#f0f2ff] text-[#5661d8]">
                        <WandSparkles size={17} />
                      </span>
                    </div>

                    {hasGenerated && result && (
                      <div className="mt-4">
                        <TailoringChangeSummary
                          result={result}
                          verifiedPdf={verifiedPdf}
                        />
                      </div>
                    )}

                    {verifiedPdf && (
                      <div className="mt-4">
                        <FidelityReceipt
                          pdf={verifiedPdf}
                          removalCandidates={result?.fitRemovalCandidates ?? []}
                        />
                      </div>
                    )}

                    <div className="mt-5">
                      <BulletRewriteList
                        items={getDisplayedRewrites(result, verifiedPdf)}
                      />
                    </div>

                    <div className="mt-6 border-t border-black/[0.07] pt-5">
                      <p className="text-xs font-semibold text-[#171b24]">Safe skill coverage</p>
                      <div className="mt-3">
                        <KeywordList items={result?.suggestedSkills ?? []} fallback="No unsupported skill additions." />
                      </div>
                    </div>

                    <div className="mt-6 border-t border-black/[0.07] pt-5">
                      <p className="text-xs font-semibold text-[#171b24]">Layout notes</p>
                      <ul className="mt-3 space-y-2">
                        {(result?.atsNotes?.length ? result.atsNotes : ["Analyze first, then generate a layout-locked version."]).map(
                          (note) => (
                            <li key={note} className="text-xs leading-5 text-[#687180]">
                              {note}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  </aside>
                </>
              )}
            </div>

            <div className="shrink-0 border-t border-black/[0.07] bg-white px-4 py-3 sm:px-6">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <p className="hidden max-w-md text-xs leading-5 text-[#7b8492] md:block">
                  Microsoft Word renders the verified PDF. The original DOCX remains the editable source of truth.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant={hasGenerated ? "outline" : "default"}
                    onClick={() => void generateTailoredResume()}
                    disabled={isLoading || Boolean(pdfExport)}
                  >
                    {loadingMode === "generate" ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                    {hasGenerated ? "Regenerate" : "Generate with layout lock"}
                  </Button>
                {hasGenerated && (
                  <>
                    {hasLayoutPreservingDocx && (
                      <Button
                        onClick={() => void prepareVerifiedPdf(true)}
                        disabled={
                          !result?.tailoredResumeText ||
                          Boolean(pdfExport) ||
                          !canRenderVerifiedPdf
                        }
                        title={
                          canRenderVerifiedPdf
                            ? "Download the Word-rendered, layout-verified PDF"
                            : "Verified PDF requires a server-stored DOCX resume"
                        }
                      >
                        {pdfExport ? (
                          <Loader2 className="animate-spin" size={16} />
                        ) : verifiedPdf ? (
                          <FileCheck2 size={16} />
                        ) : (
                          <ScanLine size={16} />
                        )}
                        {verifiedPdf ? "Verified PDF" : "Verify PDF"}
                      </Button>
                    )}
                    {hasLayoutPreservingDocx && (
                      <Button
                        variant="outline"
                        onClick={() => void downloadDocx()}
                        disabled={!result?.tailoredResumeText || Boolean(pdfExport)}
                      >
                        <FileText size={16} />
                        Verified DOCX
                      </Button>
                    )}
                    {isTextExport && (
                      <Button variant="outline" onClick={downloadTextResume} disabled={!result?.tailoredResumeText}>
                        <Download size={16} />
                        {exportMode === "markdown" ? "MD" : "TXT"}
                      </Button>
                    )}
                  </>
                )}
                </div>
              </div>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function WorkspaceStatus({
  icon: Icon,
  label,
  active
}: Readonly<{
  icon: typeof LockKeyhole;
  label: string;
  active: boolean;
}>) {
  return (
    <span
      className={
        active
          ? "inline-flex h-8 items-center gap-2 rounded-lg border border-[#d8dcff] bg-[#f4f5ff] px-3 text-[11px] font-semibold text-[#4d57c4]"
          : "inline-flex h-8 items-center gap-2 rounded-lg border border-black/[0.07] bg-[#f8f8fa] px-3 text-[11px] font-semibold text-[#9299a5]"
      }
    >
      <Icon size={13} />
      {label}
    </span>
  );
}

function VerifiedPdfPreview({ url }: Readonly<{ url: string }>) {
  return (
    <div className="mx-auto aspect-[8.5/11] w-full overflow-hidden bg-white shadow-[0_24px_70px_rgba(30,35,48,0.18)] ring-1 ring-black/[0.08]">
      <iframe
        title="Verified tailored resume PDF"
        src={`${url}#toolbar=0&navpanes=0&view=FitH`}
        className="h-full w-full border-0 bg-white"
      />
    </div>
  );
}

function PdfVerificationState() {
  return (
    <div className="mx-auto grid aspect-[8.5/11] w-full place-items-center bg-white shadow-[0_24px_70px_rgba(30,35,48,0.18)] ring-1 ring-black/[0.08]">
      <div className="max-w-xs px-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#f0f2ff] text-[#5661d8]">
          <Loader2 className="animate-spin" size={21} />
        </span>
        <p className="mt-4 text-sm font-semibold text-[#171b24]">
          Rendering with Microsoft Word
        </p>
        <p className="mt-2 text-xs leading-5 text-[#7b8492]">
          Comparing page geometry, dates, typography, and every stable line before the PDF is shown.
        </p>
      </div>
    </div>
  );
}

function ResumeTextPreview({
  text,
  changedLineIndexes
}: Readonly<{
  text: string;
  changedLineIndexes: Set<number>;
}>) {
  const lines = parseResumePdfLines(text);
  let headerIndex = 0;

  return (
    <div className="mx-auto aspect-[8.5/11] w-full overflow-hidden bg-white px-[7%] py-[5.5%] shadow-[0_24px_70px_rgba(30,35,48,0.18)] ring-1 ring-black/[0.08]">
      <div className="h-full overflow-hidden font-sans text-[9px] leading-[1.28] text-[#20242b] sm:text-[10px]">
        {lines.map((line, index) => {
          const highlighted = changedLineIndexes.has(index) && line.text.trim().length > 0;
          const isPrimaryHeader = line.kind === "header" && headerIndex++ === 0;

          if (line.kind === "blank") {
            return <div key={`blank-${index}`} className="h-1.5" />;
          }

          if (line.kind === "section") {
            return (
              <div
                key={`${index}-${line.text}`}
                className="mb-1 mt-2 border-b border-[#20242b] pb-0.5 text-[9px] font-bold uppercase sm:text-[10px]"
              >
                {line.text}
              </div>
            );
          }

          return (
            <div
              key={`${index}-${line.text}`}
              className={[
                "relative min-h-[13px] whitespace-pre-wrap px-1",
                line.kind === "header" ? "text-center" : "",
                isPrimaryHeader ? "mb-0.5 text-[15px] font-bold leading-tight sm:text-[17px]" : "",
                /^[•\-*]\s+/.test(line.text) ? "pl-3 before:absolute before:left-1 before:content-['•']" : "",
                highlighted ? "rounded-sm bg-[#e9ebff] text-[#20275f] ring-1 ring-[#cbd0ff]" : ""
              ].join(" ")}
            >
              {line.text.replace(/^[•\-*]\s+/, "")}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FidelityReceipt({
  pdf,
  removalCandidates
}: Readonly<{
  pdf: VerifiedPdf;
  removalCandidates: TailoredResumeResult["fitRemovalCandidates"];
}>) {
  const checks = [
    ["Page geometry", pdf.report.pageGeometryPreserved],
    ["Date alignment", pdf.report.dateAlignmentPreserved],
    ["Typography", pdf.report.typographyPreserved],
    ["Paragraph balance", pdf.report.paragraphStructurePreserved],
    ["Complete rewrite text", pdf.report.fullTextCoveragePreserved],
    ["200 DPI visual diff", pdf.report.pixelFidelityPreserved],
    ["DOCX package integrity", pdf.report.packageIntegrityPreserved]
  ] as const;
  const removedBullets = pdf.removedParagraphIds
    .map((paragraphId) =>
      removalCandidates.find((candidate) => candidate.paragraphId === paragraphId)
    )
    .filter(
      (
        candidate
      ): candidate is TailoredResumeResult["fitRemovalCandidates"][number] =>
        Boolean(candidate)
    );
  const prunedSkills = pdf.fitPlan?.approvedSkillPrunes ?? [];

  return (
    <div className="rounded-[18px] border border-emerald-200 bg-emerald-50/75 p-4">
      <p className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
        <FileCheck2 size={15} />
        Word layout verified
      </p>
      <div className="mt-3 space-y-2">
        {checks.map(([label, passed]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 text-xs text-emerald-900/75"
          >
            <span>{label}</span>
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <Check size={13} />
              {passed ? "Preserved" : "Failed"}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-emerald-200 pt-3 text-[11px] leading-4 text-emerald-800/70">
        {pdf.report.stableAnchorsChecked} stable anchors checked · maximum movement{" "}
        {pdf.report.maxAnchorDeltaPt.toFixed(2)}pt
        {` · ${(pdf.report.changedPixelsOutsideMasksRatio * 100).toFixed(3)}% outside-mask pixels changed`}
        {pdf.retried ? " · shorter-edit retry used" : ""}
        {pdf.attempts > 0 ? ` · ${pdf.attempts} Word renders` : ""}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-emerald-800/70">
        {pdf.appliedEdits} verified {pdf.appliedEdits === 1 ? "edit" : "edits"}
        {pdf.shortenedForFit > 0
          ? ` · ${pdf.shortenedForFit} complete shorter ${
              pdf.shortenedForFit === 1 ? "candidate" : "candidates"
            } used`
          : ""}
        {pdf.removedForFit > 0
          ? ` · ${pdf.removedForFit} low-relevance ${
              pdf.removedForFit === 1 ? "bullet" : "bullets"
            } removed for fit`
          : ""}
        {pdf.skillsPruned > 0
          ? ` · ${pdf.skillsPruned} low-signal ${
              pdf.skillsPruned === 1 ? "skill" : "skills"
            } pruned`
          : ""}
        {pdf.fontScaleApplied < 0.999
          ? ` · body text ${Math.round(pdf.fontScaleApplied * 100)}%`
          : ""}
        {pdf.skippedEdits > 0
          ? ` · ${pdf.skippedEdits} skipped to protect layout`
          : ""}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-emerald-800/70">
        Page target {pdf.targetPageCount} · final {pdf.finalPageCount}
        {pdf.rejectedForFit > 0
          ? ` · ${pdf.rejectedForFit} proposed ${
              pdf.rejectedForFit === 1 ? "edit" : "edits"
            } rejected`
          : ""}
      </p>
      {Object.keys(pdf.skippedByReason).length > 0 && (
        <p className="mt-1 text-[11px] leading-4 text-emerald-800/70">
          Rejected by reason:{" "}
          {Object.entries(pdf.skippedByReason)
            .filter(
              ([reason, count]) =>
                count > 0 && reason !== "page_fit_retry"
            )
            .map(([reason, count]) => `${formatSkipReason(reason)} ${count}`)
            .join(", ") || "none"}
        </p>
      )}
      {pdf.fallbackToOriginal && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
          No complete tailored configuration fit safely. This verified file is the
          unchanged original.
        </p>
      )}
      {removedBullets.length > 0 && (
        <div className="mt-3 border-t border-emerald-200 pt-3">
          <p className="text-[11px] font-semibold text-emerald-800">
            Removed only to preserve page fit
          </p>
          <ul className="mt-2 space-y-2">
            {removedBullets.map((candidate) => (
              <li
                key={candidate.paragraphId}
                className="text-[11px] leading-4 text-emerald-900/70"
              >
                {candidate.original}
              </li>
            ))}
          </ul>
        </div>
      )}
      {prunedSkills.length > 0 && (
        <div className="mt-3 border-t border-emerald-200 pt-3">
          <p className="text-[11px] font-semibold text-emerald-800">
            Low-signal skills pruned for fit
          </p>
          <p className="mt-2 text-[11px] leading-4 text-emerald-900/70">
            {prunedSkills.map((candidate) => candidate.skill).join(", ")}
          </p>
        </div>
      )}
    </div>
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

function TailoringChangeSummary({
  result,
  verifiedPdf
}: Readonly<{
  result: TailoredResumeResult;
  verifiedPdf: VerifiedPdf | null;
}>) {
  const stats = result.docxEditStats;
  const appliedCount = verifiedPdf
    ? verifiedPdf.appliedEdits
    : stats?.appliedEdits ?? result.appliedChanges?.length ?? 0;
  const shortenedCount = stats?.shortenedEdits ?? result.appliedChanges?.filter((change) => change.type === "shorten_line" || change.type === "shorten_paragraph").length ?? 0;
  const repairedCount = stats?.repairedEdits ?? result.appliedChanges?.filter((change) => Boolean(change.repairNote)).length ?? 0;
  const convertedCount = stats?.convertedEdits ?? result.appliedChanges?.filter((change) => change.repairNote?.toLowerCase().includes("converted")).length ?? 0;
  const skippedCount = verifiedPdf
    ? verifiedPdf.skippedEdits
    : result.skippedChanges?.filter(
        (change) =>
          change.skipReason !== "Preview only. Generate to apply this change."
      ).length ?? 0;
  const skillsPruned = verifiedPdf
    ? verifiedPdf.skillsPruned
    : stats?.skillsPruned ?? 0;
  const fontScaleApplied = verifiedPdf
    ? verifiedPdf.fontScaleApplied
    : stats?.fontScaleApplied ?? 1;
  const replacedLowRelevance = verifiedPdf
    ? verifiedPdf.replacedLowRelevanceBullets
    : stats?.replacedLowRelevanceBullets ?? 0;
  const rejectedForRedundancy = stats?.rejectedForRedundancy ?? 0;
  const layoutSkippedCount =
    (stats?.skippedByReason?.layout_locked_removal ?? 0) +
    (stats?.skippedByReason?.unsafe_insertion ?? 0) +
    (stats?.skippedByReason?.layout_retry ?? 0) +
    (stats?.skippedByReason?.visual_gap_risk ?? 0) +
    (stats?.skippedByReason?.protected_layout ?? 0);
  const skippedReasons = Object.entries(
    verifiedPdf?.skippedByReason ?? stats?.skippedByReason ?? {}
  )
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${formatSkipReason(reason)} ${count}`)
    .join(", ");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
          {verifiedPdf ? "Verified" : "Proposed"} {appliedCount}{" "}
          {appliedCount === 1 ? "edit" : "edits"}
        </span>
        {shortenedCount > 0 && (
          <span className="rounded-full border border-[#cfd5ff] bg-[#f1f3ff] px-3 py-1.5 text-xs font-medium text-[#5661d8]">
            Shortened {shortenedCount} {shortenedCount === 1 ? "line" : "lines"}
          </span>
        )}
        {repairedCount > 0 && (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700">
            Repaired {repairedCount} {repairedCount === 1 ? "mapping" : "mappings"}
          </span>
        )}
        {convertedCount > 0 && (
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
            Converted {convertedCount} to in-place {convertedCount === 1 ? "edit" : "edits"}
          </span>
        )}
        {replacedLowRelevance > 0 && (
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700">
            Upgraded {replacedLowRelevance} low-relevance {replacedLowRelevance === 1 ? "bullet" : "bullets"}
          </span>
        )}
        {skillsPruned > 0 && (
          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-700">
            Pruned {skillsPruned} low-signal {skillsPruned === 1 ? "skill" : "skills"}
          </span>
        )}
        {fontScaleApplied < 0.999 && (
          <span className="rounded-full border border-[#cfd5ff] bg-[#f1f3ff] px-3 py-1.5 text-xs font-medium text-[#5661d8]">
            Body text {Math.round(fontScaleApplied * 100)}%
          </span>
        )}
        {rejectedForRedundancy > 0 && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
            Removed {rejectedForRedundancy} repetitive {rejectedForRedundancy === 1 ? "rewrite" : "rewrites"}
          </span>
        )}
        {skippedCount > 0 && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
            Skipped {skippedCount} {skippedCount === 1 ? "edit" : "edits"}
          </span>
        )}
        {layoutSkippedCount > 0 && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
            Skipped for layout {layoutSkippedCount}
          </span>
        )}
      </div>
      {stats?.warning && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          {stats.warning}
        </p>
      )}
      {skippedReasons && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          Skipped by reason: {skippedReasons}
        </p>
      )}
    </div>
  );
}

function formatSkipReason(value: string) {
  return value.replace(/_/g, " ");
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

function BulletRewriteList({ items }: Readonly<{ items: DisplayedRewrite[] }>) {
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
          {(typeof item.impactGain === "number" || item.candidateLabel) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {typeof item.impactGain === "number" && (
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700">
                  +{item.impactGain.toFixed(1)} relevance gain
                </span>
              )}
              {item.candidateLabel && (
                <span className="rounded-full border border-[#cfd5ff] bg-[#f1f3ff] px-2.5 py-1 text-[11px] font-medium text-[#5661d8]">
                  {item.candidateLabel} fit
                </span>
              )}
            </div>
          )}
          <p className="mt-3 text-xs leading-5 text-[#8a92a0]">{item.reason}</p>
        </div>
      ))}
    </div>
  );
}

function getDisplayedRewrites(
  result: TailoredResumeResult | null,
  verifiedPdf: VerifiedPdf | null
): DisplayedRewrite[] {
  if (!result) return [];
  if (!verifiedPdf?.fitPlan) return result.bulletRewrites;

  return verifiedPdf.fitPlan.selections
    .map((selection): DisplayedRewrite | null => {
      const operation = result.editOperations[selection.operationIndex];
      if (!operation) return null;
      const candidates = uniqueFitCandidates([
        operation.replacement,
        ...(operation.replacementCandidates ?? [])
      ]);
      const [strongest, ...alternatives] = candidates;
      const ordered = [
        ...(strongest ? [strongest] : []),
        ...alternatives.sort(
          (first, second) =>
            estimateFitTextWidth(second) - estimateFitTextWidth(first)
        )
      ];
      const rewrite = ordered[selection.candidateIndex];
      if (!rewrite) return null;
      return {
        original: operation.original,
        rewrite,
        reason: operation.reason,
        impactGain: selection.impactGain ?? operation.impactGain,
        candidateLabel:
          selection.candidateIndex === 0
            ? "Primary"
            : selection.candidateIndex === 1
              ? "Concise"
              : "Slot-safe"
      };
    })
    .filter((item): item is DisplayedRewrite => Boolean(item));
}

function uniqueFitCandidates(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function estimateFitTextWidth(value: string) {
  let width = 0;
  for (const character of value) {
    if (/\s/.test(character)) width += 0.42;
    else if (/[MW@%&]/.test(character)) width += 1.28;
    else if (/[A-Z0-9]/.test(character)) width += 1.02;
    else if (/[ilI1|.,:;'`]/.test(character)) width += 0.48;
    else width += 0.86;
  }
  return width;
}

function isTailoredResumeResult(value: unknown): value is TailoredResumeResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<TailoredResumeResult>;
  return typeof result.tailoredResumeText === "string" && Array.isArray(result.missingKeywords);
}

function decodeRemovedParagraphIds(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

function decodeCountRecord(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" && Number.isFinite(entry[1])
        )
        .slice(0, 20)
    );
  } catch {
    return {};
  }
}

function decodeVerifiedFitPlan(value: string | null): ResumeVerifiedFitPlan | null {
  const parsed = decodeBase64Json(value);
  if (!parsed || typeof parsed !== "object") return null;
  const plan = parsed as Partial<ResumeVerifiedFitPlan>;
  if (
    (plan.version !== 1 && plan.version !== 2) ||
    typeof plan.baselineFingerprint !== "string" ||
    (plan.validationMode !== "strict" && plan.validationMode !== "balanced") ||
    !Array.isArray(plan.selections) ||
    !Array.isArray(plan.approvedRemovalParagraphIds) ||
    !Array.isArray(plan.rejectedOperationIndexes)
  ) {
    return null;
  }
  return plan as ResumeVerifiedFitPlan;
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
      return "Original DOCX locked";
    case "pdf":
      return "PDF best effort";
    case "markdown":
      return "Markdown export";
    case "text":
      return "Text export";
    default:
      return "Clean export";
  }
}

function getExportModeCopy(mode: ResumeExportMode) {
  switch (mode) {
    case "docx":
      return {
        title: "Original DOCX locked.",
        body: "Only approved text nodes can change. Runs, tabs, dates, styles, margins, and document structure stay intact."
      };
    case "pdf":
      return {
        title: "PDF is best effort.",
        body: "Exact Word-layout verification requires the original editable DOCX."
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
        title: "Clean text export.",
        body: "Upload the original DOCX to unlock exact-format Word rendering and validation."
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

function decodePdfReport(value: string | null): ResumePdfFidelityReport | null {
  const parsed = decodeBase64Json(value);
  return isResumePdfFidelityReport(parsed) ? parsed : null;
}

function decodeBase64Json(value: string | null): unknown {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      "="
    );
    const bytes = Uint8Array.from(window.atob(padded), (character) =>
      character.charCodeAt(0)
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function isResumePdfFidelityReport(value: unknown): value is ResumePdfFidelityReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ResumePdfFidelityReport>;
  return (
    (report.status === "verified" || report.status === "failed") &&
    report.renderer === "microsoft_graph_word" &&
    typeof report.pageCount === "number" &&
    typeof report.pageGeometryPreserved === "boolean" &&
    typeof report.typographyPreserved === "boolean" &&
    typeof report.dateAlignmentPreserved === "boolean" &&
    typeof report.paragraphStructurePreserved === "boolean" &&
    typeof report.pixelFidelityPreserved === "boolean" &&
    typeof report.changedPixelsOutsideMasksRatio === "number" &&
    typeof report.packageIntegrityPreserved === "boolean" &&
    typeof report.stableAnchorsChecked === "number" &&
    typeof report.maxAnchorDeltaPt === "number" &&
    Array.isArray(report.failureReasons) &&
    Array.isArray(report.warnings)
  );
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

type ResumePdfLine = {
  text: string;
  kind: "header" | "section" | "body" | "blank";
};

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
