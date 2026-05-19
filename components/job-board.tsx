"use client";

import Link from "next/link";
import { Bookmark, CheckCircle2, Clock3, ExternalLink, Filter, Search, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useAppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Reveal, Stagger, StaggerItem } from "@/components/motion-primitives";
import { scoreJob } from "@/lib/scoring";
import {
  getJobAlignmentForDirections,
  getProfileRoleDirectionLabel,
  getProfileRoleDirections,
  getRoleCategory,
  type RoleCategoryId,
  type RoleDirection
} from "@/lib/role-taxonomy";
import { cn, formatDate } from "@/lib/utils";
import type { Job, LookingFor, MatchResult, SponsorshipFriendliness, WorkType } from "@/lib/types";

type ScoredJob = {
  job: Job;
  match: MatchResult;
  roleAffinity: number;
  roleTier: "core" | "adjacent" | "weak" | "unrelated";
  recencyScore: number;
};

type CatalogMetadata = {
  count: number;
  lastImportedAt: string | null;
};

type RoleLane = {
  id: string;
  label: string;
  categoryIds: RoleCategoryId[];
};

const fallbackLanes: RoleLane[] = [
  { id: "supply-chain", label: "Supply Chain", categoryIds: ["supply-chain"] },
  { id: "operations", label: "Operations", categoryIds: ["operations"] },
  { id: "data", label: "Data Analyst", categoryIds: ["data"] },
  { id: "business", label: "Business Analyst", categoryIds: ["business"] },
  { id: "product", label: "Product", categoryIds: ["product"] },
  { id: "software", label: "Software Engineering", categoryIds: ["software"] }
];

