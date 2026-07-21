create table if not exists public.waitlist_entries (
  id bigint generated always as identity primary key,
  email text not null unique,
  status text not null default 'joined' check (status in ('joined')),
  source text not null default 'landing_hero',
  joined_at timestamptz not null default now(),
  welcome_email_sent_at timestamptz,
  delivery_error text
);

alter table public.waitlist_entries enable row level security;

create index if not exists waitlist_entries_joined_at_idx
on public.waitlist_entries(joined_at desc);

comment on table public.waitlist_entries is
'Private pre-launch waitlist. Access is limited to trusted server-side service-role operations.';
