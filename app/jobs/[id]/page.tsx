"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bookmark, Check, ExternalLink, Loader2, MapPin, RefreshCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Reveal, Stagger, StaggerItem } from "@/components/motion-primitives";
import { JOB_MATCH_VERSION } from "@/lib/ai-versions";
import { getCompanyInitials, getCompanyLogoUrls } from "@/lib/company-logos";
import type { AiJobAnalysis, Job, SavedStatus } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

const statuses: SavedStatus[] = ["saved", "applied", "interview", "rejected", "offer"];

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const { profile, savedJobs, setJobStatus } = useAppState();
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState("");

  const jobId = job?.id ?? params.id;
  const profileHash = useMemo(() => hashProfileForJobAnalysis(profile), [profile]);
  const cacheKey = `stealth.aiJobScore.${JOB_MATCH_VERSION}.${jobId}.${profileHash}`;
  const [aiAnalysis, setAiAnalysis] = useState<AiJobAnalysis | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [scoreError, setScoreError] = useState("");
  const match = aiAnalysis;
  const currentStatus = job ? savedJobs[job.id] ?? "saved" : "saved";
  const fitLabel = match ? (match.score >= 82 ? "Apply now" : match.score >= 68 ? "Strong fit" : match.score >= 52 ? "Review carefully" : "Low fit") : "";
  const missingSkills = match?.missingSkills.length ? match.missingSkills.join(", ") : "";
  const matchedSkills = match?.matchedSkills.length ? match.matchedSkills.join(", ") : "";
  const scoreLabel = match ? `${match.source.replace("_", " ")} analysis` : "Reading your resume against this role...";

  useEffect(() => {
    async function loadJob() {
      setJobError("");

      try {
        const response = await fetch("/api/jobs");
        const result = (await response.json()) as { jobs?: Job[]; error?: string };
        if (!response.ok || !result.jobs) throw new Error(result.error ?? "Could not load jobs.");

        const found = result.jobs.find((item) => item.id === params.id);
        if (!found) throw new Error("Job not found.");
        setJob(found);
      } catch (error) {
        setJob(null);
        setJobError(error instanceof Error ? error.message : "Could not load this job.");
      }
    }

    void loadJob();
  }, [params.id]);

  useEffect(() => {
    if (!job) return;
    setIsDescriptionExpanded(false);

    const cached = window.localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as AiJobAnalysis;
        if (isCachedAiAnalysis(parsed)) {
          setAiAnalysis(parsed);
          setScoreError("");
          return;
        }
        window.localStorage.removeItem(cacheKey);
        setScoreError("");
      } catch {
        window.localStorage.removeItem(cacheKey);
      }
    }

    setAiAnalysis(null);
    void loadAiAnalysis({ refresh: false });
  }, [cacheKey, job]);

  async function loadAiAnalysis({ refresh }: { refresh: boolean }) {
    if (!job) return;

    setIsScoring(true);
    setScoreError("");

    if (refresh) {
      window.localStorage.removeItem(cacheKey);
    }

    try {
      const response = await fetch("/api/jobs/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          profile
        })
      });
      const result = (await response.json()) as { analysis?: AiJobAnalysis; error?: string };

      if (!response.ok || !result.analysis) {
        throw new Error(result.error ?? "Could not generate AI analysis.");
      }

      setAiAnalysis(result.analysis);
      window.localStorage.setItem(cacheKey, JSON.stringify(result.analysis));
    } catch (error) {
      setScoreError(error instanceof Error ? error.message : "Could not generate AI analysis.");
    } finally {
      setIsScoring(false);
    }
  }

  if (!job) {
    return (
      <div className="pb-24">
        <Card className="grid min-h-[420px] place-items-center p-8 text-center">
          <div>
            <Loader2 className={cn("mx-auto text-[#5661d8]", !jobError && "animate-spin")} size={34} />
            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-[#171b24]">
              {jobError ? "Job unavailable" : "Loading opportunity"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#687180]">
              {jobError || "Reading the normalized job catalog."}
            </p>
            <Button asChild className="mt-6" variant="outline">
              <Link href="/dashboard">
                <ArrowLeft size={16} />
                Back to radar
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

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
                  {match ? (
                    <>
                      <div className="mt-2 flex items-end gap-2">
                        <span className="text-6xl font-semibold tracking-[-0.06em] text-[#171b24]">{match.score}</span>
                        <span className="pb-2 text-sm font-medium text-[#8a92a0]">/100</span>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/[0.06]">
                        <div className="h-full rounded-full bg-[#626eea]" style={{ width: `${match.score}%` }} />
                      </div>
                      <p className="mt-3 text-sm font-medium text-[#5661d8]">{fitLabel}</p>
                    </>
                  ) : (
                    <div className="mt-5 flex items-center gap-3 rounded-[22px] border border-black/[0.06] bg-white/70 px-4 py-4 shadow-sm">
                      <Loader2 className="animate-spin text-[#5661d8]" size={22} />
                      <div>
                        <p className="text-sm font-medium text-[#171b24]">Analyzing fit</p>
                        <p className="mt-0.5 text-xs text-[#8a92a0]">AI score loading</p>
                      </div>
                    </div>
                  )}
                  <p className="mt-1 text-xs text-[#8a92a0]">{scoreLabel}</p>
                  <p className="mt-2 max-w-44 text-xs leading-5 text-[#9aa1ad]">
                    Based on your uploaded resume and this job description.
                  </p>
                </div>
              </div>

              <div className="my-9 h-px bg-black/[0.06]" />

              <DescriptionBlock
                description={job.description}
                highlights={match?.jobHighlights ?? []}
                loading={!match}
                expanded={isDescriptionExpanded}
                onToggle={() => setIsDescriptionExpanded((current) => !current)}
              />

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
                <Button variant="outline" size="lg" onClick={() => void loadAiAnalysis({ refresh: true })} disabled={isScoring}>
                  {isScoring ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
                  Refresh AI analysis
                </Button>
              </div>
              {match?.confidence === "low" && (
                <p className="mt-4 rounded-2xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-800">
                  Low confidence: the resume or job data does not contain enough evidence for a precise compatibility read.
                </p>
              )}
              {scoreError && <p className="mt-4 text-sm text-rose-600">{scoreError}</p>}
            </Card>
          </Reveal>

          <Reveal delay={0.08}>
            <Card className="p-8">
              <div className="flex items-center gap-2">
                <Sparkles size={17} className="text-[#5661d8]" />
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-[#171b24]">Application strategy</h2>
              </div>
              <p className="mt-5 rounded-[24px] border border-black/[0.06] bg-white/65 p-5 text-sm leading-7 text-[#4d5665] shadow-sm">
                {match ? match.applicationStrategy : "Reading your resume against this role before recommending an application angle."}
              </p>
              <div className="mt-3 divide-y divide-black/[0.06]">
                <DetailRow label="Lead with" value={matchedSkills || "AI analysis loading"} />
                <DetailRow label="Mind the gap" value={missingSkills || "AI analysis loading"} positive={Boolean(match && !match.missingSkills.length)} />
                <DetailRow label="Resume keywords" value={match ? match.suggestedKeywords.join(", ") : "AI analysis loading"} />
              </div>
            </Card>
          </Reveal>
        </div>

        <Stagger className="space-y-6 lg:sticky lg:top-32">
          <StaggerItem>
            <Card className="p-8">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#171b24]">Compatibility</h2>
                {!match && <Loader2 className="animate-spin text-[#5661d8]" size={18} />}
              </div>
              {match ? (
                <>
                  <div className="mt-6 space-y-4">
                    <BreakdownRow label="Skills" factor={match.scoreBreakdown.skillFit} />
                    <BreakdownRow label="Role" factor={match.scoreBreakdown.roleFit} />
                    <BreakdownRow label="Projects" factor={match.scoreBreakdown.projectEvidence} />
                    <BreakdownRow label="Visa" factor={match.scoreBreakdown.sponsorshipFit} />
                    <BreakdownRow label="Readiness" factor={match.scoreBreakdown.competitionReadiness} />
                  </div>
                  <div className="mt-7 space-y-4 border-t border-black/[0.06] pt-6">
                    {match.why.map((reason, index) => (
                      <ReasonLine key={reason} index={index + 1} text={reason} />
                    ))}
                  </div>
                </>
              ) : (
                <AnalysisLoadingState />
              )}
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card className="p-8">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#171b24]">Resume evidence</h2>
              {match ? (
                <div className="mt-6 space-y-4">
                  {match.matchedEvidence.map((evidence, index) => (
                    <EvidenceLine key={evidence} index={index + 1} text={evidence} />
                  ))}
                </div>
              ) : (
                <AnalysisLoadingState compact />
              )}
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card className="p-8">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#171b24]">Gaps</h2>
              {match ? (
                <div className="mt-6 space-y-4">
                  {match.gaps.map((gap, index) => (
                    <EvidenceLine key={gap} index={index + 1} text={gap} muted />
                  ))}
                </div>
              ) : (
                <AnalysisLoadingState compact />
              )}
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
                      match?.matchedSkills.includes(skill)
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-black/[0.06] bg-white/60 text-[#687180]"
                    )}
                  >
                    {match?.matchedSkills.includes(skill) && <Check className="mr-1 inline" size={13} />}
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

function hashProfileForJobAnalysis(profile: unknown) {
  const input = JSON.stringify(profile);
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function isCachedAiAnalysis(analysis: AiJobAnalysis) {
  return (
    typeof analysis.score === "number" &&
    Boolean(analysis.scoreBreakdown?.skillFit) &&
    Array.isArray(analysis.matchedEvidence) &&
    Array.isArray(analysis.gaps) &&
    Array.isArray(analysis.jobHighlights) &&
    typeof analysis.applicationStrategy === "string"
  );
}

function AnalysisLoadingState({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <div className={cn("mt-6 rounded-[24px] border border-black/[0.06] bg-white/65 p-5 shadow-sm", compact && "p-4")}>
      <div className="flex items-center gap-3">
        <Loader2 className="animate-spin text-[#5661d8]" size={18} />
        <div>
          <p className="text-sm font-medium text-[#171b24]">Reading your resume against this role</p>
          {!compact && <p className="mt-1 text-sm leading-6 text-[#687180]">The AI analysis will appear here when it is ready.</p>}
        </div>
      </div>
      {!compact && (
        <div className="mt-5 space-y-3">
          <span className="block h-3 w-4/5 animate-pulse rounded-full bg-black/[0.06]" />
          <span className="block h-3 w-2/3 animate-pulse rounded-full bg-black/[0.06]" />
          <span className="block h-3 w-3/4 animate-pulse rounded-full bg-black/[0.06]" />
        </div>
      )}
    </div>
  );
}

function CompanyMark({ company }: Readonly<{ company: string }>) {
  const [logoIndex, setLogoIndex] = useState(0);
  const logoUrls = getCompanyLogoUrls(company);
  const logoUrl = logoUrls[logoIndex];

  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-black/[0.06] bg-white text-sm font-semibold text-[#5661d8] shadow-sm">
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
        getCompanyInitials(company)
      )}
    </div>
  );
}

function DescriptionBlock({
  description,
  highlights,
  loading,
  expanded,
  onToggle
}: Readonly<{ description: string; highlights: string[]; loading: boolean; expanded: boolean; onToggle: () => void }>) {
  const cleanDescription = description.trim();
  const descriptionBlocks = parseJobDescription(cleanDescription).slice(0, 80);

  return (
    <section>
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">Role brief</p>
      {loading ? (
        <div className="mt-4 rounded-[24px] border border-black/[0.06] bg-white/65 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin text-[#5661d8]" size={18} />
            <p className="text-sm font-medium text-[#171b24]">Extracting important job details</p>
          </div>
          <div className="mt-5 space-y-3">
            <span className="block h-3 w-5/6 animate-pulse rounded-full bg-black/[0.06]" />
            <span className="block h-3 w-2/3 animate-pulse rounded-full bg-black/[0.06]" />
            <span className="block h-3 w-4/5 animate-pulse rounded-full bg-black/[0.06]" />
          </div>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {highlights.map((highlight) => (
            <li
              key={highlight}
              className="rounded-[22px] border border-black/[0.06] bg-white/65 px-5 py-4 text-sm leading-6 text-[#4d5665] shadow-sm"
            >
              {highlight}
            </li>
          ))}
        </ul>
      )}

      {expanded && (
        <div className="mt-5 max-h-[560px] space-y-5 overflow-y-auto rounded-[26px] border border-black/[0.06] bg-white/55 p-6 text-sm leading-7 text-[#5f6877] shadow-sm">
          {descriptionBlocks.map((block, index) => (
            <DescriptionBlockContent key={getDescriptionBlockKey(block, index)} block={block} />
          ))}
        </div>
      )}

      {cleanDescription.length > 0 && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-5 rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-sm font-medium text-[#171b24] shadow-sm transition hover:-translate-y-0.5 hover:bg-white"
        >
          {expanded ? "Hide original description" : "View original description"}
        </button>
      )}
    </section>
  );
}

type ParsedDescriptionBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

function DescriptionBlockContent({ block }: Readonly<{ block: ParsedDescriptionBlock }>) {
  if (block.type === "heading") {
    return <h3 className="pt-1 text-sm font-semibold tracking-[-0.01em] text-[#171b24]">{block.text}</h3>;
  }

  if (block.type === "list") {
    return (
      <ul className="space-y-2">
        {block.items.map((item) => (
          <li key={item} className="grid grid-cols-[18px_1fr] gap-2">
            <span className="mt-3 h-1.5 w-1.5 rounded-full bg-[#626eea]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  return <p>{block.text}</p>;
}

function getDescriptionBlockKey(block: ParsedDescriptionBlock, index: number) {
  const value = block.type === "list" ? block.items[0] : block.text;
  return `${block.type}-${index}-${value}`;
}

function parseJobDescription(description: string): ParsedDescriptionBlock[] {
  const prepared = addReadableBreaks(description);
  const lines = prepared
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks: ParsedDescriptionBlock[] = [];
  let pendingList: string[] = [];

  const flushList = () => {
    if (!pendingList.length) return;
    blocks.push({ type: "list", items: pendingList });
    pendingList = [];
  };

  const addBodyText = (text: string) => {
    const items = splitLikelyListItems(text);
    if (items.length >= 2) {
      pendingList.push(...items);
      return;
    }

    flushList();
    blocks.push({ type: "paragraph", text });
  };

  for (const line of lines) {
    const bullet = line.match(/^[-•*]\s+(.+)$/);
    if (bullet) {
      pendingList.push(bullet[1].trim());
      continue;
    }

    const inlineSection = extractInlineSection(line);
    if (inlineSection) {
      flushList();
      blocks.push({ type: "heading", text: inlineSection.heading });
      if (inlineSection.body) addBodyText(inlineSection.body);
      continue;
    }

    flushList();
    blocks.push(isLikelyDescriptionHeading(line) ? { type: "heading", text: line } : { type: "paragraph", text: line });
  }

  flushList();
  return blocks.length ? blocks : [{ type: "paragraph", text: description }];
}

function addReadableBreaks(description: string) {
  const normalized = description.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const source = normalized.includes("\n") ? normalized : normalized.replace(
    /\s+(?=(About (?:Us|the Role|This Role)|Who We Are|The Role|About the Role|What You'll Do|What You Will Do|What You Bring|Responsibilities|Requirements|Qualifications|Minimum Qualifications|Preferred Qualifications|Basic Qualifications|Benefits|Compensation|Salary Range|Equal Opportunity)\b)/g,
    "\n\n"
  );

  return source
    .replace(
      /\s+(?=(Ability to|Actively pursuing|A graduation date|Bachelor'?s|Comfortable|Create|Define|Deploy|Design|Develop|Experience (?:with|building|in)|Familiar with|Knowledge of|Nice to have|Prior internship|Previous|Product engineering experience|Track record|Understanding of|Use|Work with|Build)\b)/g,
      "\n- "
    );
}

function extractInlineSection(line: string) {
  const match = line.match(
    /^(About(?: Us| the Role| This Role)?|Who We Are|The Role|About the Role|What You'll Do|What You Will Do|What You Bring|Responsibilities|Requirements|Qualifications|Minimum Qualifications|Preferred Qualifications|Basic Qualifications|Benefits|Compensation|Salary Range|Equal Opportunity)(?::|\s+-\s+)?\s*(.*)$/i
  );
  if (!match) return null;

  const heading = match[1].trim();
  const body = match[2].trim();
  if (!body || body.length > 20) return { heading, body };
  return null;
}

function splitLikelyListItems(text: string) {
  const parts = text
    .replace(
      /\s+(?=(Ability to|Actively pursuing|A graduation date|Bachelor'?s|Comfortable|Create|Define|Deploy|Design|Develop|Experience (?:with|building|in)|Familiar with|Knowledge of|Nice to have|Prior internship|Previous|Product engineering experience|Track record|Understanding of|Use|Work with|Build)\b)/g,
      "\n"
    )
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length < 2) return [];
  return parts;
}

function isLikelyDescriptionHeading(line: string) {
  if (line.length > 90) return false;
  if (/[.!?]$/.test(line)) return false;
  return /^(About|Who We Are|The Role|What|Responsibilities|Requirements|Qualifications|Minimum|Preferred|Basic|Benefits|Compensation|You Will|You Have|Nice to Have)/i.test(
    line
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

function BreakdownRow({ label, factor }: Readonly<{ label: string; factor: { score: number; reason: string } }>) {
  return (
    <div className="rounded-[22px] border border-black/[0.06] bg-white/65 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">{label}</p>
        <span className="text-sm font-semibold text-[#171b24]">{factor.score}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
        <div className="h-full rounded-full bg-[#626eea]" style={{ width: `${factor.score}%` }} />
      </div>
      <p className="mt-3 text-sm leading-6 text-[#5f6877]">{factor.reason}</p>
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

function EvidenceLine({ index, text, muted = false }: Readonly<{ index: number; text: string; muted?: boolean }>) {
  return (
    <div className="grid grid-cols-[32px_1fr] gap-4">
      <span
        className={cn(
          "grid h-8 w-8 place-items-center rounded-full border text-xs font-medium shadow-sm",
          muted
            ? "border-black/[0.06] bg-white text-[#8a92a0]"
            : "border-emerald-200 bg-emerald-50 text-emerald-700"
        )}
      >
        {muted ? index : <Check size={14} />}
      </span>
      <p className="pt-1 text-sm leading-6 text-[#5f6877]">{text}</p>
    </div>
  );
}
