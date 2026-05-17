# Stealth

Stealth is a full-stack-ready MVP for an AI Internship Radar. It helps students discover, score, and track internships/jobs based on resume text, skills, goals, and visa sponsorship needs.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui-style reusable primitives
- Supabase-ready architecture with mock/local data for the MVP

## Features

- Premium dark landing page
- Dashboard with 25 realistic internship and early-career job cards
- Resume profile page with PDF/DOCX/TXT/MD upload, structural text parsing, and local AI-style extraction placeholder
- Job fit scoring from 0-100
- Job detail pages with sponsorship, competition, fit explanations, missing skills, resume keywords, and apply links
- Saved jobs tracker with `saved`, `applied`, `interview`, `rejected`, and `offer` statuses
- Settings/profile page with integration notes
- LocalStorage persistence for resume profile and saved jobs

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

- `app/` - App Router pages and layout
- `components/` - Reusable shell, cards, controls, and UI primitives
- `data/jobs.ts` - Mock internship/job dataset
- `lib/ai.ts` - Placeholder candidate profile extraction
- `lib/resume-structure.ts` - Resume section detection and structured text formatting
- `lib/scoring.ts` - Job match scoring utilities
- `lib/types.ts` - Shared TypeScript types

## Future Integration Points

- Replace `lib/ai.ts` with OpenAI/Claude structured extraction.
- Add Supabase auth and persist profiles, saved jobs, and match scores.
- Replace mock jobs with approved APIs, partner feeds, or a compliant ingestion pipeline.
- Add billing only after core matching and tracking workflows are validated.
