-- Supabase SQL Editor에서 실행. 키·질문·원고·답변은 저장하지 않는다.
create table if not exists public.ai_lab_daily_usage (
 usage_date date not null,
 user_id uuid not null,
 attempts integer not null default 0 check (attempts >= 0),
 last_at timestamptz,
 primary key (usage_date,user_id)
);
alter table public.ai_lab_daily_usage enable row level security;
revoke all on public.ai_lab_daily_usage from public, anon, authenticated;
create or replace function public.ai_lab_quota(p_reserve boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
 v_uid uuid := auth.uid();
 v_day date := timezone('Asia/Seoul',now())::date;
 v_used integer := 0;
 v_total integer := 0;
 v_last timestamptz;
 v_reason text := '';
begin
 if v_uid is null or not exists(select 1 from public.analytics_admin_emails where email=lower(coalesce(auth.jwt()->>'email',''))) then
  raise exception '관리자 권한이 없습니다';
 end if;
 -- Across all function instances, reserve under one transaction lock.
 perform pg_advisory_xact_lock(71183225001::bigint);
 select attempts,last_at into v_used,v_last from public.ai_lab_daily_usage where usage_date=v_day and user_id=v_uid;
 v_used := coalesce(v_used,0);
 select coalesce(sum(attempts),0) into v_total from public.ai_lab_daily_usage where usage_date=v_day;
 if v_used>=30 or v_total>=100 then v_reason:='daily';
 elsif p_reserve and v_last is not null and v_last > now()-interval '10 seconds' then v_reason:='rate'; end if;
 if p_reserve and v_reason='' then
  insert into public.ai_lab_daily_usage(usage_date,user_id,attempts,last_at) values(v_day,v_uid,1,now())
  on conflict (usage_date,user_id) do update set attempts=ai_lab_daily_usage.attempts+1,last_at=now();
  v_used:=v_used+1;v_total:=v_total+1;
 end if;
 return jsonb_build_object('allowed',v_reason='','reason',v_reason,'used',v_used,'remaining',greatest(0,least(30-v_used,100-v_total)),'day',v_day);
end; $$;
revoke all on function public.ai_lab_quota(boolean) from public,anon;
grant execute on function public.ai_lab_quota(boolean) to authenticated;

-- 공유 비밀번호는 Edge Function에서 검사한다. 이 RPC는 서버만 호출한다.
create or replace function public.ai_lab_public_quota(p_client uuid, p_reserve boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
 v_uid uuid := p_client;
 v_day date := timezone('Asia/Seoul',now())::date;
 v_used integer := 0;
 v_total integer := 0;
 v_last timestamptz;
 v_reason text := '';
begin
 if auth.role() is distinct from 'service_role' or v_uid is null then
  raise exception '서버 권한이 필요합니다';
 end if;
 -- Across all function instances, reserve under one transaction lock.
 perform pg_advisory_xact_lock(71183225001::bigint);
 select attempts,last_at into v_used,v_last from public.ai_lab_daily_usage where usage_date=v_day and user_id=v_uid;
 v_used := coalesce(v_used,0);
 select coalesce(sum(attempts),0) into v_total from public.ai_lab_daily_usage where usage_date=v_day;
 if v_used>=30 or v_total>=100 then v_reason:='daily';
 elsif p_reserve and v_last is not null and v_last > now()-interval '10 seconds' then v_reason:='rate'; end if;
 if p_reserve and v_reason='' then
  insert into public.ai_lab_daily_usage(usage_date,user_id,attempts,last_at) values(v_day,v_uid,1,now())
  on conflict (usage_date,user_id) do update set attempts=ai_lab_daily_usage.attempts+1,last_at=now();
  v_used:=v_used+1;v_total:=v_total+1;
 end if;
 return jsonb_build_object('allowed',v_reason='','reason',v_reason,'used',v_used,'remaining',greatest(0,least(30-v_used,100-v_total)),'day',v_day);
end; $$;
revoke all on function public.ai_lab_public_quota(uuid,boolean) from public,anon,authenticated;
grant execute on function public.ai_lab_public_quota(uuid,boolean) to service_role;
