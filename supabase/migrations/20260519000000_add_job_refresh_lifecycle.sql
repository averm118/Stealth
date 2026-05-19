alter table public.jobs
add column if not exists first_seen_at timestamptz not null default now(),
add column if not exists last_seen_at timestamptz not null default now(),
add column if not exists closed_at timestamptz,
add column if not exists is_active boolean not null default true,
add column if not exists description_hash text;

update public.jobs
set
  first_seen_at = coalesce(first_seen_at, created_at, imported_at, now()),
  last_seen_at = coalesce(last_seen_at, imported_at, updated_at, now()),
  is_active = coalesce(is_active, true)
where first_seen_at is null
  or last_seen_at is null
  or is_active is null;

create table if not exists public.job_ingestion_runs (
  id bigint generated always as identity primary key,
  imported_at timestamptz not null default now(),
  imported_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  closed_count integer not null default 0,
  skipped_count integer not null default 0,
  source_results jsonb not null default '[]'::jsonb,
  warnings text[] not null default '{}',
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.job_ingestion_runs enable row level security;

drop policy if exists "Authenticated users can read job ingestion runs" on public.job_ingestion_runs;
create policy "Authenticated users can read job ingestion runs"
on public.job_ingestion_runs for select
to authenticated
using (true);

create index if not exists jobs_active_posted_date_idx
on public.jobs(is_active, posted_date desc);

create index if not exists jobs_source_company_active_idx
on public.jobs(source, company, is_active);

create index if not exists job_ingestion_runs_imported_at_idx
on public.job_ingestion_runs(imported_at desc);
