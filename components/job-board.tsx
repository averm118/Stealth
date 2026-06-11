"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, ChevronDown, ExternalLink, Link2, Search, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useAppState } from "@/components/app-state";
import { CompanyLogo } from "@/components/company-logo";
import { ImportJobUrlPanel } from "@/components/import-job-url/import-job-url-panel";
import { Reveal, Stagger, StaggerItem } from "@/components/motion-primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  buildRadarMatches,
  buildRadarRoleLanes,
  buildResumeRadarLane,
  getMinimumLaneTarget,
  getRadarDirectionLabel,
  getRadarRoleDirections,
  getRoleLaneCounts,
  isBelowLaneTarget,
  type RadarMatch,
  type RadarRoleLane
} from "@/lib/radar-matching";
import { getDisplayJobLocation } from "@/lib/job-location";
import { cn, formatDate } from "@/lib/utils";
import type { Job, LookingFor } from "@/lib/types";

type CatalogMetadata = {
  count: number;
  lastImportedAt: string | null;
};

type ViewFilter = "all" | "remote" | "hybrid" | "onsite" | "sponsor-friendly" | "fresh-week" | "fresh-month";

const viewFilterOptions: Array<{ label: string; value: ViewFilter }> = [
  { label: "Best available", value: "all" },
  { label: "Remote only", value: "remote" },
  { label: "Hybrid only", value: "hybrid" },
  { label: "On-site only", value: "onsite" },
  { label: "Sponsor-friendly", value: "sponsor-friendly" },
  { label: "Fresh this week", value: "fresh-week" },
  { label: "Fresh this month", value: "fresh-month" }
];

export function JobBoard({ jobs, metadata }: Readonly<{ jobs: Job[]; metadata: CatalogMetadata }>) {
  const router = useRouter();
  const { profile, savedJobs, setJobStatus } = useAppState();
  const [query, setQuery] = useState("");
  const [selectedLaneId, setSelectedLaneId] = useState("resume-fit");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [importPanelOpen, setImportPanelOpen] = useState(false);

  const roleDirections = useMemo(() => getRadarRoleDirections(profile), [profile]);
  const activeDirectionLabel = useMemo(() => getRadarDirectionLabel(profile), [profile]);
  const lanes = useMemo(() => buildRadarRoleLanes(roleDirections), [roleDirections]);
  const resumeLane = useMemo(() => buildResumeRadarLane(roleDirections), [roleDirections]);
  const activeLane =
    selectedLaneId === "all"
      ? null
      : selectedLaneId === "resume-fit"
        ? resumeLane
        : lanes.find((lane) => lane.id === selectedLaneId) ?? resumeLane;
  const activeLaneMode = selectedLaneId === "resume-fit" ? "resume-fit" : selectedLaneId === "all" ? "all" : "role-lane";
  const roleLaneCounts = useMemo(() => getRoleLaneCounts(jobs, profile, lanes, query, viewFilter), [jobs, lanes, profile, query, viewFilter]);
  const roleFilterOptions = useMemo(
    () => [
      { label: `Resume fit: ${resumeLane.label}`, value: "resume-fit" },
      ...lanes.map((lane) => ({ label: `${lane.label} ${roleLaneCounts[lane.id] ?? 0}`, value: lane.id })),
      { label: "All roles", value: "all" }
    ],
    [lanes, resumeLane.label, roleLaneCounts]
  );

  const matches = useMemo(
    () =>
      buildRadarMatches({
        jobs,
        profile,
        lane: activeLane,
        laneMode: activeLaneMode,
        query,
        viewFilter
      }),
    [activeLane, activeLaneMode, jobs, profile, query, viewFilter]
  );

  const sponsorFriendlyCount = matches.filter(({ job }) => job.sponsorshipFriendly === "high" || job.sponsorshipFriendly === "medium").length;
  const filtersActive = Boolean(query || selectedLaneId !== "resume-fit" || viewFilter !== "all");
  const activeLaneLabel = selectedLaneId === "resume-fit" ? resumeLane.label : activeLane?.label ?? activeDirectionLabel;
  const belowTarget = isBelowLaneTarget(matches.length);

  return (
    <section className="space-y-5">
      <Reveal>
        <Card className="overflow-hidden p-0">
          <div className="grid gap-0 lg:grid-cols-[1fr_360px]">
            <div className="p-7 sm:p-8">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className="text-sm font-medium text-[#5661d8]">Resume radar</p>
                  <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-[#171b24]">
                    Matched openings from your profile.
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687180]">
                    Ranked by role direction, degree fit, search type, sponsorship preference, and freshness, with generic skill noise kept out of the top results.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <StatusPill label={`Matched to ${activeLaneLabel}`} />
                    <StatusPill label={profile.lookingFor} />
                    <StatusPill label={`${matches.length} aligned openings`} />
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t border-black/[0.06] bg-white/55 p-7 lg:border-l lg:border-t-0">
              <p className="text-sm font-medium text-[#171b24]">Radar health</p>
              <div className="mt-5 space-y-4">
                <FocusLine label="Visible matches" value={matches.length} />
                <FocusLine label="Lane target" value={`${getMinimumLaneTarget()}+`} />
                <FocusLine label="Sponsor-aware" value={sponsorFriendlyCount} />
                <FocusLine label="Last refresh" value={metadata.lastImportedAt ? formatDate(metadata.lastImportedAt) : "Recently updated"} />
              </div>
            </div>
          </div>
        </Card>
      </Reveal>

      <Reveal>
        <Card className="p-3 sm:p-4">
          <div className="grid gap-3 xl:grid-cols-[1fr_280px_230px] xl:items-end">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9aa1ad]" size={17} />
              <Input
                className="h-12 border-transparent bg-white/85 pl-10 shadow-[0_10px_30px_rgba(20,25,34,0.06)]"
                placeholder="Search company, role, or location"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <FilterSelect label="Role focus" value={selectedLaneId} onChange={setSelectedLaneId} options={roleFilterOptions} />
            <FilterSelect label="View" value={viewFilter} onChange={setViewFilter} options={viewFilterOptions} />
          </div>
        </Card>
      </Reveal>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.34fr]">
        <TopMatchesPanel
          matches={matches}
          savedJobs={savedJobs}
          filtersActive={filtersActive}
          lookingFor={profile.lookingFor}
          belowTarget={belowTarget}
          activeLaneLabel={activeLaneLabel}
          onSave={(jobId) => setJobStatus(jobId, "saved")}
        />

        <Reveal delay={0.1}>
          <aside className="sticky top-28 space-y-4 self-start">
            <Card className="p-6">
              <p className="flex items-center gap-2 text-sm font-medium text-[#171b24]">
                <ShieldCheck size={16} className="text-[#5661d8]" />
                Radar brief
              </p>
              <div className="mt-5 space-y-3">
                <FocusLine label="Profile direction" value={activeLaneLabel} />
                <FocusLine label="Search type" value={profile.lookingFor} />
                <FocusLine label="Ranking" value="Resume aligned" />
              </div>
              <p className="mt-5 text-sm leading-6 text-[#687180]">
                This view uses role, degree, search type, and sponsorship signals. Open Details for the deeper compatibility brief.
              </p>
            </Card>
            <Card className="p-6">
              <p className="flex items-center gap-2 text-sm font-medium text-[#171b24]">
                <Link2 size={16} className="text-[#5661d8]" />
                Can&apos;t find what you&apos;re looking for?
              </p>
              <p className="mt-3 text-sm leading-6 text-[#687180]">
                Import any job into Stealth to get compatibility ratings along with a tailored resume and cover letter.
              </p>
              <Button className="mt-5 h-11 w-full justify-center px-5" onClick={() => setImportPanelOpen(true)}>
                <Link2 size={16} />
                Import job URL
              </Button>
            </Card>
          </aside>
        </Reveal>
      </div>

      <ImportJobUrlPanel
        open={importPanelOpen}
        onClose={() => setImportPanelOpen(false)}
        onImported={() => router.refresh()}
      />
    </section>
  );
}

