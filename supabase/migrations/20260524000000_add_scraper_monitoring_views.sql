create or replace view public.active_jobs_by_source as
select
  source,
  count(*)::integer as active_count,
  max(last_seen_at) as latest_seen_at,
  max(imported_at) as latest_imported_at
from public.jobs
where is_active = true
group by source;

create or replace view public.active_scraped_jobs_by_company as
select
  company,
  count(*)::integer as active_count,
  max(posted_date) as newest_posted_date,
  max(last_seen_at) as latest_seen_at
from public.jobs
where is_active = true
  and source = 'company_careers'
group by company;

create or replace view public.last_seen_scraped_jobs as
select
  id,
  company,
  title,
  location,
  work_type,
  posted_date,
  apply_url,
  last_seen_at,
  quality_warnings
from public.jobs
where source = 'company_careers'
order by last_seen_at desc, posted_date desc;

create or replace view public.scraper_freshness_by_company as
select
  company,
  count(*) filter (where is_active = true)::integer as active_count,
  count(*) filter (where is_active = false)::integer as inactive_count,
  max(last_seen_at) as latest_seen_at,
  min(last_seen_at) filter (where is_active = true) as oldest_active_seen_at
from public.jobs
where source = 'company_careers'
group by company;
