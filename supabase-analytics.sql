-- Supabase SQL Editor에서 한 번 실행합니다.
-- 실행 뒤 Authentication에서 관리자 사용자를 만들고, 마지막 INSERT의 UUID를 바꿔 실행하세요.

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event_type text not null check (event_type in ('section_visit', 'page_view', 'read_complete')),
  section text not null check (section in ('sayeon', 'malsseum', 'stones')),
  visitor_id uuid not null,
  session_id uuid not null,
  item_no text,
  item_title text,
  content_year text,
  path text not null
);

create index if not exists analytics_events_received_at_idx on public.analytics_events (received_at desc);
create index if not exists analytics_events_section_idx on public.analytics_events (section, event_type, received_at desc);
create index if not exists analytics_events_item_idx on public.analytics_events (section, item_no, event_type);

create table if not exists public.analytics_admin_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

alter table public.analytics_events enable row level security;
alter table public.analytics_admin_emails enable row level security;
revoke all on public.analytics_events from anon, authenticated;
revoke all on public.analytics_admin_emails from anon, authenticated;

create or replace function public.record_analytics_event(
  p_event_type text,
  p_section text,
  p_visitor_id uuid,
  p_session_id uuid,
  p_item_no text default null,
  p_item_title text default null,
  p_content_year text default null,
  p_path text default '/'
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event_type not in ('section_visit', 'page_view', 'read_complete') then
    raise exception 'invalid event type';
  end if;
  if p_section not in ('sayeon', 'malsseum', 'stones') then
    raise exception 'invalid section';
  end if;
  insert into public.analytics_events
    (event_type, section, visitor_id, session_id, item_no, item_title, content_year, path)
  values
    (p_event_type, p_section, p_visitor_id, p_session_id,
     left(p_item_no, 80), left(p_item_title, 300), left(p_content_year, 4), left(coalesce(p_path, '/'), 300));
end;
$$;

revoke all on function public.record_analytics_event(text,text,uuid,uuid,text,text,text,text) from public;
grant execute on function public.record_analytics_event(text,text,uuid,uuid,text,text,text,text) to anon, authenticated;

create or replace function public.get_analytics_dashboard(
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.analytics_admin_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) then
    raise exception '관리자 권한이 없습니다';
  end if;

  with filtered as (
    select * from public.analytics_events
    where received_at >= p_from and received_at < p_to
  ), section_rows as (
    select section,
      count(distinct visitor_id) filter (where event_type = 'section_visit') as visitors,
      count(*) filter (where event_type = 'page_view') as page_views,
      count(distinct visitor_id) filter (where event_type = 'page_view') as page_readers,
      count(*) filter (where event_type = 'read_complete') as completions,
      count(distinct visitor_id) filter (where event_type = 'read_complete') as completion_readers
    from filtered group by section
  ), top_rows as (
    select section, content_year, item_no, max(item_title) as item_title,
      count(*) filter (where event_type = 'page_view') as page_views,
      count(distinct visitor_id) filter (where event_type = 'page_view') as readers,
      count(*) filter (where event_type = 'read_complete') as completions
    from filtered
    where item_no is not null and event_type in ('page_view', 'read_complete')
    group by section, content_year, item_no
    order by page_views desc, completions desc
    limit 100
  ), daily_rows as (
    select timezone('Asia/Seoul', received_at)::date as day,
      count(distinct visitor_id) as visitors,
      count(*) filter (where event_type = 'page_view') as page_views,
      count(*) filter (where event_type = 'read_complete') as completions
    from filtered group by timezone('Asia/Seoul', received_at)::date order by day
  )
  select jsonb_build_object(
    'totalVisitors', (select count(distinct visitor_id) from filtered),
    'totalSessions', (select count(distinct session_id) from filtered),
    'pageViews', (select count(*) from filtered where event_type = 'page_view'),
    'completions', (select count(*) from filtered where event_type = 'read_complete'),
    'sections', coalesce((select jsonb_agg(to_jsonb(section_rows) order by section) from section_rows), '[]'::jsonb),
    'topPages', coalesce((select jsonb_agg(to_jsonb(top_rows)) from top_rows), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(to_jsonb(daily_rows) order by day) from daily_rows), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_analytics_dashboard(timestamptz,timestamptz) from public;
grant execute on function public.get_analytics_dashboard(timestamptz,timestamptz) to authenticated;

-- 관리자 이메일을 소문자로 적고 주석을 풀어 실행합니다.
-- insert into public.analytics_admin_emails (email) values ('admin@example.com');
