# Stealth

Stealth is a full-stack-ready MVP for an AI Internship Radar. It helps students discover, score, and track internships/jobs based on resume uploads, skills, goals, and visa sponsorship needs.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui-style reusable primitives
- Supabase auth and persistence foundation with public API job ingestion fallback

## Features

- Premium light-mode landing page
- Personalized dashboard with resume-derived role lanes and list-based recommendations
- Resume profile page with PDF/DOCX/TXT/MD upload, structural text parsing, OpenRouter-powered profile extraction, sponsorship preference, and search type preference
- Job fit scoring from 0-100
- Job detail pages with AI-assisted scoring, application strategy, sponsorship, competition, fit explanations, missing skills, resume keywords, and apply links
- Saved jobs tracker with `saved`, `applied`, `interview`, `rejected`, and `offer` statuses
- Settings/profile page with integration notes
- Supabase-backed persistence for resume profile, saved jobs, and AI match scores, with localStorage as a browser fallback
- Server-side job ingestion from approved public Greenhouse, Lever, Ashby, curated Workday feeds, Fortune 100 ATS discovery, and allowlisted company-careers scraping, capped to a curated 1000-job radar

## Getting Started

Install dependencies:

```bash
npm install
```

Create `.env.local`:

```bash
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=nvidia/nemotron-3-nano-30b-a3b:free
OPENROUTER_PROFILE_MODEL=nvidia/nemotron-3-nano-30b-a3b:free
OPENROUTER_MATCH_MODEL=nvidia/nemotron-3-nano-30b-a3b:free
OPENROUTER_FALLBACK_MODELS=openrouter/free
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
CRON_SECRET=your_vercel_cron_secret
INGEST_ADMIN_TOKEN=your_optional_manual_ingest_token
SCRAPER_USER_AGENT=StealthJobRadar/1.0
SCRAPER_BATCH_SIZE=25
SCRAPER_LIMIT_PER_COMPANY=60
```

`OPENROUTER_FALLBACK_MODELS` is optional. It accepts one model or a comma-separated list. Stealth tries these only if the primary task model fails, rate-limits, or returns malformed JSON.

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Refresh the public job ingestion cache and Supabase jobs table manually in development:

```bash
curl -X POST http://localhost:3000/api/jobs/ingest
```

Discover supported Fortune 100 ATS boards without ingesting jobs:

```bash
curl -X POST "http://localhost:3000/api/jobs/ingest?mode=discover&batchSize=30"
```

Discover and ingest in one admin run:

```bash
curl -X POST "http://localhost:3000/api/jobs/ingest?mode=full&batchSize=30"
```

Read the normalized job catalog:

```bash
curl http://localhost:3000/api/jobs
```

Production ingestion is scheduled by Vercel Cron once daily at 08:00 UTC through `vercel.json`, which keeps the app compatible with Vercel Hobby. The cron calls `GET /api/jobs/ingest?mode=full&batchSize=30`, so each run discovers a rotating Fortune 100 batch and then refreshes approved plus discovered feeds. Set `CRON_SECRET` in Vercel so the cron request can authenticate with a Bearer token. Manual production refreshes can also be protected with:

```bash
INGEST_ADMIN_TOKEN=your_internal_token
```

Then call `POST /api/jobs/ingest` with `x-ingest-token`. Ingestion keeps up to 1000 active jobs, marks disappeared roles inactive after successful source refreshes, stores supported discovered ATS boards in `discovered_job_sources`, and records refresh/discovery history in `job_ingestion_runs` and `job_discovery_runs`.

Allowlisted company-careers scraping runs outside Vercel, normally in GitHub Actions, so Playwright does not burden Hobby functions. Add GitHub repository secrets:

```bash
STEALTH_APP_URL=https://your-vercel-domain.vercel.app
INGEST_ADMIN_TOKEN=your_internal_token
```

Run the scraper locally for one configured company:

```bash
python3 -m pip install -r scripts/job_scraper/requirements.txt
python3 -m playwright install chromium
python3 scripts/job_scraper/run.py --company Apple --output scraped-jobs.json
```

Post scraped jobs into Supabase through Stealth:

```bash
python3 scripts/job_scraper/run.py \
  --post-url "$NEXT_PUBLIC_APP_URL/api/jobs/import-scraped" \
  --token "$INGEST_ADMIN_TOKEN"
```

## Project Structure

- `app/` - App Router pages and layout
- `components/` - Reusable shell, cards, controls, and UI primitives
- `data/jobs.ts` - Mock internship/job dataset
- `data/ingested-jobs.json` - Generated local ingestion cache
- `data/discovered-job-sources.json` - Generated local ATS discovery cache
- `data/manual-jobs/` - Manual JSON job imports for demo control
- `app/api/profile/extract/route.ts` - OpenRouter candidate profile extraction route
- `app/api/profile/route.ts` - Supabase candidate profile read/write route
- `app/api/saved-jobs/route.ts` - Supabase saved job tracker route
- `app/api/jobs/route.ts` - Normalized job catalog route
- `app/api/jobs/ingest/route.ts` - Public source ingestion refresh route
- `app/api/jobs/import-scraped/route.ts` - Secured import route for allowlisted scraper output
- `app/api/jobs/score/route.ts` - OpenRouter job-detail scoring and application strategy route
- `lib/ai.ts` - Local fallback candidate profile extraction
- `lib/openrouter.ts` - Shared deterministic OpenRouter JSON client with timeout and retry handling
- `lib/ai-versions.ts` - AI prompt/cache version constants
- `lib/jobs.ts` - Single server-side job catalog access point
- `lib/job-ingestion/` - Source connectors, registry, Fortune 100 ATS discovery, normalizers, validation, cache, and manual import support
- `scripts/job_scraper/` - BeautifulSoup/Playwright scraper worker for allowlisted company-owned careers pages
- `lib/supabase/` - Browser, server, and middleware Supabase clients
- `lib/resume-structure.ts` - Resume section detection and structured text formatting
- `lib/scoring.ts` - Job match scoring utilities
- `lib/types.ts` - Shared TypeScript types
- `tests/fixtures/` and `scripts/ai-evaluation.mjs` - Lightweight AI reliability regression fixtures

## Future Integration Points

- Improve extraction prompts and model selection for higher profile accuracy.
- Move more job sources into the approved registry after validating board tokens.
- Add more approved public boards after validating source quality.
- Add billing only after core matching and tracking workflows are validated.