const workTypeOptions: Array<"all" | WorkType> = ["all", "Remote", "Hybrid", "On-site"];
const sponsorshipOptions: Array<"all" | SponsorshipFriendliness> = ["all", "high", "medium", "low", "unknown"];
const recencyOptions = [
  { label: "Any time", value: "all" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 7 days", value: "7" }
];

export function JobBoard({ jobs, metadata }: Readonly<{ jobs: Job[]; metadata: CatalogMetadata }>) {
  const { profile, savedJobs, setJobStatus } = useAppState();
  const [query, setQuery] = useState("");
  const [selectedLaneId, setSelectedLaneId] = useState("resume-fit");
  const [workType, setWorkType] = useState<(typeof workTypeOptions)[number]>("all");
  const [sponsorship, setSponsorship] = useState<(typeof sponsorshipOptions)[number]>("all");
  const [recency, setRecency] = useState("all");

  const roleDirections = useMemo(() => getProfileRoleDirections(profile), [profile]);
  const activeDirectionLabel = useMemo(() => getProfileRoleDirectionLabel(profile), [profile]);
  const lanes = useMemo(() => buildRoleLanes(roleDirections), [roleDirections]);
  const resumeLane = useMemo(() => buildResumeLane(roleDirections), [roleDirections]);
  const candidateJobs = useMemo(() => jobs.filter((job) => matchesLookingFor(job, profile.lookingFor)), [jobs, profile.lookingFor]);
  const activeLane =
    selectedLaneId === "all"
      ? null
      : selectedLaneId === "resume-fit"
        ? resumeLane
        : lanes.find((lane) => lane.id === selectedLaneId) ?? resumeLane;
  const activeLaneMode = selectedLaneId === "resume-fit" ? "resume-fit" : selectedLaneId === "all" ? "all" : "role-lane";

  const scoredJobs = useMemo(() => {
    return candidateJobs
      .map((job) => {
        const alignment = getRoleAlignmentForLane(job, activeLane, roleDirections);
        return {
          job,
          match: scoreJob(job, profile),
          roleAffinity: getRoleAffinity(alignment),
          roleTier: alignment.tier,
          recencyScore: getRecencyScore(job.postedDate)
        };
      })
      .filter((item) => shouldShowJobForLane(item.job, item.roleTier, activeLane, activeLaneMode))
      .filter(({ job }) => workType === "all" || job.workType === workType)
      .filter(({ job }) => sponsorship === "all" || job.sponsorshipFriendly === sponsorship)
      .filter(({ job }) => matchesRecency(job.postedDate, recency))
      .filter(({ job }) => matchesQuery(job, query))
      .sort((a, b) => getTierRank(b.roleTier) - getTierRank(a.roleTier) || b.roleAffinity - a.roleAffinity || b.match.score - a.match.score || b.recencyScore - a.recencyScore);
  }, [activeLane, activeLaneMode, candidateJobs, profile, query, recency, roleDirections, sponsorship, workType]);

  const applyNow = scoredJobs.filter(({ match, roleTier }) => match.score >= 78 && (roleTier === "core" || roleTier === "adjacent")).slice(0, 12);
  const strongMatches = scoredJobs
    .filter(({ job }) => !applyNow.some((item) => item.job.id === job.id))
    .filter(({ match, roleTier }) => match.score >= 62 && (roleTier === "core" || roleTier === "adjacent"))
    .slice(0, 18);
  const exploreNext = scoredJobs
    .filter(({ job }) => !applyNow.some((item) => item.job.id === job.id) && !strongMatches.some((item) => item.job.id === job.id))
    .slice(0, 24);
  const sponsorFriendlyCount = scoredJobs.filter(({ job }) => job.sponsorshipFriendly === "high" || job.sponsorshipFriendly === "medium").length;
  const filtersActive = Boolean(query || selectedLaneId !== "resume-fit" || workType !== "all" || sponsorship !== "all" || recency !== "all");

  return (
    <section className="space-y-5">
      <Reveal>
        <Card className="p-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium text-[#5661d8]">Personal radar</p>
              <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-[#171b24]">
                Roles your resume points toward.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687180]">
                Public postings grouped by your extracted target roles, then ranked by fit, sponsorship, competition, and recency.
              </p>
              <div className="mt-4 inline-flex rounded-full border border-[#dfe3ff] bg-white/70 px-3 py-1 text-xs font-medium text-[#5661d8] shadow-sm">
                Matched to: {selectedLaneId === "resume-fit" ? resumeLane.label : activeLane?.label ?? activeDirectionLabel}
              </div>
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-3 lg:min-w-[420px]">
            <Metric label={profile.lookingFor} value={candidateJobs.length} />
            <Metric label="Resume matches" value={scoredJobs.length} />
            <Metric label="Sponsor-aware" value={sponsorFriendlyCount} />
            </div>
          </div>
        </Card>
      </Reveal>

      <Reveal>
        <Card className="p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9aa1ad]" size={17} />
              <Input className="pl-10" placeholder="Search company, role, skill, or location" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <FilterSelect label="Work type" value={workType} onChange={setWorkType} options={workTypeOptions.map((value) => ({ label: value === "all" ? "Any work type" : value, value }))} />
            <FilterSelect label="Sponsorship" value={sponsorship} onChange={setSponsorship} options={sponsorshipOptions.map((value) => ({ label: value === "all" ? "Any sponsorship" : `${value} sponsorship`, value }))} />
            <FilterSelect label="Posted" value={recency} onChange={setRecency} options={recencyOptions} />
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            <LaneButton
              active={selectedLaneId === "resume-fit"}
              label="Resume fit"
              count={candidateJobs.filter((job) => getRoleAffinity(getRoleAlignmentForLane(job, resumeLane, roleDirections)) > 0).length}
              onClick={() => setSelectedLaneId("resume-fit")}
            />
            {lanes.map((lane) => {
              const count = candidateJobs.filter((job) => getRoleAffinity(getRoleAlignmentForLane(job, lane, roleDirections)) > 0).length;
              return <LaneButton key={lane.id} active={selectedLaneId === lane.id} label={lane.label} count={count} onClick={() => setSelectedLaneId(lane.id)} />;
            })}
            <LaneButton active={selectedLaneId === "all"} label="All jobs" count={candidateJobs.length} onClick={() => setSelectedLaneId("all")} />
          </div>
        </Card>
      </Reveal>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.36fr]">
        <div className="space-y-5">
          <RadarSection icon={Sparkles} title="Apply now" description="Best role alignment with enough resume evidence to prioritize." jobs={applyNow} savedJobs={savedJobs} onSave={setJobStatus} emptyText={getEmptyText(filtersActive, "No urgent matches in this lane yet.", profile.lookingFor)} />
          <RadarSection icon={CheckCircle2} title="Strong matches" description="Good options to queue after the top applications." jobs={strongMatches} savedJobs={savedJobs} onSave={setJobStatus} emptyText={getEmptyText(filtersActive, "No strong backup matches in this lane yet.", profile.lookingFor)} />
          <RadarSection icon={Clock3} title="Explore next" description="Adjacent roles, stretch matches, and broader opportunities." jobs={exploreNext} savedJobs={savedJobs} onSave={setJobStatus} emptyText={getEmptyText(filtersActive, "No exploratory matches in this view.", profile.lookingFor)} />
        </div>

        <Reveal delay={0.1}>
          <aside className="sticky top-28 space-y-4 self-start">
            <Card className="p-6">
              <p className="text-sm font-medium text-[#171b24]">Radar health</p>
              <div className="mt-5 space-y-4">
                <FocusLine label={selectedLaneId === "all" ? "Visible jobs" : "Resume matches"} value={scoredJobs.length} />
                <FocusLine label="Looking for" value={profile.lookingFor} />
                <FocusLine label="Saved roles" value={Object.keys(savedJobs).length} />
                <FocusLine label="Last refresh" value={metadata.lastImportedAt ? formatDate(metadata.lastImportedAt) : "Local fallback"} />
              </div>
            </Card>
            <Card className="p-6">
              <p className="flex items-center gap-2 text-sm font-medium text-[#171b24]">
                <ShieldCheck size={16} className="text-[#5661d8]" />
                Recommendation
              </p>
              <p className="mt-3 text-sm leading-6 text-[#687180]">
                Start with one role lane, save 8-12 strong roles, then use each job detail page for deeper AI compatibility.
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
          <span className="rounded-full border border-black/[0.06] bg-white px-3 py-1 text-xs text-[#687180] shadow-sm">{jobs.length}</span>
        </div>

        {jobs.length ? (
          <Stagger className="divide-y divide-black/[0.06]">
            {jobs.map(({ job, match }, index) => (
              <StaggerItem key={job.id}>
                <JobListRow job={job} match={match} rank={index + 1} saved={Boolean(savedJobs[job.id])} onSave={() => onSave(job.id, "saved")} />
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

function JobListRow({ job, match, rank, saved, onSave }: Readonly<{ job: Job; match: MatchResult; rank: number; saved: boolean; onSave: () => void }>) {
  const topReason = match.why[0]?.replace(/\.$/, "");

  return (
    <motion.div className="group grid gap-4 py-4 sm:grid-cols-[44px_1fr_auto] sm:items-center" whileHover={{ x: 4 }} transition={{ type: "spring", stiffness: 320, damping: 28 }}>
      <div className="flex items-center gap-3 sm:block">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f2f4fb] text-sm font-semibold text-[#5661d8]">{rank}</span>
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

function buildRoleLanes(roleDirections: RoleDirection[]) {
  const matched = roleDirections
    .map(({ category }) => fallbackLanes.find((lane) => lane.id === category.id))
    .filter((lane): lane is RoleLane => Boolean(lane));
  const unique = Array.from(new Map(matched.map((lane) => [lane.id, lane])).values());
  return unique.length ? unique.concat(fallbackLanes.filter((lane) => !unique.some((item) => item.id === lane.id)).slice(0, 3)) : fallbackLanes;
}

function buildResumeLane(roleDirections: RoleDirection[]): RoleLane {
  const primary = roleDirections[0]?.category ?? getRoleCategory("data");
  const companionCategories: RoleCategoryId[] =
    primary.id === "supply-chain"
      ? ["operations"]
      : primary.id === "operations"
        ? ["supply-chain"]
        : [];
  const categoryIds = [...new Set<RoleCategoryId>([primary.id, ...companionCategories])];

  return {
    id: "resume-fit",
    label: categoryIds.map((id) => getRoleCategory(id).label).join(" / "),
    categoryIds
  };
}

function getRoleAlignmentForLane(job: Job, lane: RoleLane | null, roleDirections: RoleDirection[]) {
  if (!lane) return getJobAlignmentForDirections(job, roleDirections);
  const laneDirections = lane.categoryIds.map((id, index) => ({
    category: getRoleCategory(id),
    score: 100 - index
  }));

  return getJobAlignmentForDirections(job, laneDirections);
}

function getRoleAffinity(alignment: ReturnType<typeof getJobAlignmentForDirections>) {
  if (alignment.tier === "core") return 100 + alignment.score;
  if (alignment.tier === "adjacent") return 60 + alignment.score;
  if (alignment.tier === "weak") return 20 + alignment.score;
  return 0;
}

function shouldShowJobForLane(
  job: Job,
  roleTier: ScoredJob["roleTier"],
  lane: RoleLane | null,
  laneMode: "resume-fit" | "role-lane" | "all"
) {
  if (!lane) return true;
  if (roleTier === "unrelated") return false;
  if (laneMode !== "resume-fit") return roleTier !== "weak";
  if (roleTier === "weak") return false;

  if (lane.categoryIds.includes("supply-chain")) {
    const jobText = `${job.title} ${job.description} ${job.skills.join(" ")}`.toLowerCase();
    const hasSupplyOrOpsContext = /\b(supply chain|procurement|logistics|inventory|demand planning|forecasting|supplier|sourcing|purchasing|warehouse|distribution|operations|operational|fulfillment|planning)\b/i.test(jobText);
    const isPureTechRole = /\b(software engineer|software engineering|backend|frontend|full stack|machine learning|data scientist|ai engineer|phd|new grad)\b/i.test(job.title);

    if (isPureTechRole && !hasSupplyOrOpsContext) return false;
    return hasSupplyOrOpsContext || roleTier === "core";
  }

  return true;
}

function getTierRank(tier: ScoredJob["roleTier"]) {
  return {
    core: 4,
    adjacent: 3,
    weak: 2,
    unrelated: 1
  }[tier];
}

function getRecencyScore(postedDate: string) {
  const timestamp = new Date(postedDate).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, 100 - Math.floor((Date.now() - timestamp) / 86_400_000));
}

function matchesRecency(postedDate: string, recency: string) {
  if (recency === "all") return true;
  const days = Number(recency);
  const timestamp = new Date(postedDate).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= days * 86_400_000;
}

function matchesQuery(job: Job, query: string) {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return true;
  return `${job.company} ${job.title} ${job.location} ${job.skills.join(" ")} ${job.description}`.toLowerCase().includes(normalizedQuery);
}

function matchesLookingFor(job: Job, lookingFor: LookingFor) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  const hasInternshipSignal = /\b(intern|internship|co-?op|co op|student program|summer\s+20\d{2}|fall\s+20\d{2}|spring\s+20\d{2})\b/i.test(text);
  const hasPartTimeSignal = /\b(part[- ]time|temporary|seasonal|contract)\b/i.test(text);

  if (lookingFor === "Internship") return hasInternshipSignal;
  if (lookingFor === "Part-time job") return hasPartTimeSignal && !hasInternshipSignal;
  return !hasInternshipSignal && !hasPartTimeSignal;
}

function getEmptyText(filtersActive: boolean, fallback: string, lookingFor: LookingFor) {
  if (filtersActive) return "No roles match these filters. Clear one filter or choose a broader role lane.";
  if (lookingFor === "Internship") return "No internship postings match this resume lane yet. Try another lane or ingest more internship boards.";
  if (lookingFor === "Part-time job") return "No part-time postings match this resume lane yet. Try another lane or broaden the search type.";
  return fallback;
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-[22px] border border-black/[0.06] bg-white/70 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#9aa1ad]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#171b24]">{value}</p>
    </div>
  );
}

function LaneButton({ active, label, count, onClick }: Readonly<{ active: boolean; label: string; count: number; onClick: () => void }>) {
  return (
    <button type="button" onClick={onClick} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm transition", active ? "border-[#c8ceff] bg-[#f0f2ff] text-[#5661d8] shadow-sm" : "border-black/[0.06] bg-white/65 text-[#687180] hover:bg-white hover:text-[#171b24]")}>
      {label}
      <span className="ml-2 text-xs opacity-70">{count}</span>
    </button>
  );
}

function FilterSelect<T extends string>({ label, value, onChange, options }: Readonly<{ label: string; value: T; onChange: (value: T) => void; options: { label: string; value: T }[] }>) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)} className="h-11 w-full min-w-40 appearance-none rounded-full border border-black/[0.08] bg-white px-4 pr-9 text-sm font-medium text-[#171b24] shadow-sm outline-none transition hover:bg-[#fbfbfd] focus:border-[#bdc5ff] focus:ring-2 focus:ring-[#bdc5ff]/40">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <Filter size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#8a92a0]" />
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
