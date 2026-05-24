"use client";

import Link from "next/link";
import { BookmarkCheck, ExternalLink, Inbox, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCompanyInitials, getCompanyLogoUrls } from "@/lib/company-logos";
import { Job, SavedStatus } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Reveal, Stagger, StaggerItem } from "@/components/motion-primitives";

const statuses: SavedStatus[] = ["saved", "applied", "interview", "rejected", "offer"];

export default function SavedPage() {
  const { savedJobs, setJobStatus, removeSavedJob } = useAppState();
  const [jobs, setJobs] = useState<Job[]>([]);
  const tracked = jobs.filter((job) => savedJobs[job.id]);

  useEffect(() => {
    async function loadJobs() {
      const response = await fetch("/api/jobs");
      const result = (await response.json()) as { jobs?: Job[] };
      setJobs(result.jobs ?? []);
    }

    void loadJobs();
  }, []);

  return (
    <div className="pb-24">
      <Reveal>
        <Card className="mb-6 overflow-hidden p-0">
          <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
            <div className="p-7 sm:p-8">
              <p className="flex items-center gap-2 text-sm font-medium text-[#5661d8]">
                <BookmarkCheck size={16} />
                Tracker
              </p>
              <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-[#171b24]">
                Your saved roles, organized.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687180]">
                Keep the roles worth following, move each one through the pipeline, and open Details when you need the deeper AI brief.
              </p>
            </div>
            <div className="border-t border-black/[0.06] bg-white/55 p-7 lg:border-l lg:border-t-0">
              <p className="text-sm font-medium text-[#171b24]">Pipeline health</p>
              <div className="mt-5 space-y-4">
                <TrackerMetric label="Tracked roles" value={tracked.length} />
                <TrackerMetric label="Applied" value={countByStatus(savedJobs, "applied")} />
                <TrackerMetric label="Interviews" value={countByStatus(savedJobs, "interview")} />
              </div>
            </div>
          </div>
        </Card>
      </Reveal>
      {tracked.length === 0 ? (
        <Reveal>
        <Card className="grid min-h-[420px] place-items-center p-8 text-center">
          <div>
            <Inbox className="mx-auto text-[#5661d8]" size={42} />
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-[#171b24]">No roles saved yet</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-[#687180]">Save high-fit jobs from the radar to build your internship pipeline.</p>
            <Button asChild className="mt-6">
              <Link href="/dashboard">Browse radar</Link>
            </Button>
          </div>
        </Card>
        </Reveal>
      ) : (
        <Reveal>
          <Card className="p-5 sm:p-6">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-[#5661d8]">
                  <BookmarkCheck size={16} />
                  Saved roles
                </p>
                <p className="mt-1 text-sm text-[#7a828f]">{tracked.length} roles in your tracker.</p>
              </div>
            </div>
            <Stagger className="divide-y divide-black/[0.06]">
              {tracked.map((job, index) => (
                <StaggerItem key={job.id}>
                  <TrackerRow
                    job={job}
                    rank={index + 1}
                    status={savedJobs[job.id] ?? "saved"}
                    onStatusChange={(status) => setJobStatus(job.id, status)}
                    onRemove={() => removeSavedJob(job.id)}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          </Card>
        </Reveal>
      )}
    </div>
  );
}

function TrackerRow({
  job,
  rank,
  status,
  onStatusChange,
  onRemove
}: Readonly<{
  job: Job;
  rank: number;
  status: SavedStatus;
  onStatusChange: (status: SavedStatus) => void;
  onRemove: () => void;
}>) {
  return (
    <div className="-mx-3 grid gap-4 rounded-[24px] px-3 py-5 transition hover:bg-white/55 lg:grid-cols-[56px_1fr_150px_auto] lg:items-center">
      <div className="relative h-12 w-12">
        <CompanyLogo company={job.company} />
        <span className="absolute -bottom-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full border border-white bg-[#f1f3ff] px-1 text-[10px] font-semibold text-[#5661d8] shadow-sm">
          {rank}
        </span>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#8c94a3]">
          <span className="font-medium text-[#5f6877]">{job.company}</span>
          <span>·</span>
          <span>{job.location}</span>
          <span>·</span>
          <span>{job.workType}</span>
          <span>·</span>
          <span>{formatDate(job.postedDate)}</span>
        </div>
        <Link href={`/jobs/${job.id}`} className="mt-1 block text-lg font-semibold tracking-[-0.02em] text-[#171b24] transition hover:text-[#5661d8]">
          {job.title}
        </Link>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#687180]">
          {job.skills.length ? `Focus areas: ${job.skills.slice(0, 4).join(", ")}` : "Saved from your radar for follow-up."}
        </p>
      </div>

      <div className="flex items-center lg:justify-end">
        <label className="relative block">
          <span className="sr-only">Application status</span>
          <select
            value={status}
            onChange={(event) => onStatusChange(event.target.value as SavedStatus)}
            className={cn(
              "h-11 w-full min-w-36 appearance-none rounded-full border px-4 pr-9 text-sm font-medium capitalize shadow-sm outline-none transition focus:ring-4 focus:ring-[#bdc5ff]/20",
              getStatusTone(status)
            )}
          >
            {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2 sm:justify-end">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/jobs/${job.id}`}>
            Details
            <ExternalLink size={14} />
          </Link>
        </Button>
        <Button variant="outline" size="icon" aria-label="Remove saved job" onClick={onRemove}>
          <Trash2 size={15} />
        </Button>
      </div>
    </div>
  );
}

function CompanyLogo({ company }: Readonly<{ company: string }>) {
  const [logoIndex, setLogoIndex] = useState(0);
  const logoUrls = getCompanyLogoUrls(company);
  const logoUrl = logoUrls[logoIndex];
  const initials = getCompanyInitials(company);

  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_10px_30px_rgba(20,25,34,0.08)]">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`${company} logo`}
          className="h-full w-full object-contain p-2"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setLogoIndex((index) => index + 1)}
        />
      ) : (
        <span className="text-sm font-semibold text-[#5661d8]">{initials}</span>
      )}
    </div>
  );
}

function TrackerMetric({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-black/[0.06] pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-[#687180]">{label}</span>
      <span className="text-right text-sm font-semibold text-[#171b24]">{value}</span>
    </div>
  );
}

function countByStatus(savedJobs: Record<string, string>, status: SavedStatus) {
  return Object.values(savedJobs).filter((item) => item === status).length;
}

function getStatusTone(status: SavedStatus) {
  if (status === "offer") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "interview") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "applied") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-black/[0.07] bg-white/85 text-[#171b24]";
}
