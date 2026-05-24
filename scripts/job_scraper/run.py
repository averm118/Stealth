#!/usr/bin/env python3
"""Allowlisted company-careers scraper for Stealth.

This supplements the official ATS ingestion pipeline. It only reads public,
company-owned careers pages configured in configs.json and emits normalized
records for the Next.js import endpoint.
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
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup


DEFAULT_CONFIG_PATH = Path(__file__).with_name("configs.json")
DEFAULT_USER_AGENT = os.environ.get("SCRAPER_USER_AGENT", "StealthJobRadar/1.0 (+https://stealth.local)")
BLOCKED_HOST_PARTS = (
    "linkedin.com",
    "indeed.com",
    "handshake",
    "google.com",
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
    "associate analyst",
    "analyst",
)
SENIORITY_TERMS = ("senior", "staff", "principal", "manager", "director", "lead")


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
    selectors: dict[str, str]


def main() -> int:
    args = parse_args()
    configs = load_configs(args.config)
    if args.company:
      wanted = args.company.lower()
      configs = [config for config in configs if wanted in config.company.lower() or wanted == config.id.lower()]
    configs = [config for config in configs if config.enabled]
    if args.batch_size:
      configs = configs[: args.batch_size]

    result = asyncio.run(scrape_configs(configs, args.limit_per_company, args.ignore_robots))
    payload = {
        "importedAt": current_iso(),
        "jobs": result["jobs"],
        "warnings": result["warnings"],
        "sourceResults": result["sourceResults"],
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
    parser.add_argument("--limit-per-company", type=int, default=int(os.environ.get("SCRAPER_LIMIT_PER_COMPANY", "60")))
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
                selectors=dict(item.get("selectors", {})),
            )
        )
    return configs


async def scrape_configs(configs: list[ScraperConfig], limit_per_company: int, ignore_robots: bool) -> dict[str, Any]:
    jobs: list[dict[str, Any]] = []
    warnings: list[str] = []
    source_results: list[dict[str, Any]] = []

    for config in configs:
        try:
            validate_allowed_url(config.careers_url)
            if not ignore_robots and not robots_allows(config.careers_url):
                raise RuntimeError("robots.txt disallows this careers URL")

            company_jobs = (
                await scrape_with_playwright(config, limit_per_company)
                if config.mode == "playwright"
                else scrape_static(config, limit_per_company)
            )
            jobs.extend(company_jobs)
            source_results.append(
                {
                    "company": config.company,
                    "source": "company_careers",
                    "fetchedCount": len(company_jobs),
                    "importedCount": len(company_jobs),
                    "skippedCount": 0,
                    "error": "",
                }
            )
            time.sleep(1.0)
        except Exception as exc:  # noqa: BLE001 - scraper should warn and continue
            message = f"{config.company}: {exc}"
            warnings.append(message)
            source_results.append(
                {
                    "company": config.company,
                    "source": "company_careers",
                    "fetchedCount": 0,
                    "importedCount": 0,
                    "skippedCount": 0,
                    "error": str(exc),
                }
            )

    return {"jobs": dedupe_jobs(jobs), "warnings": warnings, "sourceResults": source_results}


def scrape_static(config: ScraperConfig, limit: int) -> list[dict[str, Any]]:
    html = fetch_text(config.careers_url)
    soup = BeautifulSoup(html, "html.parser")
    links = extract_candidate_links(soup, config.careers_url, config.selectors.get("jobCard", "a"))
    return hydrate_links(config, links[:limit], use_playwright=False)


async def scrape_with_playwright(config: ScraperConfig, limit: int) -> list[dict[str, Any]]:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError("playwright is not installed. Run: python -m playwright install chromium") from exc

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(user_agent=DEFAULT_USER_AGENT)
        await page.goto(config.careers_url, wait_until="networkidle", timeout=30000)
        html = await page.content()
        await browser.close()

    soup = BeautifulSoup(html, "html.parser")
    links = extract_candidate_links(soup, config.careers_url, config.selectors.get("jobCard", "a"))
    return hydrate_links(config, links[:limit], use_playwright=True)


def extract_candidate_links(soup: BeautifulSoup, base_url: str, selector: str) -> list[dict[str, str]]:
    items = soup.select(selector or "a")
    if not items:
        items = soup.select("a[href]")

    links: list[dict[str, str]] = []
    for item in items:
        href = item.get("href") if hasattr(item, "get") else ""
        text = clean_text(item.get_text(" ", strip=True) if hasattr(item, "get_text") else "")
        url = urllib.parse.urljoin(base_url, str(href or ""))
        if not href or not is_student_candidate(text, url):
            continue
        if any(blocked in urllib.parse.urlparse(url).netloc.lower() for blocked in BLOCKED_HOST_PARTS):
            continue
        links.append({"url": url, "titleHint": text})

    return links


def hydrate_links(config: ScraperConfig, links: list[dict[str, str]], use_playwright: bool) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for link in links:
        try:
            detail_html = fetch_text(link["url"])
            soup = BeautifulSoup(detail_html, "html.parser")
            title = extract_title(soup, link["titleHint"])
            description = extract_description(soup, config.selectors.get("detailBody", "main"))
            location = extract_location(soup, description)
            if not title or not location or not description:
                continue
            if not is_student_candidate(f"{title} {description}", link["url"]):
                continue
            jobs.append(
                {
                    "company": config.company,
                    "title": title,
                    "location": location,
                    "workType": infer_work_type(f"{title} {location} {description}"),
                    "postedDate": current_date(),
                    "sponsorshipFriendly": config.sponsorship_friendly,
                    "competitionLevel": config.competition_level,
                    "skills": [],
                    "description": description,
                    "applyUrl": link["url"],
                    "sourceUrl": link["url"],
                    "sourceJobId": stable_id(link["url"]),
                    "rawLocation": location,
                    "sourceCategory": config.category,
                    "scrapedAt": current_iso(),
                    "extractionMethod": "playwright" if use_playwright else "beautifulsoup",
                }
            )
            time.sleep(0.5)
        except Exception:
            continue
    return jobs


def extract_title(soup: BeautifulSoup, fallback: str) -> str:
    for selector in ("h1", "[data-testid*='title']", "[class*='title']"):
        node = soup.select_one(selector)
        text = clean_text(node.get_text(" ", strip=True)) if node else ""
        if text and len(text) <= 140:
            return text
    return clean_text(fallback).split("|")[0][:140]


def extract_description(soup: BeautifulSoup, selector: str) -> str:
    node = soup.select_one(selector or "main") or soup.body
    if not node:
        return ""
    for tag in node.select("script, style, nav, footer, header, form"):
        tag.decompose()
    text = node.get_text("\n", strip=True)
    return normalize_description(text)


def extract_location(soup: BeautifulSoup, description: str) -> str:
    text = clean_text(soup.get_text(" ", strip=True))
    patterns = [
        r"\b(?:Location|Locations)\s*:?\s*([A-Z][A-Za-z .,-]+(?:United States|USA|Remote|Hybrid|CA|NY|TX|WA|AZ))",
        r"\b(Remote(?: - [A-Za-z ,]+)?|United States|San Francisco, CA|New York, NY|Seattle, WA|Austin, TX|Phoenix, AZ)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return clean_text(match.group(1))[:120]
    if "remote" in description.lower():
        return "Remote"
    return "United States"


def is_student_candidate(text: str, url: str) -> bool:
    normalized = f"{text} {url}".lower()
    has_student_signal = any(term in normalized for term in STUDENT_TERMS)
    has_seniority = any(re.search(rf"\b{re.escape(term)}\b", normalized) for term in SENIORITY_TERMS)
    hard_experience = re.search(r"\b(?:[2-9]|[1-9]\d)\+?\s+years?\s+(?:of\s+)?(?:professional\s+|relevant\s+|work\s+)?experience\b", normalized)
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
    if any(blocked in host for blocked in BLOCKED_HOST_PARTS):
        raise RuntimeError(f"Blocked host for scraper policy: {host}")


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
