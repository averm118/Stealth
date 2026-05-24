"use client";

import Link from "next/link";
import { Bookmark, ChevronDown, ExternalLink, Loader2, RefreshCw, Search, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/components/app-state";
import { Reveal, Stagger, StaggerItem } from "@/components/motion-primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DASHBOARD_MATCH_VERSION } from "@/lib/ai-versions";
import { stableTextHash } from "@/lib/ai-text";
import { getCompanyInitials, getCompanyLogoUrls } from "@/lib/company-logos";
import {
  getJobAlignmentForDirections,
  getProfileRoleDirectionLabel,
  getProfileRoleDirections,
  getRoleCategory,
  type RoleCategoryId,
  type RoleDirection
} from "@/lib/role-taxonomy";
import { cn, formatDate } from "@/lib/utils";
import type { AiDashboardJobMatch, CandidateProfile, Job, LookingFor, SignalConfidence } from "@/lib/types";

type CatalogMetadata = {
  count: number;
  lastImportedAt: string | null;
};

type RoleLane = {
  id: string;
  label: string;
  categoryIds: RoleCategoryId[];
};

type FilteredJob = {
  job: Job;
  roleAffinity: number;
  roleTier: "core" | "adjacent" | "weak" | "unrelated";
  recencyScore: number;
};

type RankedJob = {
  job: Job;
  aiMatch: AiDashboardJobMatch;
};

const maxAiReviewJobs = 200;

const fallbackLanes: RoleLane[] = [
  { id: "supply-chain", label: "Supply Chain", categoryIds: ["supply-chain"] },
  { id: "operations", label: "Operations", categoryIds: ["operations"] },
  { id: "data", label: "Data Analyst", categoryIds: ["data"] },
  { id: "business", label: "Business Analyst", categoryIds: ["business"] },
  { id: "product", label: "Product", categoryIds: ["product"] },
  { id: "software", label: "Software Engineering", categoryIds: ["software"] }
];

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
  const { profile, savedJobs, setJobStatus } = useAppState();
  const [query, setQuery] = useState("");
  const [selectedLaneId, setSelectedLaneId] = useState("resume-fit");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [aiMatches, setAiMatches] = useState<AiDashboardJobMatch[]>([]);
  const [isAiRanking, setIsAiRanking] = useState(false);
  const [aiRankError, setAiRankError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);

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
  const roleFilterOptions = useMemo(
    () => [
      { label: `Resume fit: ${resumeLane.label}`, value: "resume-fit" },
      ...lanes.map((lane) => ({ label: lane.label, value: lane.id })),
      { label: "All roles", value: "all" }
    ],
    [lanes, resumeLane.label]
  );

  const filteredJobs = useMemo(() => {
    return candidateJobs
      .map((job) => {
        const alignment = getRoleAlignmentForLane(job, activeLane, roleDirections);
        return {
          job,
          roleAffinity: getRoleAffinity(alignment),
          roleTier: alignment.tier,
          recencyScore: getRecencyScore(job.postedDate)
        };
      })
      .filter((item) => shouldShowJobForLane(item.job, item.roleTier, activeLane, activeLaneMode))
      .filter(({ job }) => matchesViewFilter(job, viewFilter))
      .filter(({ job }) => matchesQuery(job, query))
      .sort((a, b) => b.recencyScore - a.recencyScore || b.roleAffinity - a.roleAffinity);
  }, [activeLane, activeLaneMode, candidateJobs, query, roleDirections, viewFilter]);

  const reviewJobs = useMemo(() => filteredJobs.slice(0, maxAiReviewJobs), [filteredJobs]);
  const reviewJobIds = useMemo(() => reviewJobs.map(({ job }) => job.id), [reviewJobs]);
  const reviewedJobMap = useMemo(() => new Map(reviewJobs.map(({ job }) => [job.id, job])), [reviewJobs]);
  const filteredJobSetHash = useMemo(() => stableTextHash(filteredJobs.map(({ job }) => job.id).join("|")), [filteredJobs]);
  const filterSignature = useMemo(
    () =>
      stableTextHash(
        JSON.stringify({
          selectedLaneId,
          activeLane: activeLane?.label ?? "all",
          query: query.trim().toLowerCase(),
          viewFilter
        })
      ),
    [activeLane?.label, query, selectedLaneId, viewFilter]
  );
  const aiCacheKey = useMemo(() => {
    if (!reviewJobIds.length) return "";
    return [
      "stealth.aiOnlyRadar",
      DASHBOARD_MATCH_VERSION,
      hashProfileForDashboard(profile),
      profile.lookingFor,
      filterSignature,
      filteredJobSetHash
    ].join(".");
  }, [filterSignature, filteredJobSetHash, profile, reviewJobIds.length]);

  useEffect(() => {
    if (!reviewJobIds.length || !aiCacheKey) {
      setAiMatches([]);
      setIsAiRanking(false);
      setAiRankError("");
      return;
    }

    const cached = readCachedDashboardMatches(aiCacheKey, reviewJobIds);
    if (cached) {
      setAiMatches(cached);
      setIsAiRanking(false);
      setAiRankError("");
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setIsAiRanking(true);
    setAiRankError("");
    setAiMatches([]);

    fetch("/api/jobs/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, jobIds: reviewJobIds }),
      signal: controller.signal
    })
      .then(async (response) => {
        const result = (await response.json()) as { matches?: AiDashboardJobMatch[]; error?: string };
        if (!response.ok) throw new Error(result.error || "AI ranking could not complete.");
        return sanitizeDashboardMatches(result.matches, reviewJobIds);
      })
      .then((matches) => {
        if (cancelled) return;
        setAiMatches(matches);
        localStorage.setItem(aiCacheKey, JSON.stringify(matches));
      })
      .catch((error) => {
        if (cancelled || error instanceof DOMException) return;
        setAiRankError(error instanceof Error ? error.message : "AI ranking could not complete.");
      })
      .finally(() => {
        if (!cancelled) setIsAiRanking(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [aiCacheKey, profile, refreshIndex, reviewJobIds]);

  const rankedJobs = useMemo(() => {
    return aiMatches
      .map((aiMatch) => {
        const job = reviewedJobMap.get(aiMatch.jobId);
        return job ? { job, aiMatch } : null;
      })
      .filter((item): item is RankedJob => Boolean(item));
  }, [aiMatches, reviewedJobMap]);

  const sponsorFriendlyCount = filteredJobs.filter(({ job }) => job.sponsorshipFriendly === "high" || job.sponsorshipFriendly === "medium").length;
  const filtersActive = Boolean(query || selectedLaneId !== "resume-fit" || viewFilter !== "all");
  const reviewLimitApplied = filteredJobs.length > reviewJobs.length;
  const statusText = getRadarStatusText(isAiRanking, aiRankError, rankedJobs.length, reviewJobs.length, reviewLimitApplied);

  function rerunRadar() {
    if (aiCacheKey) localStorage.removeItem(aiCacheKey);
    setRefreshIndex((value) => value + 1);
  }

  return (
    <section className="space-y-5">
      <Reveal>
        <Card className="overflow-hidden p-0">
          <div className="grid gap-0 lg:grid-cols-[1fr_360px]">
            <div className="p-7 sm:p-8">
              <p className="text-sm font-medium text-[#5661d8]">AI radar</p>
              <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-[#171b24]">
                Your best openings, after AI reads the fit.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687180]">
                Stealth reviews current openings against your resume, search type, and sponsorship preference before showing matches.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <StatusPill label={`Matched to ${selectedLaneId === "resume-fit" ? resumeLane.label : activeLane?.label ?? activeDirectionLabel}`} />
                <StatusPill label={profile.lookingFor} />
                <StatusPill label={statusText} active={isAiRanking} />
              </div>
            </div>
            <div className="border-t border-black/[0.06] bg-white/55 p-7 lg:border-l lg:border-t-0">
              <p className="text-sm font-medium text-[#171b24]">Radar health</p>
              <div className="mt-5 space-y-4">
                <FocusLine label="Filtered openings" value={filteredJobs.length} />
                <FocusLine label="AI reviewed" value={reviewJobs.length} />
                <FocusLine label="Sponsor-aware" value={sponsorFriendlyCount} />
                <FocusLine label="Last refresh" value={metadata.lastImportedAt ? formatDate(metadata.lastImportedAt) : "Local fallback"} />
              </div>
            </div>
          </div>
        </Card>
      </Reveal>

      <Reveal>
        <Card className="p-3 sm:p-4">
          <div className="grid gap-3 xl:grid-cols-[1fr_260px_220px] xl:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9aa1ad]" size={17} />
              <Input
                className="h-12 border-transparent bg-white/85 pl-10 shadow-[0_10px_30px_rgba(20,25,34,0.06)]"
                placeholder="Search company, role, skill, or location"
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
        <div>
          <TopMatchesPanel
            jobs={rankedJobs}
            savedJobs={savedJobs}
            isLoading={isAiRanking}
            error={aiRankError}
            filtersActive={filtersActive}
            lookingFor={profile.lookingFor}
            reviewedCount={reviewJobs.length}
            limitApplied={reviewLimitApplied}
            onRetry={rerunRadar}
            onSave={(jobId) => setJobStatus(jobId, "saved")}
          />
        </div>

        <Reveal delay={0.1}>
          <aside className="sticky top-28 space-y-4 self-start">
            <Card className="p-6">
              <p className="flex items-center gap-2 text-sm font-medium text-[#171b24]">
                <ShieldCheck size={16} className="text-[#5661d8]" />
                Radar brief
              </p>
              <div className="mt-5 space-y-3">
                <FocusLine label="Profile direction" value={selectedLaneId === "resume-fit" ? resumeLane.label : activeLane?.label ?? "All roles"} />
                <FocusLine label="Search type" value={profile.lookingFor} />
                <FocusLine label="Ranking" value="AI selected" />
              </div>
              <p className="mt-5 text-sm leading-6 text-[#687180]">
                Save strong roles here, then open Details for the deeper compatibility score and application strategy.
              </p>
              <Button className="mt-5 w-full" variant="secondary" onClick={rerunRadar} disabled={isAiRanking || !reviewJobIds.length}>
                <RefreshCw size={15} />
                Refresh AI radar
              </Button>
            </Card>
          </aside>
        </Reveal>
      </div>
    </section>
  );
}

function TopMatchesPanel({
  jobs,
  savedJobs,
  isLoading,
  error,
  filtersActive,
  lookingFor,
  reviewedCount,
  limitApplied,
  onRetry,
  onSave
}: Readonly<{
  jobs: RankedJob[];
  savedJobs: Record<string, string>;
  isLoading: boolean;
  error: string;
  filtersActive: boolean;
  lookingFor: LookingFor;
  reviewedCount: number;
  limitApplied: boolean;
  onRetry: () => void;
  onSave: (jobId: string) => void;
}>) {
  return (
    <Reveal>
      <Card className="p-5 sm:p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-[#5661d8]">
              <Sparkles size={16} />
              Top matches
            </p>
            <p className="mt-1 text-sm text-[#7a828f]">
              {limitApplied ? `AI reviewed the newest ${reviewedCount} matching openings.` : `AI reviewed ${reviewedCount} matching openings.`}
            </p>
          </div>
          {!isLoading && jobs.length > 0 ? (
            <span className="rounded-full border border-black/[0.06] bg-white px-3 py-1 text-xs text-[#687180] shadow-sm">{jobs.length}</span>
          ) : null}
        </div>

        {isLoading ? <RadarLoadingState /> : error ? <RadarErrorState onRetry={onRetry} /> : jobs.length ? (
          <Stagger className="divide-y divide-black/[0.06]">
            {jobs.map(({ job, aiMatch }, index) => (
              <StaggerItem key={job.id}>
                <JobListRow job={job} aiMatch={aiMatch} rank={index + 1} saved={Boolean(savedJobs[job.id])} onSave={() => onSave(job.id)} />
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <p className="rounded-[22px] border border-black/[0.06] bg-[#fbfbfd] p-5 text-sm leading-6 text-[#7a828f]">
            {getEmptyText(filtersActive, "No AI-selected matches are ready for this view yet.", lookingFor)}
          </p>
        )}
      </Card>
    </Reveal>
  );
}

function RadarLoadingState() {
  return (
    <div className="rounded-[28px] border border-black/[0.06] bg-white/70 p-8 text-center shadow-sm">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f0f2ff] text-[#5661d8]">
        <Loader2 className="animate-spin" size={22} />
      </div>
      <h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-[#171b24]">Reading your resume against current openings...</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#687180]">
        Stealth is comparing role context, skills, sponsorship needs, and job descriptions before showing your radar.
      </p>
      <div className="mx-auto mt-7 max-w-2xl space-y-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-[22px] border border-black/[0.04] bg-[#f7f8fc] p-4">
            <div className="h-3 w-1/4 animate-pulse rounded-full bg-[#e7eaf4]" />
            <div className="mt-3 h-4 w-3/4 animate-pulse rounded-full bg-[#e0e4ef]" />
            <div className="mt-3 h-3 w-1/2 animate-pulse rounded-full bg-[#edf0f7]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RadarErrorState({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <div className="rounded-[28px] border border-black/[0.06] bg-white/75 p-8 text-center shadow-sm">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f8f0ff] text-[#5661d8]">
        <RefreshCw size={20} />
      </div>
      <h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-[#171b24]">AI ranking could not complete</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#687180]">
        The radar only shows AI-selected matches. Retry when the model is available, or adjust filters to review fewer openings.
      </p>
      <Button className="mt-6" onClick={onRetry}>
        <RefreshCw size={15} />
        Retry radar
      </Button>
    </div>
  );
}

function JobListRow({
  job,
  aiMatch,
  rank,
  saved,
  onSave
}: Readonly<{
  job: Job;
  aiMatch: AiDashboardJobMatch;
  rank: number;
  saved: boolean;
  onSave: () => void;
}>) {
  return (
    <motion.div
      className="group -mx-3 grid gap-4 rounded-[24px] px-3 py-5 transition hover:bg-white/55 lg:grid-cols-[56px_1fr_132px_auto] lg:items-center"
      whileHover={{ x: 4 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
    >
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
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#687180]">{aiMatch.reason}</p>
        {aiMatch.riskFlags.length ? (
          <p className="mt-2 line-clamp-1 text-xs text-[#9aa1ad]">Note: {aiMatch.riskFlags[0]}</p>
        ) : null}
      </div>

      <div className="flex items-center lg:justify-end">
        <span className={cn("rounded-full border px-3 py-1.5 text-xs font-medium capitalize", getConfidenceTone(aiMatch.confidence))}>
          {aiMatch.confidence} confidence
        </span>
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

function StatusPill({ label, active = false }: Readonly<{ label: string; active?: boolean }>) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#dfe3ff] bg-white/70 px-3 py-1 text-xs font-medium text-[#5661d8] shadow-sm">
      {active ? <Loader2 size={12} className="animate-spin" /> : null}
      {label}
    </span>
  );
}

function hashProfileForDashboard(profile: CandidateProfile) {
  return stableTextHash(
    JSON.stringify({
      version: DASHBOARD_MATCH_VERSION,
      resumeText: profile.resumeText,
      headline: profile.headline,
      targetRoles: profile.targetRoles,
      skills: profile.skills,
      roleEvidence: profile.roleEvidence,
      skillEvidence: profile.skillEvidence,
      experienceFocus: profile.experienceFocus,
      visaSponsorshipNeeded: profile.visaSponsorshipNeeded,
      lookingFor: profile.lookingFor
    })
  );
}

function readCachedDashboardMatches(cacheKey: string, jobIds: string[]) {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    const matches = sanitizeDashboardMatches(JSON.parse(cached), jobIds);
    return matches.length ? matches : null;
  } catch {
    return null;
  }
}

function sanitizeDashboardMatches(value: unknown, jobIds: string[]) {
  if (!Array.isArray(value)) return [];
  const validIds = new Set(jobIds);
  const seen = new Set<string>();
  const matches: AiDashboardJobMatch[] = [];

  for (const item of value) {
    if (!isAiDashboardJobMatch(item) || !validIds.has(item.jobId) || seen.has(item.jobId)) continue;
    matches.push(item);
    seen.add(item.jobId);
  }

  return matches.slice(0, 50);
}

function isAiDashboardJobMatch(value: unknown): value is AiDashboardJobMatch {
  if (!value || typeof value !== "object") return false;
  const match = value as Partial<AiDashboardJobMatch>;
  return (
    typeof match.jobId === "string" &&
    (match.confidence === "low" || match.confidence === "medium" || match.confidence === "high") &&
    typeof match.reason === "string" &&
    Array.isArray(match.matchedSignals) &&
    Array.isArray(match.riskFlags) &&
    match.source === "openrouter"
  );
}

function getConfidenceTone(confidence: SignalConfidence) {
  if (confidence === "high") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (confidence === "medium") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  return "border-slate-200 bg-white text-[#687180]";
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

function getRadarStatusText(isLoading: boolean, error: string, matchedCount: number, reviewedCount: number, limitApplied: boolean) {
  if (isLoading) return "Reading openings";
  if (error) return "Retry needed";
  if (matchedCount) return `${matchedCount} AI-selected matches`;
  if (reviewedCount && limitApplied) return `Ready to review ${reviewedCount}`;
  if (reviewedCount) return "Ready to review";
  return "No openings";
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
  roleTier: FilteredJob["roleTier"],
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

function getRecencyScore(postedDate: string) {
  const timestamp = new Date(postedDate).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, 100 - Math.floor((Date.now() - timestamp) / 86_400_000));
}

function matchesViewFilter(job: Job, viewFilter: ViewFilter) {
  if (viewFilter === "all") return true;
  if (viewFilter === "remote") return job.workType === "Remote";
  if (viewFilter === "hybrid") return job.workType === "Hybrid";
  if (viewFilter === "onsite") return job.workType === "On-site";
  if (viewFilter === "sponsor-friendly") return job.sponsorshipFriendly === "high" || job.sponsorshipFriendly === "medium";
  if (viewFilter === "fresh-week") return postedWithinDays(job.postedDate, 7);
  if (viewFilter === "fresh-month") return postedWithinDays(job.postedDate, 30);
  return true;
}

function postedWithinDays(postedDate: string, days: number) {
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
  if (filtersActive) return "No openings match these filters. Clear one filter or choose a broader role lane.";
  if (lookingFor === "Internship") return "No internship postings match this resume lane yet. Try another lane or ingest more internship boards.";
  if (lookingFor === "Part-time job") return "No part-time postings match this resume lane yet. Try another lane or broaden the search type.";
  return fallback;
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
