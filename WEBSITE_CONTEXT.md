# Stealth Website Context

## Product

Stealth is an AI Internship Radar for students. It helps students upload a resume, generate a concise candidate profile, discover relevant internships/jobs, understand fit scores, and track applications.

The current app is a polished MVP using Supabase-backed user state and an approved public jobs ingestion foundation. It is designed to feel like a calm, premium startup product rather than a heavy AI dashboard.

Current repository status:
- Local git repo initialized.
- GitHub remote: `https://github.com/averm118/Stealth.git`
- Main branch pushed to GitHub.
- Initial commit: `262dd02 Initial Stealth MVP`

## Current Design Direction

The active visual identity is ultra-minimal and light-mode first.

Design references:
- Apple
- Linear
- Raycast
- Notion
- Stripe
- Arc Browser

Design principles:
- Off-white background
- Soft blue/purple accent
- Large whitespace
- Minimal copy
- Rounded floating panels
- Subtle borders
- Soft shadows
- Calm motion
- Trustworthy, concise profile outputs
- Decision-focused pages
- List-first career workflows
- Editorial “brief” layouts for job intelligence

Avoid:
- Dark/cyberpunk styling
- Neon colors
- Dense dashboards
- Excessive chips
- Long generated profile text
- Cluttered AI-looking sections
- Heavy score rings as the primary visual language
- Large walls of filters or repeated job cards where a list is clearer

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn-style local UI primitives
- Framer Motion
- LocalStorage fallback for profile and saved job state
- Supabase auth and profile/tracker/match persistence
- Supabase `jobs` table as the intended job catalog source of truth
- Local JSON job ingestion cache as fallback when Supabase jobs are empty or unavailable
- Resume parsing API route for uploads
- Google Gemini API integration for AI candidate profile extraction
- Google Gemini API integration for job-detail AI analysis and application strategy
- Shared deterministic Gemini client with task-specific model routing, timeout, retry, and strict JSON parsing
- Approved public job-feed ingestion foundation

## Main Routes

- `/`  
  Premium landing page with hero, animated dashboard mockup, feature sections, and CTA.

- `/dashboard`  
  Personalized job radar with resume-derived role lanes. Jobs are grouped into action-oriented sections:
  - `Apply now`
  - `Strong matches`
  - `Explore next`
  
  The page includes search, role-lane tabs, work type filtering, sponsorship filtering, recency filtering, catalog stats, a compact radar health side panel, and a recommendation note. It intentionally avoids a dense card grid.

- `/profile`  
  Resume upload and generated candidate profile. This is currently upload-only and intentionally minimal.

- `/jobs/[id]`  
  Minimal opportunity brief for one job. It includes a calm job summary, AI-assisted fit score, metadata, sponsorship/competition/status, application angle, why it fits, tracker controls, role skills, and apply link.

- `/saved`  
  Application tracker for saved jobs with status updates.

- `/settings`  
  Profile/settings and integration notes.

## Profile Page Current UX

The profile page has two aligned, same-height primary panels:

1. Resume panel
   - Heading: `Upload your resume`
   - Upload-only interface
   - Supported formats: PDF, DOCX, TXT, MD
   - No paste textarea
   - No sample button
   - No manual extract button
   - Sponsorship needed toggle
   - `Looking for` dropdown with:
     - Internship
     - Full-time job
     - Part-time job

2. Profile panel
   - Label: `Profile`
   - Short heading such as `Data Analyst profile`
   - Minimal profile summary generated from the latest resume
   - Minimal grouped rows:
     - Best fit, adapted to the selected `Looking for` value
     - Skills
     - Strong aspects
     - Visa
     - Looking for
   - Profile confidence block
   - Trust language: generated only from uploaded resume and sponsorship preference

The profile area should stay concise and trustworthy. Do not reintroduce long chip walls, personality sections, extraction notes, or overly verbose generated summaries.

## Dashboard Current UX

Main file:

- `components/job-board.tsx`

