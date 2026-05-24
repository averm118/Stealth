#!/usr/bin/env python3
"""Allowlisted company-careers scraper for Stealth.

This supplements the official ATS/API ingestion pipeline. It only reads public,
company-owned careers pages configured in configs.json and emits normalized
records for the secured Next.js import endpoint.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.robotparser
from dataclasses import dataclass, field
from html import unescape
from pathlib import Path
from typing import Any, Iterable

from bs4 import BeautifulSoup


DEFAULT_CONFIG_PATH = Path(__file__).with_name("configs.json")
DEFAULT_USER_AGENT = os.environ.get("SCRAPER_USER_AGENT", "StealthJobRadar/1.0 (+https://stealth.local)")
DEFAULT_SEARCH_TERMS = [
    "intern",
    "internship",
    "co-op",
    "university",
    "new grad",
    "early career",
    "rotational",
    "analyst",
    "supply chain",
    "operations",
    "procurement",
    "logistics",
]
BLOCKED_HOST_PARTS = (
    "linkedin.com",
    "indeed.com",
    "handshake",
    "google.com/search",
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "myworkdayjobs.com",
)
STUDENT_TERMS = (
    "intern",
    "internship",
    "co-op",
    "co op",
    "student",
    "university",
    "campus",
    "new grad",
    "new graduate",
    "graduate program",
    "early career",
    "early talent",
    "rotational",
    "development program",
    "entry level",
    "entry-level",
    "associate analyst",
    "analyst",
    "supply chain",
    "operations",
    "procurement",
    "logistics",
)
SENIORITY_TERMS = ("senior", "staff", "principal", "manager", "director", "lead", "head")


@dataclass
class ScraperSelectors:
    job_card: str = "a[href]"
    title: str = ""
    location: str = ""
    apply_url: str = ""
    detail_body: str = "main"
    load_more: str = ""
    next_page: str = ""
    card_wait: str = ""


@dataclass
class ScraperConfig:
    id: str
    company: str
    careers_url: str
    mode: str
    category: str
    sponsorship_friendly: str
    competition_level: str
    enabled: bool
    selectors: ScraperSelectors
    search_terms: list[str] = field(default_factory=list)
    max_pages: int = 2
    max_jobs_per_company: int = 80
    max_detail_pages_per_run: int = 80
    list_url_template: str = ""


@dataclass
class ScrapeStats:
    pages_visited: int = 0
    links_found: int = 0
    jobs_found: int = 0
    skipped_count: int = 0
    skipped_reasons: dict[str, int] = field(default_factory=dict)

    def skip(self, reason: str) -> None:
        self.skipped_count += 1
        self.skipped_reasons[reason] = self.skipped_reasons.get(reason, 0) + 1


def main() -> int:
    args = parse_args()
    configs = load_configs(args.config)
    if args.company:
        wanted = args.company.lower()
        configs = [config for config in configs if wanted in config.company.lower() or wanted == config.id.lower()]
    configs = [config for config in configs if config.enabled]
    configs = select_shard(configs, args.shard_index, args.shard_total)
    if args.batch_size:
        configs = configs[: args.batch_size]

    result = asyncio.run(scrape_configs(configs, args.limit_per_company, args.ignore_robots))
    payload = {
        "importedAt": current_iso(),
        "jobs": result["jobs"],
        "warnings": result["warnings"],
        "sourceResults": result["sourceResults"],
        "scraperSummary": result["scraperSummary"],
    }

    if args.output:
        Path(args.output).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    else:
        print(json.dumps(payload, indent=2))

    if args.post_url:
        post_payload(args.post_url, args.token or os.environ.get("INGEST_ADMIN_TOKEN", ""), payload)

    return 0 if result["jobs"] or not args.fail_on_empty else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape allowlisted company career pages for Stealth.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH))
    parser.add_argument("--company", help="Run one configured company by id or company name.")
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("SCRAPER_BATCH_SIZE", "25")))
    parser.add_argument("--limit-per-company", type=int, default=int(os.environ.get("SCRAPER_LIMIT_PER_COMPANY", "80")))
    parser.add_argument("--shard-index", type=int, default=int(os.environ.get("SCRAPER_SHARD_INDEX", "0")))
    parser.add_argument("--shard-total", type=int, default=int(os.environ.get("SCRAPER_SHARD_TOTAL", "1")))
    parser.add_argument("--output", help="Write JSON payload to a file instead of stdout only.")
    parser.add_argument("--post-url", help="POST payload to the Stealth /api/jobs/import-scraped endpoint.")
    parser.add_argument("--token", help="INGEST_ADMIN_TOKEN for --post-url.")
    parser.add_argument("--ignore-robots", action="store_true", help="Debug only. Do not use in scheduled runs.")
    parser.add_argument("--fail-on-empty", action="store_true")
    return parser.parse_args()


def load_configs(path: str) -> list[ScraperConfig]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    configs: list[ScraperConfig] = []
    for item in raw:
        selectors = item.get("selectors", {})
        configs.append(
            ScraperConfig(
                id=str(item["id"]),
                company=str(item["company"]),
                careers_url=str(item["careersUrl"]),
                mode=str(item.get("mode", "static")),
                category=str(item.get("category", "operations")),
                sponsorship_friendly=str(item.get("sponsorshipFriendly", "unknown")),
                competition_level=str(item.get("competitionLevel", "medium")),
                enabled=bool(item.get("enabled", False)),
                selectors=ScraperSelectors(
                    job_card=str(selectors.get("jobCard", "a[href]")),
                    title=str(selectors.get("title", "")),
                    location=str(selectors.get("location", "")),
                    apply_url=str(selectors.get("applyUrl", "")),
                    detail_body=str(selectors.get("detailBody", "main")),
                    load_more=str(item.get("loadMoreSelector") or selectors.get("loadMoreSelector", "")),
                    next_page=str(item.get("nextPageSelector") or selectors.get("nextPageSelector", "")),
                    card_wait=str(item.get("cardWaitSelector") or selectors.get("cardWaitSelector", "")),
                ),
                search_terms=dedupe_strings(item.get("searchTerms") or DEFAULT_SEARCH_TERMS),
                max_pages=max(1, int(item.get("maxPages", 2))),
                max_jobs_per_company=max(1, int(item.get("maxJobsPerCompany", 80))),
                max_detail_pages_per_run=max(1, int(item.get("maxDetailPagesPerRun", 80))),
                list_url_template=str(item.get("listUrlTemplate", "")),
            )
        )
    return configs


def select_shard(configs: list[ScraperConfig], shard_index: int, shard_total: int) -> list[ScraperConfig]:
    shard_total = max(1, shard_total)
    shard_index = max(0, min(shard_total - 1, shard_index))
    return [config for index, config in enumerate(configs) if index % shard_total == shard_index]


async def scrape_configs(configs: list[ScraperConfig], limit_per_company: int, ignore_robots: bool) -> dict[str, Any]:
    jobs: list[dict[str, Any]] = []
    warnings: list[str] = []
    source_results: list[dict[str, Any]] = []
    scraper_summary: list[dict[str, Any]] = []

    for config in configs:
        stats = ScrapeStats()
        try:
            validate_allowed_url(config.careers_url)
            if not ignore_robots and not robots_allows(config.careers_url):
                raise RuntimeError("robots.txt disallows this careers URL")

            company_limit = min(limit_per_company, config.max_jobs_per_company)
            company_jobs = (
                await scrape_with_playwright(config, company_limit, stats)
                if config.mode == "playwright"
                else scrape_static(config, company_limit, stats)
            )
            company_jobs = dedupe_jobs(company_jobs)[:company_limit]
            stats.jobs_found = len(company_jobs)
            jobs.extend(company_jobs)
            source_results.append(source_result(config.company, len(company_jobs), len(company_jobs), stats.skipped_count, ""))
            scraper_summary.append(summary_result(config, stats, ""))
            time.sleep(1.0)
        except Exception as exc:  # noqa: BLE001 - scraper should warn and continue
            message = f"{config.company}: {exc}"
            warnings.append(message)
            source_results.append(source_result(config.company, 0, 0, stats.skipped_count, str(exc)))
            scraper_summary.append(summary_result(config, stats, str(exc)))

    return {
        "jobs": dedupe_jobs(jobs),
        "warnings": warnings,
        "sourceResults": source_results,
        "scraperSummary": scraper_summary,
    }


def scrape_static(config: ScraperConfig, limit: int, stats: ScrapeStats) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    detail_budget = config.max_detail_pages_per_run
    for list_page in build_list_pages(config):
        if len(jobs) >= limit or detail_budget <= 0:
            break
        html = fetch_text(list_page["url"])
        stats.pages_visited += 1
        soup = BeautifulSoup(html, "html.parser")
        jobs.extend(extract_jsonld_jobs(config, soup, list_page, stats))
        links = extract_candidate_links(soup, list_page["url"], config.selectors.job_card, stats)
        links.extend(extract_script_links(soup, list_page["url"], stats))
        hydrated = hydrate_links(config, dedupe_links(links), use_playwright=False, list_page=list_page, stats=stats, limit=detail_budget)
        detail_budget -= len(hydrated)
        jobs.extend(hydrated)
    return dedupe_jobs(jobs)[:limit]


async def scrape_with_playwright(config: ScraperConfig, limit: int, stats: ScrapeStats) -> list[dict[str, Any]]:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError("playwright is not installed. Run: python -m playwright install chromium") from exc

    jobs: list[dict[str, Any]] = []
    detail_budget = config.max_detail_pages_per_run

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(user_agent=DEFAULT_USER_AGENT)

        for list_page in build_list_pages(config):
            if len(jobs) >= limit or detail_budget <= 0:
                break
            await page.goto(list_page["url"], wait_until="domcontentloaded", timeout=30000)
            await wait_for_cards(page, config)
            await expand_results(page, config)
            html = await page.content()
            stats.pages_visited += 1
            soup = BeautifulSoup(html, "html.parser")
            jobs.extend(extract_jsonld_jobs(config, soup, list_page, stats))
            links = extract_candidate_links(soup, list_page["url"], config.selectors.job_card, stats)
            links.extend(extract_script_links(soup, list_page["url"], stats))
            hydrated = await hydrate_links_with_browser(
                browser,
                config,
                dedupe_links(links),
                list_page,
                stats,
                detail_budget,
            )
            detail_budget -= len(hydrated)
            jobs.extend(hydrated)

        await browser.close()

    return dedupe_jobs(jobs)[:limit]


def build_list_pages(config: ScraperConfig) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    for search_term in config.search_terms:
        for page_number in range(1, config.max_pages + 1):
            if config.list_url_template:
                url = config.list_url_template.format(
                    term=urllib.parse.quote(search_term),
                    query=urllib.parse.quote(search_term),
                    page=page_number,
                    offset=(page_number - 1) * 25,
                )
            else:
                url = append_search_params(config.careers_url, search_term, page_number)
            pages.append({"url": url, "searchTerm": search_term, "listPage": page_number})
    return pages


def append_search_params(url: str, term: str, page_number: int) -> str:
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    if "q" not in query and "query" not in query and "keyword" not in query:
        query["q"] = [term]
    query.setdefault("page", [str(page_number)])
    return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query, doseq=True)))


async def wait_for_cards(page: Any, config: ScraperConfig) -> None:
    selector = config.selectors.card_wait or config.selectors.job_card
    if not selector:
        return
    try:
        await page.wait_for_selector(selector, timeout=8000)
    except Exception:
        return


async def expand_results(page: Any, config: ScraperConfig) -> None:
    for _ in range(4):
        await page.mouse.wheel(0, 1800)
        await page.wait_for_timeout(500)

    if config.selectors.load_more:
        for _ in range(max(0, config.max_pages - 1)):
            try:
                button = page.locator(config.selectors.load_more).first
                if not await button.is_visible(timeout=1200):
                    break
                await button.click()
                await page.wait_for_timeout(1200)
            except Exception:
                break


def extract_jsonld_jobs(config: ScraperConfig, soup: BeautifulSoup, list_page: dict[str, Any], stats: ScrapeStats) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for script in soup.select("script[type='application/ld+json']"):
        text = script.string or script.get_text(" ", strip=True)
        if not text:
            continue
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            continue
        for posting in walk_jsonld_postings(parsed):
            job = jsonld_to_job(config, posting, list_page)
            if job:
                jobs.append(job)
            else:
                stats.skip("jsonld posting missing required fields")
    return jobs


def walk_jsonld_postings(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, list):
        for item in value:
            yield from walk_jsonld_postings(item)
    elif isinstance(value, dict):
        item_type = value.get("@type")
        if item_type == "JobPosting" or (isinstance(item_type, list) and "JobPosting" in item_type):
            yield value
        for key in ("@graph", "itemListElement"):
            if key in value:
                yield from walk_jsonld_postings(value[key])


def jsonld_to_job(config: ScraperConfig, posting: dict[str, Any], list_page: dict[str, Any]) -> dict[str, Any] | None:
    title = clean_text(str(posting.get("title", "")))
    description = normalize_description(strip_html(str(posting.get("description", ""))))
    apply_url = get_jsonld_url(posting) or list_page["url"]
    location = get_jsonld_location(posting)
    if not title or not description or not apply_url:
        return None
    if not is_student_candidate(f"{title} {description}", apply_url):
        return None
    return build_job(config, title, location or "United States", description, apply_url, list_page, "beautifulsoup")


def extract_candidate_links(soup: BeautifulSoup, base_url: str, selector: str, stats: ScrapeStats) -> list[dict[str, str]]:
    items = soup.select(selector or "a[href]")
    if not items:
        items = soup.select("a[href]")

    links: list[dict[str, str]] = []
    for item in items:
        href = item.get("href") if hasattr(item, "get") else ""
        text = clean_text(item.get_text(" ", strip=True) if hasattr(item, "get_text") else "")
        url = urllib.parse.urljoin(base_url, str(href or ""))
        if not href:
            continue
        if not is_student_candidate(text, url):
            stats.skip("link lacks student signal")
            continue
        if is_blocked_url(url):
            stats.skip("blocked host")
            continue
        links.append({"url": url, "titleHint": text})
    stats.links_found += len(links)
    return links


def extract_script_links(soup: BeautifulSoup, base_url: str, stats: ScrapeStats) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    pattern = re.compile(r"https?://[^\"'\\\s]+|/[A-Za-z0-9_./?=&%+#-]*(?:job|career|position|opening)[A-Za-z0-9_./?=&%+#-]*", re.I)
    for script in soup.select("script"):
        text = script.string or script.get_text(" ", strip=True)
        if not text:
            continue
        for match in pattern.findall(text):
            url = urllib.parse.urljoin(base_url, unescape(match).replace("\\/", "/"))
            if is_blocked_url(url) or not is_student_candidate("", url):
                continue
            links.append({"url": url, "titleHint": ""})
    stats.links_found += len(links)
    return links


def hydrate_links(
    config: ScraperConfig,
    links: list[dict[str, str]],
    use_playwright: bool,
    list_page: dict[str, Any],
    stats: ScrapeStats,
    limit: int,
) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for link in links[:limit]:
        try:
            detail_html = fetch_text(link["url"])
            job = job_from_detail_html(config, detail_html, link, list_page, "playwright" if use_playwright else "beautifulsoup", stats)
            if job:
                jobs.append(job)
        except Exception:
            stats.skip("detail fetch failed")
            continue
    return jobs


async def hydrate_links_with_browser(
    browser: Any,
    config: ScraperConfig,
    links: list[dict[str, str]],
    list_page: dict[str, Any],
    stats: ScrapeStats,
    limit: int,
) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    page = await browser.new_page(user_agent=DEFAULT_USER_AGENT)
    for link in links[:limit]:
        try:
            await page.goto(link["url"], wait_until="domcontentloaded", timeout=25000)
            await page.wait_for_timeout(700)
            detail_html = await page.content()
            job = job_from_detail_html(config, detail_html, link, list_page, "playwright", stats)
            if job:
                jobs.append(job)
        except Exception:
            stats.skip("playwright detail fetch failed")
            continue
    await page.close()
    return jobs


def job_from_detail_html(
    config: ScraperConfig,
    detail_html: str,
    link: dict[str, str],
    list_page: dict[str, Any],
    extraction_method: str,
    stats: ScrapeStats,
) -> dict[str, Any] | None:
    soup = BeautifulSoup(detail_html, "html.parser")
    jsonld_jobs = extract_jsonld_jobs(config, soup, list_page, stats)
    if jsonld_jobs:
        job = jsonld_jobs[0]
        job["extractionMethod"] = extraction_method
        return job

    title = extract_title(config, soup, link["titleHint"])
    description = extract_description(soup, config.selectors.detail_body)
    location = extract_location(config, soup, description)
    apply_url = extract_apply_url(config, soup, link["url"])
    if not title or not location or not description:
        stats.skip("detail missing title, location, or description")
        return None
    if not is_student_candidate(f"{title} {description}", apply_url):
        stats.skip("detail outside student focus")
        return None
    return build_job(config, title, location, description, apply_url, list_page, extraction_method)


def build_job(
    config: ScraperConfig,
    title: str,
    location: str,
    description: str,
    apply_url: str,
    list_page: dict[str, Any],
    extraction_method: str,
) -> dict[str, Any]:
    return {
        "company": config.company,
        "title": clean_text(title),
        "location": clean_text(location) or "United States",
        "workType": infer_work_type(f"{title} {location} {description}"),
        "postedDate": current_date(),
        "sponsorshipFriendly": config.sponsorship_friendly,
        "competitionLevel": config.competition_level,
        "skills": [],
        "description": normalize_description(description),
        "applyUrl": apply_url,
        "sourceUrl": apply_url,
        "sourceJobId": stable_id(apply_url),
        "rawLocation": clean_text(location) or "United States",
        "sourceCategory": config.category,
        "scrapedAt": current_iso(),
        "extractionMethod": extraction_method,
        "searchTerm": list_page.get("searchTerm", ""),
        "listPage": list_page.get("listPage", 1),
        "listUrl": list_page.get("url", ""),
    }


def extract_title(config: ScraperConfig, soup: BeautifulSoup, fallback: str) -> str:
    selectors = [config.selectors.title, "h1", "[data-testid*='title']", "[class*='title']"]
    for selector in selectors:
        if not selector:
            continue
        node = soup.select_one(selector)
        text = clean_text(node.get_text(" ", strip=True)) if node else ""
        if text and len(text) <= 180:
            return text
    return clean_text(fallback).split("|")[0][:180]


def extract_description(soup: BeautifulSoup, selector: str) -> str:
    node = soup.select_one(selector or "main") or soup.body
    if not node:
        return ""
    for tag in node.select("script, style, nav, footer, header, form"):
        tag.decompose()
    text = node.get_text("\n", strip=True)
    return normalize_description(text)


def extract_location(config: ScraperConfig, soup: BeautifulSoup, description: str) -> str:
    if config.selectors.location:
        node = soup.select_one(config.selectors.location)
        text = clean_text(node.get_text(" ", strip=True)) if node else ""
        if text:
            return text[:140]

    text = clean_text(soup.get_text(" ", strip=True))
    patterns = [
        r"\b(?:Location|Locations)\s*:?\s*([A-Z][A-Za-z .,-]+(?:United States|USA|Remote|Hybrid|CA|NY|TX|WA|AZ|IL|GA|NC|NJ|PA|MA|FL|OH|MI))",
        r"\b(Remote(?: - [A-Za-z ,]+)?|United States|San Francisco, CA|New York, NY|Seattle, WA|Austin, TX|Phoenix, AZ|Chicago, IL|Atlanta, GA)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return clean_text(match.group(1))[:140]
    if "remote" in description.lower():
        return "Remote"
    return "United States"


def extract_apply_url(config: ScraperConfig, soup: BeautifulSoup, fallback: str) -> str:
    if config.selectors.apply_url:
        node = soup.select_one(config.selectors.apply_url)
        href = node.get("href") if node else ""
        if href:
            return urllib.parse.urljoin(fallback, str(href))
    return fallback


def get_jsonld_url(posting: dict[str, Any]) -> str:
    value = posting.get("url") or posting.get("sameAs")
    if isinstance(value, str):
        return value
    identifier = posting.get("identifier")
    if isinstance(identifier, dict) and isinstance(identifier.get("value"), str):
        return identifier["value"]
    return ""


def get_jsonld_location(posting: dict[str, Any]) -> str:
    location = posting.get("jobLocation") or posting.get("applicantLocationRequirements")
    locations = location if isinstance(location, list) else [location]
    parts: list[str] = []
    for item in locations:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict):
            address = item.get("address")
            if isinstance(address, dict):
                parts.append(", ".join(str(address.get(key, "")) for key in ("addressLocality", "addressRegion", "addressCountry") if address.get(key)))
            elif item.get("name"):
                parts.append(str(item["name"]))
    return clean_text(", ".join(part for part in parts if part))[:140]


def is_student_candidate(text: str, url: str) -> bool:
    normalized = f"{text} {url}".lower()
    has_student_signal = any(term in normalized for term in STUDENT_TERMS)
    has_seniority = any(re.search(rf"\b{re.escape(term)}\b", normalized) for term in SENIORITY_TERMS)
    hard_experience = re.search(
        r"\b(?:[2-9]|[1-9]\d)\+?\s+years?\s+(?:of\s+)?(?:professional\s+|relevant\s+|work\s+|industry\s+)?experience\b",
        normalized,
    )
    return has_student_signal and not (has_seniority and not has_student_signal) and not (hard_experience and not has_student_signal)


def fetch_text(url: str) -> str:
    validate_allowed_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": DEFAULT_USER_AGENT, "Accept": "text/html,*/*"})
    with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 - allowlisted public URLs only
        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type and "text/plain" not in content_type:
            raise RuntimeError(f"Unsupported content type: {content_type}")
        return response.read().decode("utf-8", errors="ignore")


def validate_allowed_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    if parsed.scheme not in {"http", "https"} or not host:
        raise RuntimeError(f"Invalid careers URL: {url}")
    if is_blocked_url(url):
        raise RuntimeError(f"Blocked host for scraper policy: {host}")


def is_blocked_url(url: str) -> bool:
    lowered = url.lower()
    return any(blocked in lowered for blocked in BLOCKED_HOST_PARTS)


def robots_allows(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(robots_url)
    try:
        parser.read()
    except Exception:
        return True
    return parser.can_fetch(DEFAULT_USER_AGENT, url)


def post_payload(url: str, token: str, payload: dict[str, Any]) -> None:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-ingest-token": token,
            "User-Agent": DEFAULT_USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - configured Stealth endpoint
        sys.stderr.write(response.read().decode("utf-8", errors="ignore") + "\n")


def source_result(company: str, fetched_count: int, imported_count: int, skipped_count: int, error: str) -> dict[str, Any]:
    return {
        "company": company,
        "source": "company_careers",
        "fetchedCount": fetched_count,
        "importedCount": imported_count,
        "skippedCount": skipped_count,
        "error": error,
    }


def summary_result(config: ScraperConfig, stats: ScrapeStats, error: str) -> dict[str, Any]:
    return {
        "id": config.id,
        "company": config.company,
        "mode": config.mode,
        "pagesVisited": stats.pages_visited,
        "linksFound": stats.links_found,
        "jobsFound": stats.jobs_found,
        "skippedCount": stats.skipped_count,
        "skippedReasons": stats.skipped_reasons,
        "error": error,
    }


def dedupe_links(links: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    output: list[dict[str, str]] = []
    for link in links:
        key = link["url"]
        if key in seen:
            continue
        seen.add(key)
        output.append(link)
    return output


def dedupe_jobs(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for job in jobs:
        key = f"{job.get('company')}::{job.get('title')}::{job.get('applyUrl')}"
        if key in seen:
            continue
        seen.add(key)
        output.append(job)
    return output


def dedupe_strings(values: Any) -> list[str]:
    if not isinstance(values, list):
        return DEFAULT_SEARCH_TERMS
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            output.append(cleaned)
    return output or DEFAULT_SEARCH_TERMS


def infer_work_type(text: str) -> str:
    normalized = text.lower()
    if "remote" in normalized:
        return "Remote"
    if "hybrid" in normalized:
        return "Hybrid"
    return "On-site"


def normalize_description(text: str) -> str:
    lines = [clean_text(line) for line in unescape(text).splitlines()]
    lines = [line for line in lines if line]
    return "\n".join(lines)[:12000]


def strip_html(value: str) -> str:
    return BeautifulSoup(value, "html.parser").get_text("\n", strip=True)


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def stable_id(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


def current_date() -> str:
    return current_iso()[:10]


def current_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


if __name__ == "__main__":
    raise SystemExit(main())
