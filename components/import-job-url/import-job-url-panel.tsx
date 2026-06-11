"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Link2, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Job } from "@/lib/types";

type SourceHint = "auto" | "company" | "linkedin" | "handshake" | "ziprecruiter" | "other";

type ImportResponse =
  | {
      status: "imported";
      job: Job;
      jobUrl: string;
      extractionSource: string;
      warnings: string[];
      inserted: boolean;
      updated: boolean;
    }
  | {
      status: "needs_paste";
      reason: string;
      warnings: string[];
    }
  | {
      status: "error";
      error: string;
    };

const sourceHintOptions: Array<{ value: SourceHint; label: string }> = [
  { value: "auto", label: "Auto detect" },
  { value: "company", label: "Company site" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "handshake", label: "Handshake" },
  { value: "ziprecruiter", label: "ZipRecruiter" },
  { value: "other", label: "Other board" }
];

export function ImportJobUrlPanel({
  open,
  onClose,
  onImported
}: Readonly<{
  open: boolean;
  onClose: () => void;
  onImported?: (job: Job) => void;
}>) {
  const [url, setUrl] = useState("");
  const [sourceHint, setSourceHint] = useState<SourceHint>("auto");
  const [pastedText, setPastedText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [needsPasteReason, setNeedsPasteReason] = useState("");
  const [imported, setImported] = useState<Extract<ImportResponse, { status: "imported" }> | null>(null);
  const [mounted, setMounted] = useState(false);

  const canSubmit = useMemo(() => url.trim().length > 8 && !loading, [loading, url]);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function submitImport() {
    if (!canSubmit) return;

    setLoading(true);
    setError("");
    setNeedsPasteReason("");
    setImported(null);

    try {
      const response = await fetch("/api/jobs/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          sourceHint,
          pastedText: showPaste ? pastedText.trim() : undefined
        })
      });

      const rawPayload = await response.text();
      let payload: ImportResponse;
      try {
        payload = JSON.parse(rawPayload) as ImportResponse;
      } catch {
        payload = {
          status: "error",
          error: response.ok
            ? "Stealth could not read the import response. Try again."
            : rawPayload.trim() || `Import failed with HTTP ${response.status}.`
        };
      }

      if (payload.status === "imported") {
        setImported(payload);
        onImported?.(payload.job);
        return;
      }

      if (payload.status === "needs_paste") {
        setShowPaste(true);
        setNeedsPasteReason(payload.reason);
        return;
      }

      setError(payload.error || "Job import failed.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Job import failed. Check the URL and try again.");
    } finally {
      setLoading(false);
    }
  }

  function resetAndClose() {
    setError("");
    setNeedsPasteReason("");
    setImported(null);
    onClose();
  }

  const panel = (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button className="fixed inset-0 cursor-default" aria-label="Close import panel" onClick={resetAndClose} />
          <motion.aside
            className="fixed right-3 top-24 z-10 flex max-h-[calc(100vh-7rem)] w-[calc(100%-1.5rem)] max-w-[460px] flex-col overflow-hidden rounded-[32px] border border-black/[0.08] bg-white shadow-[-18px_24px_80px_rgba(15,23,42,0.24)] sm:right-6 sm:top-28 sm:w-[440px]"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
          >
            <div className="border-b border-black/[0.06] bg-white px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-[#5661d8]">
                    <Link2 size={16} />
                    Import job URL
                  </p>
                  <h2 className="mt-3 text-[1.5rem] font-semibold leading-[1.08] tracking-[-0.04em] text-[#171b24]">Bring any posting into Stealth.</h2>
                  <p className="mt-3 max-w-[340px] text-sm leading-6 text-[#687180]">
                    Paste a public posting. If the site blocks access, add the job text and Stealth will build the role page.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Close"
                  onClick={resetAndClose}
                  className="h-10 w-10 shrink-0 rounded-full bg-white shadow-sm"
                >
                  <X size={18} />
                </Button>
              </div>
            </div>

            <div className="space-y-4 overflow-y-auto bg-[#f6f7fb] px-5 py-5">
              <div className="rounded-[26px] border border-black/[0.07] bg-white p-5 shadow-[0_16px_44px_rgba(20,25,34,0.09)]">
                <label className="block">
                  <span className="mb-2 ml-1 block text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">Job URL</span>
                  <Input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://company.com/careers/job..."
                    className="h-[52px] rounded-full border-black/[0.08] bg-white px-5 text-[15px] shadow-sm"
                  />
                </label>

                <label className="relative mt-4 block">
                  <span className="mb-2 ml-1 block text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">Source</span>
                  <select
                    value={sourceHint}
                    onChange={(event) => setSourceHint(event.target.value as SourceHint)}
                    className="h-[52px] w-full appearance-none rounded-full border border-black/[0.07] bg-white px-5 pr-10 text-[15px] font-medium text-[#171b24] shadow-sm outline-none transition focus:border-[#bdc5ff] focus:ring-4 focus:ring-[#bdc5ff]/20"
                  >
                    {sourceHintOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={15} className="pointer-events-none absolute bottom-4 right-4 text-[#8a92a0]" />
                </label>

                <div className="mt-5 flex flex-col gap-4">
                  <button
                    type="button"
                    onClick={() => setShowPaste((value) => !value)}
                    className="w-fit text-sm font-medium text-[#5661d8] transition hover:text-[#171b24]"
                  >
                    {showPaste ? "Hide pasted job text" : "Paste details instead"}
                  </button>

                  {showPaste ? (
                    <label className="block">
                      <span className="mb-2 ml-1 block text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">Job text</span>
                      <Textarea
                        value={pastedText}
                        onChange={(event) => setPastedText(event.target.value)}
                        placeholder="Paste the role title, company, location, responsibilities, requirements, and apply details..."
                        className="min-h-44 rounded-[24px] bg-white p-4 leading-6 shadow-sm"
                      />
                    </label>
                  ) : null}

                  <Button className="h-[52px] w-full rounded-full text-[15px] shadow-[0_16px_34px_rgba(17,24,39,0.16)]" onClick={submitImport} disabled={!canSubmit}>
                    {loading ? <Loader2 size={17} className="animate-spin" /> : <Link2 size={17} />}
                    {loading ? "Importing job..." : needsPasteReason && showPaste ? "Import pasted job" : "Import job"}
                  </Button>
                </div>
              </div>

              {needsPasteReason ? (
                <StatusCard tone="warning" title="Paste needed" body={needsPasteReason} />
              ) : null}

              {error ? <StatusCard tone="error" title="Import failed" body={error} /> : null}

              {imported ? (
                <div className="rounded-[26px] border border-emerald-200 bg-emerald-50 p-5 shadow-[0_16px_44px_rgba(20,25,34,0.08)]">
                  <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <CheckCircle2 size={17} />
                    Imported into Stealth
                  </p>
                  <h3 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-[#171b24]">{imported.job.title}</h3>
                  <p className="mt-1 text-sm text-[#687180]">
                    {imported.job.company} · {imported.job.location}
                  </p>
                  <Button asChild className="mt-5 w-full">
                    <Link href={imported.jobUrl}>
                      Open in Stealth
                      <ExternalLink size={15} />
                    </Link>
                  </Button>
                </div>
              ) : null}
            </div>

          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return mounted ? createPortal(panel, document.body) : null;
}

function StatusCard({ tone, title, body }: Readonly<{ tone: "warning" | "error"; title: string; body: string }>) {
  const isError = tone === "error";
  return (
    <div
      className={
        isError
          ? "rounded-[24px] border border-rose-200 bg-rose-50 p-4 text-rose-700"
          : "rounded-[24px] border border-amber-200 bg-amber-50 p-4 text-amber-800"
      }
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <AlertCircle size={16} />
        {title}
      </p>
      <p className="mt-2 text-sm leading-6 opacity-90">{body}</p>
    </div>
  );
}
