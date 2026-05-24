create table if not exists public.discovered_job_sources (
  id text primary key,
  company text not null,
  source text not null,
  board_token text,
  workday jsonb,
  category text not null,
  sponsorship_friendly text not null default 'unknown',
  competition_level text not null default 'medium',
  discovered_from_url text not null,
  discovered_at timestamptz not null default now(),
  status text not null default 'supported',
  warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists discovered_job_sources_set_updated_at on public.discovered_job_sources;
create trigger discovered_job_sources_set_updated_at
before update on public.discovered_job_sources
for each row execute function public.set_updated_at();

alter table public.discovered_job_sources enable row level security;

drop policy if exists "Authenticated users can read discovered job sources" on public.discovered_job_sources;
create policy "Authenticated users can read discovered job sources"
on public.discovered_job_sources for select
to authenticated
using (true);

create table if not exists public.job_discovery_runs (
  id bigint generated always as identity primary key,
  discovered_at timestamptz not null default now(),
  checked_count integer not null default 0,
  discovered_count integer not null default 0,
  unsupported_count integer not null default 0,
  failed_count integer not null default 0,
  results jsonb not null default '[]'::jsonb,
  warnings text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.job_discovery_runs enable row level security;

drop policy if exists "Authenticated users can read job discovery runs" on public.job_discovery_runs;
create policy "Authenticated users can read job discovery runs"
on public.job_discovery_runs for select
to authenticated
using (true);

create index if not exists discovered_job_sources_status_idx
on public.discovered_job_sources(status);

create index if not exists discovered_job_sources_source_company_idx
on public.discovered_job_sources(source, company);

create index if not exists discovered_job_sources_discovered_at_idx
on public.discovered_job_sources(discovered_at desc);

create index if not exists job_discovery_runs_discovered_at_idx
on public.job_discovery_runs(discovered_at desc);