Current behavior:
- Uses the candidate profile and the normalized job catalog to deterministically rank opportunities.
- The catalog merges imported jobs from `data/ingested-jobs.json` with mock fallback jobs from `data/jobs.ts`.
- Displays a search input for roles, companies, and locations.
- Shows one focused `Top matches` list with role-lane filters.
- Uses compact list rows rather than large job cards.
- Each row shows rank, company logo, company, location, work type, posted date, title, deterministic match reason, match badges, details link, and save action.
- Right side shows a compact focus summary:
  - Profile direction
  - Search type
  - Ranking method
  - Radar guidance

Dashboard design intent:
- Personalized and calm.
- Fast to scan.
- Minimal and action-oriented.
- Avoid returning to a generic grid of oversized job cards.

## Job Detail Current UX

Main file:

- `app/jobs/[id]/page.tsx`

The job detail page has been redesigned as an `Opportunity brief`.

Current layout:
- Back link and subtle page label.
- Main opportunity panel with:
  - Company mark
  - Company name
  - Mock posting note
  - Large role title
  - Location, work type, and posted date
  - Large numeric fit score with a subtle progress bar
  - Fit label such as `Apply now`, `Strong fit`, `Review carefully`, or `Low fit`
  - AI analysis source label or fast-score loading state
  - AI-generated `Role brief` with only the most important job-description pointers
  - Original full cleaned job description behind a collapsed `View original description` interaction
  - Sponsorship, competition, and current tracker status
  - Apply button
  - Save to tracker button
  - `Refresh AI analysis` button
- `Application angle` panel with:
  - Strategy, generated as 1-2 concise sentences
  - Lead with
  - Mind the gap
  - Resume keywords
- Right-side sticky stack on desktop:
  - `Why it fits`
  - `Tracker`
  - `Role skills`

Design intent:
- Feel like a premium research note, not an AI-generated dashboard.
- Make the next action obvious.
- Keep evidence visible but compact.
- Use role skills as supporting detail, not the dominant page element.

Job-detail AI behavior:
- Main file: `app/api/jobs/score/route.ts`
- Shared Gemini helper: `lib/gemini.ts`
- AI version constants: `lib/ai-versions.ts`
- Job details call `/api/jobs/score` for the current job only.
- Dashboard does not call AI for every job; it continues using fast deterministic scores.
- AI score is cached in `localStorage` using `job id + profile hash + JOB_MATCH_VERSION`.
- Server also keeps an in-memory job analysis cache for unchanged job/profile/version requests during the current runtime.
- Cached analysis loads immediately when available.
- The job detail score is now an AI-rubric compatibility score based on the uploaded resume text, extracted profile, search type, sponsorship preference, and current job data.
- Job-detail AI receives the full normalized job description, not the shortened dashboard preview.
- The same job-detail AI response also returns `jobHighlights`, a concise set of role brief bullets extracted from the full description.
- The model scores five rubric factors:
  - skill fit
  - role fit
  - project evidence
  - sponsorship fit
  - competition readiness
- The server validates the model response and recomputes the final numeric score from the rubric factors.
- The server caps weak or unrelated role-category matches so generic overlap like Python/SQL cannot inflate a poor-fit role.
- The AI response includes confidence, resume-backed evidence, gaps, suggested keywords, concise reasoning, role brief highlights, and a 1-2 sentence application strategy.
- If no cache exists, the page shows the deterministic score while AI explanation loads.
- If Gemini fails, the endpoint returns deterministic fallback analysis with an `applicationStrategy`.
- Users can manually request fresh analysis with `Refresh AI analysis`.

## Resume Upload

Resume parsing is handled by:

- `app/api/resume/parse/route.ts`
- `lib/resume-structure.ts`

Supported formats:
- PDF via `pdf-parse`
- DOCX via `mammoth`
- TXT
- MD

The API extracts raw text, detects resume sections, and returns structured text. The client then calls `/api/profile/extract` to generate the candidate profile with Gemini.

## Candidate Extraction

Main files:

- `app/api/profile/extract/route.ts`
- `lib/ai.ts`

