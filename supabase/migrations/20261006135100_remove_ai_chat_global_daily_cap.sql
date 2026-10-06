create or replace function public.ai_lab_model_quota(p_client uuid default null,p_provider text default null,p_reserve boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
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
 elsif auth.role()='authenticated' and public.ai_chat_has_access() then
  v_uid:=substring(encode(extensions.digest('ai-lab-public:'||auth.uid()::text,'sha256'),'hex'),1,32)::uuid;
  if p_client is not null then raise exception '사용자 식별은 서버에서 결정합니다'; end if;
 else raise exception '승인된 Google 계정이 필요합니다' using errcode='42501'; end if;
 if v_uid is null then raise exception '사용자 식별이 필요합니다'; end if;
 if (p_provider is not null and p_provider not in ('gemini','groq')) or (p_reserve and p_provider is null) then raise exception '허용되지 않은 업체'; end if;
 perform pg_advisory_xact_lock(71183225001::bigint);
 -- Recheck after the lock: a revoked session cannot reserve a provider call.
 if auth.role()='authenticated' and not public.ai_chat_has_access() then raise exception '회원 승인이 취소되었습니다' using errcode='42501'; end if;
 select attempts,last_at into v_used,v_last from public.ai_lab_daily_usage where usage_date=v_day and user_id=v_uid;
 v_used:=coalesce(v_used,0);
 select coalesce(sum(attempts),0) into v_total from public.ai_lab_daily_usage where usage_date=v_day;
 select coalesce(sum(attempts) filter(where provider='gemini'),0),coalesce(sum(attempts) filter(where provider='groq'),0)
 into v_gemini,v_groq from public.ai_lab_provider_usage where usage_date=v_day and user_id=v_uid;
 v_provider_used:=case p_provider when 'gemini' then v_gemini when 'groq' then v_groq else 0 end;
 if v_used>=60 or (p_provider is not null and v_provider_used>=30) then v_reason:='daily';
 elsif p_reserve and v_last is not null and v_last>now()-interval '10 seconds' then v_reason:='rate'; end if;
 if p_reserve and v_reason='' then
  insert into public.ai_lab_daily_usage(usage_date,user_id,attempts,last_at) values(v_day,v_uid,1,now())
  on conflict(usage_date,user_id) do update set attempts=ai_lab_daily_usage.attempts+1,last_at=now();
  insert into public.ai_lab_provider_usage(usage_date,user_id,provider,attempts) values(v_day,v_uid,p_provider,1)
  on conflict(usage_date,user_id,provider) do update set attempts=ai_lab_provider_usage.attempts+1;
  v_used:=v_used+1;v_total:=v_total+1;
  if p_provider='gemini' then v_gemini:=v_gemini+1;else v_groq:=v_groq+1;end if;
 end if;
 v_common:=greatest(0,60-v_used);
 v_providers:=jsonb_build_object(
  'gemini',jsonb_build_object('used',v_gemini,'limit',30,'remaining',greatest(0,least(30-v_gemini,v_common))),
  'groq',jsonb_build_object('used',v_groq,'limit',30,'remaining',greatest(0,least(30-v_groq,v_common))));
 return jsonb_build_object('allowed',v_reason='','reason',v_reason,'used',v_used,'remaining',v_common,'day',v_day,
  'globalRemaining',null,'globalLimit',null,'unassignedUsed',greatest(0,v_used-v_gemini-v_groq),'providers',v_providers);
end; $$;
notify pgrst, 'reload schema';
