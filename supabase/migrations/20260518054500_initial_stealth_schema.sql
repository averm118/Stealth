create type public.saved_job_status as enum ('saved', 'applied', 'interview', 'rejected', 'offer');

create table public.candidate_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null,
  resume_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.saved_jobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id text not null,
  status public.saved_job_status not null default 'saved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create table public.match_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id text not null,
  profile_hash text not null,
  analysis jsonb not null,
  source text not null default 'openrouter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, job_id, profile_hash)
);

create table public.jobs (
  id text primary key,
  company text not null,
  title text not null,
  location text not null,
  work_type text not null,
  posted_date date not null,
  sponsorship_friendly text not null default 'unknown',
  competition_level text not null default 'medium',
  skills text[] not null default '{}',
  description text not null,
  apply_url text not null,
  source text not null default 'manual',
  source_job_id text,
  source_url text,
  raw_location text,
  quality_warnings text[] not null default '{}',
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger candidate_profiles_set_updated_at
before update on public.candidate_profiles
for each row execute function public.set_updated_at();

create trigger saved_jobs_set_updated_at
before update on public.saved_jobs
for each row execute function public.set_updated_at();

create trigger match_scores_set_updated_at
before update on public.match_scores
for each row execute function public.set_updated_at();

create trigger jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

alter table public.candidate_profiles enable row level security;
alter table public.saved_jobs enable row level security;
alter table public.match_scores enable row level security;
alter table public.jobs enable row level security;

create policy "Users can read their candidate profile"
on public.candidate_profiles for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their candidate profile"
on public.candidate_profiles for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their candidate profile"
on public.candidate_profiles for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can read their saved jobs"
on public.saved_jobs for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their saved jobs"
on public.saved_jobs for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their saved jobs"
on public.saved_jobs for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their saved jobs"
on public.saved_jobs for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read their match scores"
on public.match_scores for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their match scores"
on public.match_scores for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their match scores"
on public.match_scores for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Authenticated users can read jobs"
on public.jobs for select
to authenticated
using (true);

create index saved_jobs_user_id_idx on public.saved_jobs(user_id);
create index match_scores_user_id_idx on public.match_scores(user_id);
create index jobs_company_idx on public.jobs(company);
