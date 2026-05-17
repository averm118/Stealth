"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { ArrowLeft, Bookmark, Check, ExternalLink, MapPin, Sparkles } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Reveal, Stagger, StaggerItem } from "@/components/motion-primitives";
import { jobs } from "@/data/jobs";
import { scoreJob } from "@/lib/scoring";
import type { SavedStatus } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

const statuses: SavedStatus[] = ["saved", "applied", "interview", "rejected", "offer"];

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const job = jobs.find((item) => item.id === params.id);
  const { profile, savedJobs, setJobStatus } = useAppState();
  if (!job) notFound();

  const match = scoreJob(job, profile);
  const currentStatus = savedJobs[job.id] ?? "saved";
  const fitLabel = match.score >= 82 ? "Apply now" : match.score >= 68 ? "Strong fit" : match.score >= 52 ? "Review carefully" : "Low fit";
  const missingSkills = match.missingSkills.length ? match.missingSkills.join(", ") : "No major gaps detected";
  const matchedSkills = match.matchedSkills.length ? match.matchedSkills.join(", ") : "No direct skill overlap yet";

  return (
    <div className="pb-24">
      <Reveal>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button asChild variant="ghost" className="w-fit">
            <Link href="/dashboard">
              <ArrowLeft size={16} />
              Back to radar
            </Link>
          </Button>
          <p className="text-sm text-[#8a92a0]">Opportunity brief</p>
        </div>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <div className="space-y-6">
          <Reveal>
            <Card className="p-8 md:p-10">
              <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-3">
                    <CompanyMark company={job.company} />
                    <div>
                      <p className="text-sm font-medium text-[#5661d8]">{job.company}</p>
                      <p className="mt-0.5 text-xs text-[#8a92a0]">Mock posting - demo data</p>
                    </div>
                  </div>
                  <h1 className="mt-6 text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-[#171b24] md:text-6xl">
                    {job.title}
                  </h1>
                  <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#687180]">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin size={15} />
                      {job.location}
                    </span>
                    <span>{job.workType}</span>
                    <span>Posted {formatDate(job.postedDate)}</span>
                  </div>
                </div>

                <div className="min-w-44">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">Fit score</p>
                  <div className="mt-2 flex items-end gap-2">
                    <span className="text-6xl font-semibold tracking-[-0.06em] text-[#171b24]">{match.score}</span>
                    <span className="pb-2 text-sm font-medium text-[#8a92a0]">/100</span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/[0.06]">
                    <div
                      className="h-full rounded-full bg-[#626eea]"
                      style={{ width: `${match.score}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm font-medium text-[#5661d8]">{fitLabel}</p>
                </div>
              </div>

              <div className="my-9 h-px bg-black/[0.06]" />

              <p className="max-w-3xl text-lg leading-8 text-[#5f6877]">{job.description}</p>

              <div className="mt-10 grid gap-5 sm:grid-cols-3">
                <BriefMetric label="Sponsorship" value={job.sponsorshipFriendly} />
                <BriefMetric label="Competition" value={job.competitionLevel} />
                <BriefMetric label="Status" value={currentStatus} />
              </div>

              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <a href={job.applyUrl} target="_blank" rel="noreferrer">
                    Apply
                    <ExternalLink size={16} />
                  </a>
                </Button>
                <Button variant="outline" size="lg" onClick={() => setJobStatus(job.id, "saved")}>
                  <Bookmark size={16} />
                  Save to tracker
                </Button>
              </div>
            </Card>
          </Reveal>

          <Reveal delay={0.08}>
            <Card className="p-8">
              <div className="flex items-center gap-2">
                <Sparkles size={17} className="text-[#5661d8]" />
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-[#171b24]">Application angle</h2>
              </div>
              <div className="mt-6 divide-y divide-black/[0.06]">
                <DetailRow label="Lead with" value={matchedSkills} />
                <DetailRow label="Mind the gap" value={missingSkills} positive={!match.missingSkills.length} />
                <DetailRow label="Resume keywords" value={match.suggestedKeywords.join(", ")} />
              </div>
            </Card>
          </Reveal>
        </div>

        <Stagger className="space-y-6 lg:sticky lg:top-32">
          <StaggerItem>
            <Card className="p-8">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#171b24]">Why it fits</h2>
              <div className="mt-6 space-y-5">
                {match.why.map((reason, index) => (
                  <ReasonLine key={reason} index={index + 1} text={reason} />
                ))}
              </div>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card className="p-8">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#171b24]">Tracker</h2>
                <span className="rounded-full border border-black/[0.06] bg-white px-3 py-1 text-xs font-medium capitalize text-[#687180] shadow-sm">
                  {currentStatus}
                </span>
              </div>
              <div className="mt-6 grid gap-2 sm:grid-cols-5 lg:grid-cols-2 xl:grid-cols-5">
                {statuses.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setJobStatus(job.id, status)}
                    className={cn(
                      "rounded-full border px-3 py-2 text-sm capitalize transition",
                      currentStatus === status
                        ? "border-[#c8ceff] bg-[#f0f2ff] text-[#5661d8] shadow-sm"
                        : "border-black/[0.06] bg-white/55 text-[#687180] hover:bg-white hover:text-[#171b24]"
                    )}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card className="p-8">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#171b24]">Role skills</h2>
              <div className="mt-5 flex flex-wrap gap-2">
                {job.skills.map((skill) => (
                  <span
                    key={skill}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm",
                      match.matchedSkills.includes(skill)
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-black/[0.06] bg-white/60 text-[#687180]"
                    )}
                  >
                    {match.matchedSkills.includes(skill) && <Check className="mr-1 inline" size={13} />}
                    {skill}
                  </span>
                ))}
              </div>
            </Card>
          </StaggerItem>
        </Stagger>
      </div>
    </div>
  );
}

function CompanyMark({ company }: Readonly<{ company: string }>) {
  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-black/[0.06] bg-white text-sm font-semibold text-[#5661d8] shadow-sm">
      {company.slice(0, 2).toUpperCase()}
    </div>
  );
}

function BriefMetric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="border-t border-black/[0.06] pt-4">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">{label}</p>
      <p className="mt-2 text-lg font-semibold capitalize text-[#171b24]">{value}</p>
    </div>
  );
}

function DetailRow({ label, value, positive = false }: Readonly<{ label: string; value: string; positive?: boolean }>) {
  return (
    <div className="grid gap-3 py-5 sm:grid-cols-[150px_1fr]">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">{label}</p>
      <p className={cn("text-sm leading-6 text-[#4d5665]", positive && "text-emerald-700")}>{value}</p>
    </div>
  );
}

function ReasonLine({ index, text }: Readonly<{ index: number; text: string }>) {
  return (
    <div className="grid grid-cols-[32px_1fr] gap-4">
      <span className="grid h-8 w-8 place-items-center rounded-full border border-black/[0.06] bg-white text-xs font-medium text-[#5661d8] shadow-sm">
        {index}
      </span>
      <p className="pt-1 text-sm leading-6 text-[#5f6877]">{text}</p>
    </div>
  );
}
