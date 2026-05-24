import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { fortuneCompanyTargets, type CompanyTarget } from "@/lib/job-ingestion/fortune-targets";
import type { JobSourceConfig } from "@/lib/job-ingestion/source-registry";
import type { JobSource } from "@/lib/types";

export type DiscoveryMode = "ingest" | "discover" | "full";

export type DiscoveredJobSource = {
  id: string;
  company: string;
  source: Exclude<JobSource, "mock" | "manual" | "company_careers">;
  boardToken?: string;
  workday?: JobSourceConfig["workday"];
  category: CompanyTarget["category"];
  sponsorshipFriendly: CompanyTarget["sponsorshipFriendly"];
  competitionLevel: CompanyTarget["competitionLevel"];
  discoveredFromUrl: string;
  discoveredAt: string;
  status: "supported" | "unsupported" | "failed";
  warnings: string[];
};

export type DiscoveryRunSummary = {
  checkedCount: number;
  discoveredCount: number;
  unsupportedCount: number;
  failedCount: number;
  sources: DiscoveredJobSource[];
  warnings: string[];
};

const discoveryCachePath = path.join(process.cwd(), "data", "discovered-job-sources.json");
const discoveryTimeoutMs = 9000;
const discoveryConcurrency = 4;
const defaultDiscoveryBatchSize = 30;