Current behavior:
- Server-side Gemini call using `GEMINI_API_KEY`.
- Supports task-specific models through `GEMINI_PROFILE_MODEL`, falling back to `GEMINI_MODEL`, then `GEMINI_FALLBACK_MODELS`.
- The current direct Gemini model is `gemini-3.5-flash`; it uses JSON response formatting with server-side validation and a plain-JSON retry when structured output is unavailable.
- Uses deterministic prompt instructions where supported plus a versioned prompt/cache key through `PROFILE_EXTRACTION_VERSION`.
- Strict JSON schema response for the `CandidateProfile` shape.
- Prompt asks the model to stay concise, evidence-backed, and avoid invented facts.
- The candidate profile now includes evidence fields:
  - `roleEvidence`
  - `skillEvidence`
  - `educationEvidence`
  - `confidenceNotes`
- Attaches the original resume text server-side after parsing the model response.
- Normalizes arrays, personality traits, confidence values, evidence fields, sponsorship preference, and looking-for preference before saving profile state.
- Server-side extraction cache keys include resume text, sponsorship preference, looking-for value, and `PROFILE_EXTRACTION_VERSION`.
- Falls back to the deterministic local extractor if Gemini fails during a demo.
- `lib/ai.ts` remains the local fallback and still provides alias-aware skill detection, target role inference, education extraction, experience focus extraction, sponsorship signal handling, and confidence logic.

Current reliability rules:
- Every target role and skill should be supported by resume evidence.
- Software roles require hard software evidence; Python/SQL alone is not enough.
- Supply chain, operations, procurement, logistics, inventory, forecasting, and planning evidence takes priority over generic analytics/software inference.
- Job-detail AI is one-job-at-a-time only. Radar does not call AI and does not show numeric compatibility ratings.
- Radar uses deterministic role, broad degree, looking-for, sponsorship, and freshness signals. It intentionally ignores profile skills and job skill arrays.
- Radar prefers internships, co-ops, university/student programs, new grad, early career, rotational/development programs, and entry-level analyst roles based on the selected search type.
- Jobs requiring 2+ years of professional experience should be excluded or heavily downgraded unless clearly labeled intern, new grad, early career, university/student, rotational, or development program.

## Job Data

Mock jobs live in:

- `data/jobs.ts`

Imported jobs live in:

- `data/ingested-jobs.json`

Manual demo imports live in:

- `data/manual-jobs/*.json`

The app reads jobs through:

- `lib/jobs.ts`

Server APIs:

- `GET /api/jobs`: returns the normalized job catalog.
- `GET /api/jobs/ingest?mode=full&batchSize=30`: Vercel Cron refresh endpoint, scheduled once daily at 08:00 UTC through `vercel.json` for Vercel Hobby compatibility.
- `POST /api/jobs/ingest`: manual refresh endpoint for local/admin use.
- `POST /api/jobs/import-scraped`: secured import endpoint for normalized BeautifulSoup/Playwright scraper output.
- `/api/jobs/ingest?mode=discover`: checks a Hobby-safe batch of Fortune 100 careers pages and stores supported ATS configs only.
- `/api/jobs/ingest?mode=full`: discovers supported ATS configs, then ingests approved plus discovered sources.
- Optional params: `batchSize` up to 50 and `forceCompany` for debugging one company.
- In production, ingestion accepts Vercel `CRON_SECRET` Bearer auth or `INGEST_ADMIN_TOKEN` through `x-ingest-token`.
- Scraped imports require `INGEST_ADMIN_TOKEN` through `x-ingest-token` in production.

Ingestion implementation:

