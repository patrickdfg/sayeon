-- Supabase SQL Editor 에서 이것 하나만 실행한다(2026-10-14: 하루 호출 한도 없음, 10초 간격만 유지).
-- 기존 사용 기록 표는 그대로 두고 호출 수는 계속 센다. 앞서 만든 표가 있어야 한다(ai-lab-quota.sql).
create or replace function public.ai_lab_model_quota(p_client uuid default null,p_provider text default null,p_reserve boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
 v_uid uuid;
 v_day date := timezone('Asia/Seoul',now())::date;
 v_used integer := 0;
 v_total integer := 0;
 v_last timestamptz;
 v_reason text := '';
 v_provider_used integer := 0;
 v_gemini integer := 0;
 v_groq integer := 0;
 v_common integer;
 v_providers jsonb;
begin
 if auth.role()='service_role' then v_uid:=p_client;
 elsif auth.role()='authenticated' and exists(select 1 from public.analytics_admin_emails where email=lower(coalesce(auth.jwt()->>'email',''))) then
  v_uid:=auth.uid();
  if p_client is not null and p_client is distinct from v_uid then raise exception '사용자 식별 불일치'; end if;
 else raise exception '서버 또는 관리자 권한이 필요합니다'; end if;
 if v_uid is null then raise exception '사용자 식별이 필요합니다'; end if;
 if (p_provider is not null and p_provider not in ('gemini','groq')) or (p_reserve and p_provider is null) then raise exception '허용되지 않은 업체'; end if;
 perform pg_advisory_xact_lock(71183225001::bigint);
 select attempts,last_at into v_used,v_last from public.ai_lab_daily_usage where usage_date=v_day and user_id=v_uid;
 v_used:=coalesce(v_used,0);
 select coalesce(sum(attempts),0) into v_total from public.ai_lab_daily_usage where usage_date=v_day;
 select coalesce(sum(attempts) filter(where provider='gemini'),0),coalesce(sum(attempts) filter(where provider='groq'),0)
 into v_gemini,v_groq from public.ai_lab_provider_usage where usage_date=v_day and user_id=v_uid;
 v_provider_used:=case p_provider when 'gemini' then v_gemini when 'groq' then v_groq else 0 end;
 -- 2026-10-14 사용자 결정: 하루 호출 한도는 두지 않는다. 연달아 보내는 것을 막는 10초 간격만 둔다.
 if p_reserve and v_last is not null and v_last>now()-interval '10 seconds' then v_reason:='rate'; end if;
 if p_reserve and v_reason='' then
  insert into public.ai_lab_daily_usage(usage_date,user_id,attempts,last_at) values(v_day,v_uid,1,now())
  on conflict(usage_date,user_id) do update set attempts=ai_lab_daily_usage.attempts+1,last_at=now();
  insert into public.ai_lab_provider_usage(usage_date,user_id,provider,attempts) values(v_day,v_uid,p_provider,1)
  on conflict(usage_date,user_id,provider) do update set attempts=ai_lab_provider_usage.attempts+1;
  v_used:=v_used+1;v_total:=v_total+1;
  if p_provider='gemini' then v_gemini:=v_gemini+1;else v_groq:=v_groq+1;end if;
 end if;
 v_common:=999999;   -- '제한 없음' 표시용 큰 수(예전 서버 코드가 정수를 기대한다)
 v_providers:=jsonb_build_object(
  'gemini',jsonb_build_object('used',v_gemini,'limit',null,'remaining',null),
  'groq',jsonb_build_object('used',v_groq,'limit',null,'remaining',null));
 return jsonb_build_object('allowed',v_reason='','reason',v_reason,'used',v_used,'remaining',v_common,'day',v_day,
  'globalRemaining',null,'globalLimit',null,'unassignedUsed',greatest(0,v_used-v_gemini-v_groq),'providers',v_providers);
end; $$;
revoke all on function public.ai_lab_model_quota(uuid,text,boolean) from public,anon;
grant execute on function public.ai_lab_model_quota(uuid,text,boolean) to authenticated,service_role;