function TopMatchesPanel({
  matches,
  savedJobs,
  filtersActive,
  lookingFor,
  belowTarget,
  activeLaneLabel,
  onSave
}: Readonly<{
  matches: RadarMatch[];
  savedJobs: Record<string, string>;
  filtersActive: boolean;
  lookingFor: LookingFor;
  belowTarget: boolean;
  activeLaneLabel: string;
  onSave: (jobId: string) => void;
}>) {
  return (
    <Reveal>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-black/[0.06] bg-white/45 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-[#5661d8]">
              <Sparkles size={16} />
              Top matches
            </p>
            <p className="mt-1 text-sm text-[#7a828f]">
              {belowTarget
                ? `${matches.length} ${activeLaneLabel.toLowerCase()} matches found. New openings will keep expanding this lane.`
                : `${matches.length} role-aligned openings found.`}
            </p>
          </div>
          {matches.length > 0 ? (
            <span className="rounded-full border border-black/[0.06] bg-white px-3 py-1 text-xs font-medium text-[#687180] shadow-sm">{matches.length} visible</span>
          ) : null}
        </div>

        {matches.length ? (
          <Stagger className="space-y-3 px-4 py-4 sm:px-5 sm:py-5">
            {matches.map((match, index) => (
              <StaggerItem key={match.job.id}>
                <JobListRow match={match} rank={index + 1} saved={Boolean(savedJobs[match.job.id])} onSave={() => onSave(match.job.id)} />
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <p className="m-5 rounded-[22px] border border-black/[0.06] bg-[#fbfbfd] p-5 text-sm leading-6 text-[#7a828f]">
            {getEmptyText(filtersActive, lookingFor)}
          </p>
        )}
      </Card>
    </Reveal>
  );
}

function JobListRow({
  match,
  rank,
  saved,
  onSave
}: Readonly<{
  match: RadarMatch;
  rank: number;
  saved: boolean;
  onSave: () => void;
}>) {
  const { job } = match;
  const metadataParts = [
    job.company,
    getDisplayJobLocation(job.location, job.workType),
    job.workType,
    formatDate(job.postedDate)
  ].filter(Boolean);

  return (
    <motion.div
      className="group grid gap-4 rounded-[24px] border border-black/[0.055] bg-white/62 p-4 shadow-[0_16px_42px_rgba(20,25,34,0.055)] transition hover:border-[#cfd6ff] hover:bg-white/88 hover:shadow-[0_22px_58px_rgba(20,25,34,0.09)] sm:p-5 lg:grid-cols-[72px_minmax(0,1fr)_150px_auto] lg:items-center"
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
    >
      <div className="relative h-16 w-16">
        <CompanyLogo company={job.company} className="h-16 w-16 rounded-[22px]" />
        <span className="absolute -bottom-1.5 -right-1.5 grid h-6 min-w-6 place-items-center rounded-full border-2 border-white bg-[#eef2ff] px-1 text-[11px] font-semibold text-[#5661d8] shadow-[0_8px_18px_rgba(20,25,34,0.12)]">
          {rank}
        </span>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-[#8c94a3]">
          {metadataParts.map((part, index) => (
            <span key={`${part}-${index}`} className={index === 0 ? "text-[#4d5665]" : undefined}>
              {index > 0 ? <span className="mr-2 text-[#c5cad4]">/</span> : null}
              {part}
            </span>
          ))}
        </div>
        <Link href={`/jobs/${job.id}`} className="mt-1.5 block text-xl font-semibold tracking-[-0.03em] text-[#171b24] transition hover:text-[#5661d8]">
          {job.title}
        </Link>
        <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-[#687180]">{match.reasons[0]}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {match.badges.map((badge) => (
            <span key={badge} className="rounded-full border border-[#e4e8f4] bg-[#fbfcff] px-2.5 py-1 text-xs font-medium text-[#687180] shadow-sm">
              {badge}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center lg:justify-end">
        <span className={cn("rounded-full border px-3.5 py-2 text-xs font-semibold shadow-sm", getMatchLevelTone(match.matchLevel))}>
          {formatMatchLevel(match.matchLevel)}
        </span>
      </div>

      <div className="flex items-center gap-2 sm:justify-end lg:min-w-[144px]">
        <Button asChild variant="secondary" size="sm" className="h-10 px-4 shadow-[0_12px_28px_rgba(20,25,34,0.08)]">
          <Link href={`/jobs/${job.id}`}>
            Details
            <ExternalLink size={14} />
          </Link>
        </Button>
        <Button
          variant={saved ? "default" : "outline"}
          size="icon"
          aria-label={saved ? "Job saved" : "Save job"}
          className="h-10 w-10 bg-white/80"
          onClick={onSave}
        >
          <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
        </Button>
      </div>
    </motion.div>
  );
}

function StatusPill({ label }: Readonly<{ label: string }>) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#dfe3ff] bg-white/70 px-3 py-1 text-xs font-medium text-[#5661d8] shadow-sm">
      {label}
    </span>
  );
}

function getMatchLevelTone(level: RadarMatch["matchLevel"]) {
  if (level === "strong") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (level === "good") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  return "border-slate-200 bg-white text-[#687180]";
}

function formatMatchLevel(level: RadarMatch["matchLevel"]) {
  if (level === "strong") return "Strong match";
  if (level === "good") return "Good match";
  return "Backup";
}

function getEmptyText(filtersActive: boolean, lookingFor: LookingFor) {
  if (filtersActive) return "No openings match these filters. Clear one filter or choose a broader role lane.";
  if (lookingFor === "Internship") return "No internship postings match this resume lane yet. Import a job URL or check back soon.";
  if (lookingFor === "Part-time job") return "No part-time postings match this resume lane yet. Import a job URL or choose a broader search type.";
  return "No role-aligned openings are available yet. Import a job URL or check back after the next refresh.";
}

function FilterSelect<T extends string>({ label, value, onChange, options }: Readonly<{ label: string; value: T; onChange: (value: T) => void; options: { label: string; value: T }[] }>) {
  return (
    <label className="relative block">
      <span className="mb-1.5 ml-3 block text-[11px] font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-12 w-full appearance-none rounded-full border border-black/[0.07] bg-white/85 px-4 pr-10 text-sm font-medium text-[#171b24] shadow-[0_10px_30px_rgba(20,25,34,0.06)] outline-none transition hover:bg-white focus:border-[#bdc5ff] focus:ring-4 focus:ring-[#bdc5ff]/20"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute bottom-4 right-4 text-[#8a92a0]" />
    </label>
  );
}

function FocusLine({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-black/[0.06] pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-[#687180]">{label}</span>
      <span className="text-right text-sm font-semibold text-[#171b24]">{value}</span>
    </div>
  );
}