- `lib/job-ingestion/source-registry.ts`: approved feed config.
- `lib/job-ingestion/fortune-targets.ts`: curated Fortune 100 discovery targets.
- `lib/job-ingestion/discovery.ts`: ATS discovery for Greenhouse, Lever, Ashby, and explicit Workday CXS career links.
- `lib/job-ingestion/connectors.ts`: Greenhouse, Lever, Ashby, and curated Workday public feed connectors.
- `lib/job-ingestion/normalization.ts`: provider-to-`Job` normalization, full-description cleaning, validation, role filtering, deterministic skill extraction, dedupe helpers, and UI conversion.
- `lib/job-ingestion/cache.ts`: local JSON cache read/write.
- `lib/job-ingestion/manual.ts`: manual JSON import support.
- `lib/job-ingestion/ingest.ts`: orchestration for approved, discovered, and manual jobs.
- `scripts/job_scraper/run.py`: external BeautifulSoup/Playwright worker for allowlisted company-owned careers pages, with search-term expansion, JSON-LD parsing, detail-page hydration, pagination/load-more support, and shard arguments.
- `.github/workflows/job-scraper.yml`: scheduled/manual GitHub Actions scraper job that runs every 6 hours across 4 shards and posts into `/api/jobs/import-scraped`.

Current ingestion policy:
- Approved connector types: Greenhouse, Lever, Ashby, curated/discovered Workday CXS feeds, manual JSON, and allowlisted `company_careers` scraper imports.
- Active default sources include curated Greenhouse, Lever, Ashby, manual JSON, and known Workday boards for tech, finance, retail, logistics, operations, AI/software, and manufacturing-heavy companies.
- Discovery inspects careers pages only to find supported public ATS board links/tokens. It does not scrape arbitrary job cards.
- Workday ingestion uses explicit host, tenant, and site config discovered from known `myworkdayjobs.com` career links or curated config; it does not scrape Workday HTML.
- Scraping is a supplemental path for company-owned public careers pages only. It does not scrape LinkedIn, Indeed, Handshake, Google Jobs, supported ATS pages, login pages, captcha pages, or blocked pages.
- Scraping respects robots.txt and emits warnings instead of bypassing anti-bot controls.
- Scraper configs live in `scripts/job_scraper/configs.json` and include company allowlist entries, search terms, per-company limits, list URL templates, optional static/Playwright selectors, and detail-body selectors.
- Scraper metadata is preserved in job quality warnings, including extraction method, search term, list page, and list URL.
- Ingestion is deterministic and does not call AI.
- Broad company feeds are filtered to student-relevant roles by title and exclude senior/manager/lead/principal/staff/director roles.
- Student-relevant import signals include internships, co-ops, university/student programs, new grad, early talent, campus, rotational/development programs, entry-level, and associate analyst roles.
- Non-student roles with hard 2+ year professional experience requirements are rejected during ingestion unless they include explicit student/new-grad/early-career signals.
- Workday boards query multiple student-first terms including intern, co-op, university, new grad, early career, graduate, and analyst.
- Source fetches use limited concurrency so one slow public board does not stall the whole refresh.
- Supabase jobs track `first_seen_at`, `last_seen_at`, `closed_at`, `is_active`, and `description_hash`.
- Supabase discovery tables: `discovered_job_sources` and `job_discovery_runs`.
- Supabase monitoring views include `active_jobs_by_source`, `active_scraped_jobs_by_company`, `last_seen_scraped_jobs`, and `scraper_freshness_by_company`.
- Successful source refreshes mark disappeared jobs inactive; failed sources do not close existing jobs.
- Each refresh is logged to `job_ingestion_runs`.

Each job includes:
- id
- company
- title
- location
- workType
- postedDate
- sponsorshipFriendly
- competitionLevel
- skills
- description
- applyUrl

The data includes roles across:
- Supply Chain Analyst
- Business Analyst
- Data Analyst
- Product Analyst
- Operations Analyst
- Procurement Intern
- AI/Software Intern

The app now has a public-source ingestion layer for approved APIs:
- Greenhouse public job board API
- Lever public postings API
- Ashby public job postings API
- Workday public CXS career-site endpoints for curated known boards

The active catalog target is 1000 normalized public postings. Supabase `jobs` writes require `SUPABASE_SERVICE_ROLE_KEY`; without it, ingestion still refreshes `data/ingested-jobs.json` and returns a warning.

## Scoring

Main file:

- `lib/scoring.ts`

Fit score considers:
- Skill overlap
- Target role match
- Sponsorship friendliness
- Competition level

