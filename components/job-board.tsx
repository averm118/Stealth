"use client";

import Link from "next/link";
import { Bookmark, CheckCircle2, Clock3, ExternalLink, Search, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useAppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Reveal, Stagger, StaggerItem } from "@/components/motion-primitives";
import { jobs } from "@/data/jobs";
import { scoreJob } from "@/lib/scoring";
import { formatDate } from "@/lib/utils";
import { Job, MatchResult } from "@/lib/types";

type ScoredJob = {
  job: Job;
  match: MatchResult;
};

export function JobBoard() {
  const { profile, savedJobs, setJobStatus } = useAppState();
  const [query, setQuery] = useState("");

  const scoredJobs = useMemo(() => {
    return jobs
      .map((job) => ({ job, match: scoreJob(job, profile) }))
      .sort((a, b) => b.match.score - a.match.score);
  }, [profile]);

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) return scoredJobs;

    return scoredJobs.filter(({ job }) => {
      const haystack = `${job.company} ${job.title} ${job.location} ${job.skills.join(" ")}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, scoredJobs]);

  const applyNow = filteredJobs.filter(({ match }) => match.score >= 80).slice(0, 5);
  const strongBackups = filteredJobs.filter(({ match }) => match.score >= 65 && match.score < 80).slice(0, 5);
  const watchList = filteredJobs.filter(({ match }) => match.score < 65).slice(0, 6);

  return (
    <section className="space-y-5">
      <Reveal>
        <Card className="p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium text-[#5661d8]">Personal radar</p>
              <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-[#171b24]">
                Your next applications.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687180]">
                Ranked by fit, sponsorship signal, competition, and your extracted profile.
              </p>
            </div>
            <div className="relative w-full lg:max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9aa1ad]" size={17} />
              <Input
                className="pl-10"
                placeholder="Search roles or companies"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
        </Card>
      </Reveal>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.42fr]">
        <div className="space-y-5">
          <RadarSection
            icon={Sparkles}
            title="Apply these right now"
            description="Highest fit and best profile alignment."
            jobs={applyNow}
            savedJobs={savedJobs}
            onSave={setJobStatus}
            emptyText="No urgent matches yet. Upload a stronger resume or broaden your profile."
          />
          <RadarSection
            icon={CheckCircle2}
            title="Strong backups"
            description="Good matches to queue after your top applications."
            jobs={strongBackups}
            savedJobs={savedJobs}
            onSave={setJobStatus}
            emptyText="No backup matches in this view."
          />
          <RadarSection
            icon={Clock3}
            title="Worth monitoring"
            description="Useful stretch roles or lower-confidence matches."
            jobs={watchList}
            savedJobs={savedJobs}
            onSave={setJobStatus}
            emptyText="Nothing to monitor right now."
          />
        </div>

        <Reveal delay={0.1}>
          <aside className="sticky top-28 space-y-4 self-start">
            <Card className="p-6">
              <p className="text-sm font-medium text-[#171b24]">Today’s focus</p>
              <div className="mt-5 space-y-4">
                <FocusLine label="Top applications" value={applyNow.length} />
                <FocusLine label="Sponsor-friendly" value={filteredJobs.filter(({ job }) => job.sponsorshipFriendly === "high").length} />
                <FocusLine label="Saved roles" value={Object.keys(savedJobs).length} />
              </div>
            </Card>
            <Card className="p-6">
              <p className="flex items-center gap-2 text-sm font-medium text-[#171b24]">
                <ShieldCheck size={16} className="text-[#5661d8]" />
                Recommendation
              </p>
              <p className="mt-3 text-sm leading-6 text-[#687180]">
                Apply to the first three roles, then tailor resume keywords using each job detail page.
              </p>
            </Card>
          </aside>
        </Reveal>
      </div>
    </section>
  );
}

function RadarSection({
  icon: Icon,
  title,
  description,
  jobs,
  savedJobs,
  onSave,
  emptyText
}: Readonly<{
  icon: React.ElementType;
  title: string;
  description: string;
  jobs: ScoredJob[];
  savedJobs: Record<string, string>;
  onSave: (jobId: string, status: "saved") => void;
  emptyText: string;
}>) {
  return (
    <Reveal>
      <Card className="p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-[#5661d8]">
              <Icon size={16} />
              {title}
            </p>
            <p className="mt-1 text-sm text-[#7a828f]">{description}</p>
          </div>
          <span className="rounded-full border border-black/[0.06] bg-white px-3 py-1 text-xs text-[#687180] shadow-sm">
            {jobs.length}
          </span>
        </div>

        {jobs.length ? (
          <Stagger className="divide-y divide-black/[0.06]">
            {jobs.map(({ job, match }, index) => (
              <StaggerItem key={job.id}>
                <JobListRow
                  job={job}
                  match={match}
                  rank={index + 1}
                  saved={Boolean(savedJobs[job.id])}
                  onSave={() => onSave(job.id, "saved")}
                />
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <p className="rounded-[22px] border border-black/[0.06] bg-[#fbfbfd] p-4 text-sm text-[#7a828f]">{emptyText}</p>
        )}
      </Card>
    </Reveal>
  );
}

function JobListRow({
  job,
  match,
  rank,
  saved,
  onSave
}: Readonly<{
  job: Job;
  match: MatchResult;
  rank: number;
  saved: boolean;
  onSave: () => void;
}>) {
  const topReason = match.why[0]?.replace(/\.$/, "");

  return (
    <motion.div
      className="group grid gap-4 py-4 sm:grid-cols-[44px_1fr_auto] sm:items-center"
      whileHover={{ x: 4 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
    >
      <div className="flex items-center gap-3 sm:block">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f2f4fb] text-sm font-semibold text-[#5661d8]">
          {rank}
        </span>
        <span className="sm:hidden text-sm font-semibold text-[#13956f]">{match.score}</span>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#8c94a3]">
          <span>{job.company}</span>
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
        <p className="mt-2 line-clamp-1 text-sm text-[#687180]">{topReason}</p>
      </div>

      <div className="flex items-center gap-2 sm:justify-end">
        <span className="hidden text-2xl font-semibold tracking-[-0.04em] text-[#13956f] sm:block">{match.score}</span>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/jobs/${job.id}`}>
            Details
            <ExternalLink size={14} />
          </Link>
        </Button>
        <Button variant={saved ? "default" : "outline"} size="icon" aria-label="Save job" onClick={onSave}>
          <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
        </Button>
      </div>
    </motion.div>
  );
}

function FocusLine({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="flex items-center justify-between border-b border-black/[0.06] pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-[#687180]">{label}</span>
      <span className="text-sm font-semibold text-[#171b24]">{value}</span>
    </div>
  );
}
