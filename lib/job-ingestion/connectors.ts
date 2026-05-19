import { approvedJobSources, type JobSourceConfig } from "@/lib/job-ingestion/source-registry";
import type { RawPosting } from "@/lib/job-ingestion/types";

const requestTimeoutMs = 12000;
const sourceConcurrency = 4;

export async function fetchApprovedSourcePostings(configs: JobSourceConfig[] = approvedJobSources) {
  const enabled = configs.filter((config) => config.enabled);
  const results = await runWithConcurrency(enabled, sourceConcurrency, (config) => fetchSource(config));

  return results.map((result, index) => {
    const config = enabled[index];
    if (result.status === "fulfilled") {
      return { config, postings: result.value, error: "" };
    }

    return {
      config,
      postings: [] as RawPosting[],
      error: result.reason instanceof Error ? result.reason.message : "Could not fetch source."
    };
  });
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

async function fetchSource(config: JobSourceConfig): Promise<RawPosting[]> {
  if (config.source === "greenhouse") return fetchGreenhouse(requireBoardToken(config));
  if (config.source === "lever") return fetchLever(requireBoardToken(config));
  if (config.source === "ashby") return fetchAshby(requireBoardToken(config));
  if (config.source === "workday") return fetchWorkday(config);
  return [];
}

async function fetchGreenhouse(boardToken: string) {
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`);
  const jobs = getArray(data, "jobs");
  return jobs;
}

async function fetchLever(boardToken: string) {
  const data = await fetchJson(`https://api.lever.co/v0/postings/${boardToken}?mode=json`);
  return Array.isArray(data) ? (data as RawPosting[]) : [];
}

async function fetchAshby(boardToken: string) {
  const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${boardToken}?includeCompensation=true`);
  return getArray(data, "jobs");
}

async function fetchWorkday(config: JobSourceConfig) {
  if (!config.workday) throw new Error("Workday source is missing host, tenant, and site config.");
  const pageLimit = config.workday.pageLimit ?? 20;
  const maxPages = config.workday.maxPages ?? 3;
  const host = config.workday.host.replace(/\/+$/, "");
  const jobsUrl = `${host}/wday/cxs/${config.workday.tenant}/${config.workday.site}/jobs`;
  const postings: RawPosting[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * pageLimit;
    const data = await fetchJson(jobsUrl, {
      method: "POST",
      body: {
        appliedFacets: {},
        limit: pageLimit,
        offset,
        searchText: config.workday.searchText ?? ""
      }
    });
    const pagePostings = getArray(data, "jobPostings");

    if (!pagePostings.length) break;

    const enrichedPostings = await Promise.all(pagePostings.map((posting) => attachWorkdayDetail(posting, host, config)));
    postings.push(...enrichedPostings);

    if (pagePostings.length < pageLimit) break;
  }

  return postings;
}

async function attachWorkdayDetail(posting: RawPosting, host: string, config: JobSourceConfig): Promise<RawPosting> {
  const externalPath = getString(posting, "externalPath");
  if (!externalPath || !looksRelevantStudentPosting(posting)) return posting;

  try {
    const detail = await fetchJson(`${host}/wday/cxs/${config.workday?.tenant}/${config.workday?.site}${externalPath}`);
    return {
      ...posting,
      _workdayDetail: detail
    };
  } catch {
    return posting;
  }
}

async function fetchJson(
  url: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {}
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      next: { revalidate: 0 }
    });

    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }

    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function getArray(value: unknown, key: string) {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return Array.isArray(record[key]) ? (record[key] as RawPosting[]) : [];
}

function getString(record: RawPosting, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function looksRelevantStudentPosting(posting: RawPosting) {
  const text = `${getString(posting, "title")} ${getString(posting, "locationsText")} ${getString(posting, "postedOn")}`.toLowerCase();
  return [
    "intern",
    "internship",
    "co-op",
    "co op",
    "student",
    "university",
    "new grad",
    "analyst",
    "operations",
    "supply chain",
    "procurement",
    "logistics",
    "data"
  ].some((term) => text.includes(term));
}

function requireBoardToken(config: JobSourceConfig) {
  if (!config.boardToken) throw new Error(`${config.id} is missing boardToken.`);
  return config.boardToken;
}