export async function discoverFortuneJobSources({
  batchSize = defaultDiscoveryBatchSize,
  forceCompany
}: {
  batchSize?: number;
  forceCompany?: string;
} = {}): Promise<DiscoveryRunSummary> {
  const discoveredAt = new Date().toISOString();
  const targets = selectDiscoveryTargets({ batchSize, forceCompany });
  const results = await runWithConcurrency(targets, discoveryConcurrency, (target) => discoverTarget(target, discoveredAt));
  const sources = results.flatMap((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : [failedSource(targets[index], discoveredAt, result.reason instanceof Error ? result.reason.message : "Discovery failed.")]
  );
  const supported = sources.filter((source) => source.status === "supported");
  const warnings = sources.flatMap((source) => source.warnings.map((warning) => `${source.company}: ${warning}`));

  await persistDiscoveredJobSources(sources);
  await writeDiscoveryRun({
    importedAt: discoveredAt,
    checkedCount: sources.length,
    discoveredCount: supported.length,
    unsupportedCount: sources.filter((source) => source.status === "unsupported").length,
    failedCount: sources.filter((source) => source.status === "failed").length,
    sources,
    warnings
  });

  return {
    checkedCount: sources.length,
    discoveredCount: supported.length,
    unsupportedCount: sources.filter((source) => source.status === "unsupported").length,
    failedCount: sources.filter((source) => source.status === "failed").length,
    sources,
    warnings
  };
}

export async function readDiscoveredJobSourceConfigs() {
  const supabaseSources = await readDiscoveredJobSourcesFromSupabase();
  const sources = supabaseSources.length ? supabaseSources : await readDiscoveredJobSourcesCache();

  return sources.filter((source) => source.status === "supported").map(discoveredSourceToConfig);
}

export function discoveredSourceToConfig(source: DiscoveredJobSource): JobSourceConfig {
  return {
    id: source.id,
    source: source.source,
    company: source.company,
    boardToken: source.boardToken,
    workday: source.workday,
    sponsorshipFriendly: source.sponsorshipFriendly,
    competitionLevel: source.competitionLevel,
    category: source.category,
    enabled: true
  };
}

export function parseSupportedAtsSources(html: string, finalUrl: string, target: CompanyTarget, discoveredAt = new Date().toISOString()) {
  const links = extractLinks(html, finalUrl);
  const candidates = [...new Set([finalUrl, ...links])];
  const sources: DiscoveredJobSource[] = [];

  for (const candidate of candidates) {
    const source = parseGreenhouse(candidate, target, discoveredAt) ?? parseLever(candidate, target, discoveredAt) ?? parseAshby(candidate, target, discoveredAt) ?? parseWorkday(candidate, target, discoveredAt);
    if (source && !sources.some((existing) => existing.id === source.id)) sources.push(source);
  }

  return sources;
}

async function discoverTarget(target: CompanyTarget, discoveredAt: string): Promise<DiscoveredJobSource[]> {
  const response = await fetchCareersPage(target.careersUrl);
  const sources = parseSupportedAtsSources(response.html, response.finalUrl, target, discoveredAt);
  if (sources.length) return sources;

  return [{
    id: `unsupported-${target.id}`,
    company: target.company,
    source: "greenhouse",
    category: target.category,
    sponsorshipFriendly: target.sponsorshipFriendly,
    competitionLevel: target.competitionLevel,
    discoveredFromUrl: response.finalUrl,
    discoveredAt,
    status: "unsupported",
    warnings: ["No supported Greenhouse, Lever, Ashby, or Workday board link found."]
  }];
}

async function fetchCareersPage(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), discoveryTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "StealthJobRadar/1.0 (+https://stealth.local)"
      },
      redirect: "follow",
      signal: controller.signal,
      next: { revalidate: 0 }
    });

    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return {
      finalUrl: response.url || url,
      html: await response.text()
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseGreenhouse(url: string, target: CompanyTarget, discoveredAt: string): DiscoveredJobSource | null {
  const parsed = safeUrl(url);
  if (!parsed || !/(^|\.)greenhouse\.io$/i.test(parsed.hostname)) return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const tokenIndex = parts.findIndex((part) => part === "boards");
  const token = tokenIndex >= 0 ? parts[tokenIndex + 1] : parts[0];
  if (!token || token === "jobs") return null;

  return supportedSource({
    target,
    source: "greenhouse",
    boardToken: token,
    discoveredFromUrl: url,
    discoveredAt
  });
}

function parseLever(url: string, target: CompanyTarget, discoveredAt: string): DiscoveredJobSource | null {
  const parsed = safeUrl(url);
  if (!parsed || parsed.hostname !== "jobs.lever.co") return null;
  const token = parsed.pathname.split("/").filter(Boolean)[0];
  if (!token) return null;

  return supportedSource({
    target,
    source: "lever",
    boardToken: token,
    discoveredFromUrl: url,
    discoveredAt
  });
}

function parseAshby(url: string, target: CompanyTarget, discoveredAt: string): DiscoveredJobSource | null {
  const parsed = safeUrl(url);
  if (!parsed || parsed.hostname !== "jobs.ashbyhq.com") return null;
  const token = parsed.pathname.split("/").filter(Boolean)[0];
  if (!token) return null;

  return supportedSource({
    target,
    source: "ashby",
    boardToken: token,
    discoveredFromUrl: url,
    discoveredAt
  });
}

function parseWorkday(url: string, target: CompanyTarget, discoveredAt: string): DiscoveredJobSource | null {
  const parsed = safeUrl(url);
  if (!parsed || !parsed.hostname.includes("myworkdayjobs.com")) return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const site = parts[0] || "";
  const hostPrefix = parsed.hostname.split(".")[0];
  const tenant = hostPrefix.includes("-") ? hostPrefix.split("-")[0] : hostPrefix;
  if (!tenant || !site) return null;

  return supportedSource({
    target,
    source: "workday",
    workday: {
      host: `${parsed.protocol}//${parsed.hostname}`,
      tenant,
      site,
      searchText: "intern",
      searchTerms: ["intern", "co-op", "university", "new grad", "early career", "graduate", "analyst"],
      pageLimit: 20,
      maxPages: 3
    },
    discoveredFromUrl: url,
    discoveredAt
  });
}

function supportedSource({
  target,
  source,
  boardToken,
  workday,
  discoveredFromUrl,
  discoveredAt
}: {
  target: CompanyTarget;
  source: Exclude<JobSource, "mock" | "manual" | "company_careers">;
  boardToken?: string;
  workday?: JobSourceConfig["workday"];
  discoveredFromUrl: string;
  discoveredAt: string;
}): DiscoveredJobSource {
  const sourceKey = boardToken ?? `${workday?.tenant}-${workday?.site}`;
  return {
    id: `discovered-${source}-${target.id}-${stableSlug(sourceKey ?? "unknown")}`,
    company: target.company,
    source,
    boardToken,
    workday,
    category: target.category,
    sponsorshipFriendly: target.sponsorshipFriendly,
    competitionLevel: target.competitionLevel,
    discoveredFromUrl,
    discoveredAt,
    status: "supported",
    warnings: []
  };
}

function selectDiscoveryTargets({ batchSize, forceCompany }: { batchSize: number; forceCompany?: string }) {
  const enabled = fortuneCompanyTargets.filter((target) => target.enabled);
  if (forceCompany) {
    const normalized = forceCompany.toLowerCase().trim();
    return enabled.filter((target) => target.company.toLowerCase().includes(normalized) || target.id === normalized);
  }

  const startIndex = getDailyBatchStart(enabled.length, batchSize);
  return rotate(enabled, startIndex).slice(0, batchSize);
}

function getDailyBatchStart(total: number, batchSize: number) {
  if (!total) return 0;
  const day = Math.floor(Date.now() / 86_400_000);
  return (day * batchSize) % total;
}

function rotate<T>(items: T[], startIndex: number) {
  return [...items.slice(startIndex), ...items.slice(0, startIndex)];
}

function extractLinks(html: string, baseUrl: string) {
  const links = new Set<string>();
  const hrefPattern = /\bhref=["']([^"']+)["']/gi;
  const urlPattern = /https?:\/\/[^\s"'<>]+/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefPattern.exec(html))) {
    const normalized = normalizeHref(match[1], baseUrl);
    if (normalized) links.add(normalized);
  }

  while ((match = urlPattern.exec(html))) {
    const normalized = normalizeHref(match[0], baseUrl);
    if (normalized) links.add(normalized);
  }

  return [...links].filter((link) => isSupportedAtsUrl(link));
}

function isSupportedAtsUrl(url: string) {
  const parsed = safeUrl(url);
  if (!parsed) return false;
  return (
    parsed.hostname.includes("greenhouse.io") ||
    parsed.hostname === "jobs.lever.co" ||
    parsed.hostname === "jobs.ashbyhq.com" ||
    parsed.hostname.includes("myworkdayjobs.com")
  );
}

function normalizeHref(href: string, baseUrl: string) {
  try {
    return new URL(href.replace(/&amp;/g, "&"), baseUrl).toString();
  } catch {
    return "";
  }
}

function safeUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function failedSource(target: CompanyTarget, discoveredAt: string, warning: string): DiscoveredJobSource {
  return {
    id: `failed-${target.id}`,
    company: target.company,
    source: "greenhouse",
    category: target.category,
    sponsorshipFriendly: target.sponsorshipFriendly,
    competitionLevel: target.competitionLevel,
    discoveredFromUrl: target.careersUrl,
    discoveredAt,
    status: "failed",
    warnings: [warning]
  };
}

async function persistDiscoveredJobSources(sources: DiscoveredJobSource[]) {
  const existing = await readDiscoveredJobSourcesCache();
  const merged = dedupeDiscoveredSources([...existing, ...sources]);
  await writeDiscoveredJobSourcesCache(merged);
  await writeDiscoveredJobSourcesToSupabase(merged);
}

async function readDiscoveredJobSourcesCache(): Promise<DiscoveredJobSource[]> {
  try {
    const parsed = JSON.parse(await readFile(discoveryCachePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isDiscoveredJobSource) : [];
  } catch {
    return [];
  }
}

async function writeDiscoveredJobSourcesCache(sources: DiscoveredJobSource[]) {
  await mkdir(path.dirname(discoveryCachePath), { recursive: true });
  await writeFile(discoveryCachePath, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
}

async function readDiscoveredJobSourcesFromSupabase() {
  const supabase = createServiceRoleSupabaseClient() ?? (await createServerSupabaseClient());
  if (!supabase) return [];
  const { data, error } = await supabase.from("discovered_job_sources").select("*").eq("status", "supported");
  if (error) return [];
  return (data ?? []).map(rowToDiscoveredSource).filter(isDiscoveredJobSource);
}

async function writeDiscoveredJobSourcesToSupabase(sources: DiscoveredJobSource[]) {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase || !sources.length) return;
  await supabase.from("discovered_job_sources").upsert(sources.map(discoveredSourceToRow), { onConflict: "id" });
}

async function writeDiscoveryRun(summary: DiscoveryRunSummary & { importedAt: string }) {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return;
  await supabase.from("job_discovery_runs").insert({
    discovered_at: summary.importedAt,
    checked_count: summary.checkedCount,
    discovered_count: summary.discoveredCount,
    unsupported_count: summary.unsupportedCount,
    failed_count: summary.failedCount,
    results: summary.sources,
    warnings: summary.warnings
  });
}

function discoveredSourceToRow(source: DiscoveredJobSource) {
  return {
    id: source.id,
    company: source.company,
    source: source.source,
    board_token: source.boardToken ?? null,
    workday: source.workday ?? null,
    category: source.category,
    sponsorship_friendly: source.sponsorshipFriendly,
    competition_level: source.competitionLevel,
    discovered_from_url: source.discoveredFromUrl,
    discovered_at: source.discoveredAt,
    status: source.status,
    warnings: source.warnings
  };
}

function rowToDiscoveredSource(row: Record<string, unknown>): DiscoveredJobSource {
  return {
    id: stringValue(row.id),
    company: stringValue(row.company),
    source: stringValue(row.source) as Exclude<JobSource, "mock" | "manual" | "company_careers">,
    boardToken: stringValue(row.board_token) || undefined,
    workday: isRecord(row.workday) ? (row.workday as JobSourceConfig["workday"]) : undefined,
    category: stringValue(row.category) as CompanyTarget["category"],
    sponsorshipFriendly: stringValue(row.sponsorship_friendly) as CompanyTarget["sponsorshipFriendly"],
    competitionLevel: stringValue(row.competition_level) as CompanyTarget["competitionLevel"],
    discoveredFromUrl: stringValue(row.discovered_from_url),
    discoveredAt: stringValue(row.discovered_at),
    status: stringValue(row.status) as DiscoveredJobSource["status"],
    warnings: Array.isArray(row.warnings) ? row.warnings.filter((item): item is string => typeof item === "string") : []
  };
}

function isDiscoveredJobSource(value: unknown): value is DiscoveredJobSource {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.company === "string" &&
    (value.source === "greenhouse" || value.source === "lever" || value.source === "ashby" || value.source === "workday") &&
    (value.status === "supported" || value.status === "unsupported" || value.status === "failed") &&
    typeof value.discoveredFromUrl === "string"
  );
}

function dedupeDiscoveredSources(sources: DiscoveredJobSource[]) {
  const seen = new Map<string, DiscoveredJobSource>();
  for (const source of sources) {
    seen.set(source.id, source);
  }
  return [...seen.values()];
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = { status: "fulfilled", value: await worker(items[currentIndex]) };
      } catch (reason) {
        results[currentIndex] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
  return results;
}

function stableSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "source";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