Radar dashboard matching is deterministic and does not call `/api/jobs/rank`. Deterministic scoring remains available only for fallback/internal utility surfaces and is not shown as a dashboard compatibility rating.

Job detail scoring uses deeper AI compatibility analysis:
- Full parsed resume text
- Extracted candidate profile
- Looking-for preference
- Sponsorship preference
- Current job data
- Strict rubric response
- Server-side normalization and score validation

Job detail pages also show:
- Compatibility breakdown
- Resume evidence
- Gaps
- Suggested resume keywords
- Application angle
- Application strategy
- Fit label derived from score

## State Management

Main file:

- `components/app-state.tsx`

Stored in LocalStorage:
- Candidate profile
- Saved job statuses
- Search type preference through `profile.lookingFor`

Current app state is Supabase-backed for authenticated users.

Implemented Supabase pieces:
- Email/password auth through `/auth`
- Middleware protection for `/dashboard`, `/profile`, `/saved`, `/settings`, and `/jobs/*`
- Candidate profile persistence through `public.candidate_profiles`
- Tracker persistence through `public.saved_jobs`
- Job-detail AI analysis persistence through `public.match_scores`
- LocalStorage fallback remains for resilience and fast local hydration

Supabase migration:
- `supabase/migrations/20260518054500_initial_stealth_schema.sql`
- `supabase/migrations/20260518070500_add_job_source_category.sql`
- `supabase/migrations/20260519000000_add_job_refresh_lifecycle.sql`

Client/server helpers:
- `lib/supabase/client.ts`
- `lib/supabase/server.ts`
- `lib/supabase/middleware.ts`

Saved statuses:
- saved
- applied
- interview
- rejected
- offer

## UI Components

Core primitives:

- `components/ui/button.tsx`
- `components/ui/card.tsx`
- `components/ui/badge.tsx`
- `components/ui/input.tsx`
- `components/ui/textarea.tsx`

Shared app components:

- `components/app-shell.tsx`
- `components/job-card.tsx`
- `components/job-board.tsx`
- `components/score-ring.tsx`
- `components/motion-primitives.tsx`

Motion primitives include:
- Page transitions
- Reveal animations
- Staggered animations
- Floating background orbs
- Tilt panel
- Animated counters

Current note:
- `components/job-card.tsx` still exists as a reusable component, but the active dashboard uses list rows from `components/job-board.tsx`.
- `components/score-ring.tsx` still exists, but the current job detail page uses a large numeric score with a subtle progress bar.

## Development Notes

Run the app:

```bash
npm install
npm run dev
```

Required AI environment:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash
GEMINI_PROFILE_MODEL=gemini-3.5-flash
GEMINI_MATCH_MODEL=gemini-3.5-flash
GEMINI_FALLBACK_MODELS=gemini-3-flash-preview,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Build:

```bash
npm run build
```

AI reliability fixtures:

```bash
npm run test:ai
```

Repository:

```bash
git remote -v
git status
git push
```

Important local dev note:

If the app appears as raw HTML or unstyled links, the Next.js dev server is likely serving a stale `.next` cache after a production build. Fix by stopping `next dev`, deleting `.next`, and restarting:

```bash
rm -rf .next
npm run dev
```

## Future Work

Likely next steps:
- Add `SUPABASE_SERVICE_ROLE_KEY` locally/deployment-side so ingestion can upsert to Supabase `jobs`
- Add `CRON_SECRET` in Vercel so scheduled ingestion can call `/api/jobs/ingest`
- Add a profile onboarding flow after first sign-up
- Add account settings for password reset and email changes
- Add onboarding flow
- Add role preference controls
- Add location and work-type preferences
- Add profile editing, but keep the profile summary minimal
- Add tests for scoring, extraction, and resume parsing.
- Add empty states for no job matches after search.
- Add production deployment configuration.

## Product Tone

Stealth should feel:
- Intelligent
- Calm
- Premium
- Minimal
- Trustworthy
- Student-friendly
- More like a focused career OS than an AI chatbot/dashboard
