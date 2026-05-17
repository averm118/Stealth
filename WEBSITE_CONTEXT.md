# Stealth Website Context

## Product

Stealth is an AI Internship Radar for students. It helps students upload a resume, generate a concise candidate profile, discover relevant internships/jobs, understand fit scores, and track applications.

The current app is a polished MVP using mock/local data. It is designed to feel like a calm, premium startup product rather than a heavy AI dashboard.

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

Avoid:
- Dark/cyberpunk styling
- Neon colors
- Dense dashboards
- Excessive chips
- Long generated profile text
- Cluttered AI-looking sections

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn-style local UI primitives
- Framer Motion
- LocalStorage for profile and saved job state
- Mock job data
- Supabase-ready structure, not yet connected
- Resume parsing API route for uploads

## Main Routes

- `/`  
  Premium landing page with hero, animated dashboard mockup, feature sections, and CTA.

- `/dashboard`  
  Job radar with stats, animated chart placeholders, filters, search, and job cards.

- `/profile`  
  Resume upload and generated candidate profile. This is currently upload-only and intentionally minimal.

- `/jobs/[id]`  
  Job detail page with fit score, metadata, why it matches, missing skills, keywords, status controls, and apply link.

- `/saved`  
  Application tracker for saved jobs with status updates.

- `/settings`  
  Profile/settings and integration notes.

## Profile Page Current UX

The profile page has two primary panels:

1. Resume panel
   - Heading: `Upload your resume`
   - Upload-only interface
   - Supported formats: PDF, DOCX, TXT, MD
   - No paste textarea
   - No sample button
   - No manual extract button
   - Sponsorship needed toggle

2. Profile panel
   - Label: `Profile`
   - Short heading such as `Data Analyst profile`
   - Confidence pill
   - Minimal rows:
     - Best fit
     - Skills
     - Evidence
     - Visa
   - Trust note: generated from uploaded resume and sponsorship preference

The profile area should stay concise and trustworthy. Do not reintroduce long chip walls, personality sections, extraction notes, or overly verbose generated summaries.

## Resume Upload

Resume parsing is handled by:

- `app/api/resume/parse/route.ts`
- `lib/resume-structure.ts`

Supported formats:
- PDF via `pdf-parse`
- DOCX via `mammoth`
- TXT
- MD

The API extracts raw text, detects resume sections, and returns structured text. The client then calls the local candidate extractor.

## Candidate Extraction

Main file:

- `lib/ai.ts`

Current behavior:
- Deterministic local placeholder
- Alias-aware skill detection
- Target role inference
- Education extraction
- Experience focus extraction
- Sponsorship signal handling
- Confidence logic used by the UI

Future AI integration:
- Replace `extractCandidateProfile` with OpenAI/Claude structured output.
- Keep the output concise and evidence-backed.
- Preserve user trust by showing only high-confidence, resume-grounded signals.

## Job Data

Mock jobs live in:

- `data/jobs.ts`

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

## Scoring

Main file:

- `lib/scoring.ts`

Fit score considers:
- Skill overlap
- Target role match
- Sponsorship friendliness
- Competition level

Job detail pages also show:
- Why this matches
- Missing skills
- Suggested resume keywords

## State Management

Main file:

- `components/app-state.tsx`

Stored in LocalStorage:
- Candidate profile
- Saved job statuses

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

## Development Notes

Run the app:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Important local dev note:

If the app appears as raw HTML or unstyled links, the Next.js dev server is likely serving a stale `.next` cache after a production build. Fix by stopping `next dev`, deleting `.next`, and restarting:

```bash
rm -rf .next
npm run dev
```

## Future Work

Likely next steps:
- Add Supabase auth
- Persist uploaded resumes and extracted profiles
- Persist saved jobs and match scores
- Replace mock jobs with approved job feeds/APIs
- Replace placeholder extraction with LLM structured output
- Add onboarding flow
- Add role preference controls
- Add location and work-type preferences
- Add profile editing, but keep the profile summary minimal

## Product Tone

Stealth should feel:
- Intelligent
- Calm
- Premium
- Minimal
- Trustworthy
- Student-friendly
- More like a focused career OS than an AI chatbot/dashboard

