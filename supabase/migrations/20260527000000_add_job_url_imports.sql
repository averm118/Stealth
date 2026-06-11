create table if not exists public.job_url_imports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  job_id text references public.jobs(id) on delete set null,
  status text not null check (status in ('imported', 'needs_paste', 'error')),
  extraction_source text,
  warnings text[] not null default '{}',
  error text,
  created_at timestamptz not null default now()
);

alter table public.job_url_imports enable row level security;

drop policy if exists "Users can read their own job URL imports" on public.job_url_imports;
create policy "Users can read their own job URL imports"
on public.job_url_imports
for select
to authenticated
using (auth.uid() = user_id);

create index if not exists job_url_imports_user_created_idx
on public.job_url_imports (user_id, created_at desc);

create index if not exists job_url_imports_job_id_idx
on public.job_url_imports (job_id);
