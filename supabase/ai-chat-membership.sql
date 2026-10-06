-- Google signup requires an explicit administrator decision. No password/key storage.
create schema if not exists ai_chat_private;
revoke all on schema ai_chat_private from public,anon;
grant usage on schema ai_chat_private to authenticated;

create table public.ai_chat_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected','revoked')),
 requested_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id) on delete set null,
 revision bigint not null default 0
);
create index ai_chat_members_status_requested_idx on public.ai_chat_members(status,requested_at,user_id);
alter table public.ai_chat_members enable row level security;
create policy ai_chat_members_no_direct_access on public.ai_chat_members for all to authenticated using(false) with check(false);
revoke all on public.ai_chat_members from public,anon,authenticated;
create table public.ai_chat_member_reviews (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 reviewer_id uuid references auth.users(id) on delete set null,
 previous_status text not null,
 status text not null,
 reviewed_at timestamptz not null default now()
);
create index ai_chat_member_reviews_user_idx on public.ai_chat_member_reviews(user_id);
create index ai_chat_member_reviews_reviewer_idx on public.ai_chat_member_reviews(reviewer_id);
create index ai_chat_members_reviewer_idx on public.ai_chat_members(reviewed_by);
alter table public.ai_chat_member_reviews enable row level security;
create policy ai_chat_reviews_no_direct_access on public.ai_chat_member_reviews for all to authenticated using(false) with check(false);
revoke all on public.ai_chat_member_reviews from public,anon,authenticated;

-- Read identity/confirmation from Auth, never from editable user metadata or a client email.
create function ai_chat_private.ai_chat_is_google_user() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and auth.role()='authenticated'
 and exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null
   and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()))
 and exists(select 1 from auth.identities i where i.user_id=auth.uid() and i.provider='google');
$$;
create function ai_chat_private.ai_chat_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select ai_chat_private.ai_chat_is_google_user() and exists(
  select 1 from auth.users u join public.analytics_admin_emails a on a.email=lower(u.email) where u.id=auth.uid());
$$;
create function ai_chat_private.ai_chat_has_access() returns boolean language sql stable security definer set search_path='' as $$
 select ai_chat_private.ai_chat_is_google_user() and (ai_chat_private.ai_chat_is_admin() or exists(
  select 1 from public.ai_chat_members m where m.user_id=auth.uid() and m.status='approved'));
$$;

create function ai_chat_private.ai_chat_membership() returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.ai_chat_members; admin boolean;
begin
 if not ai_chat_private.ai_chat_is_google_user() then raise exception '확인된 Google 계정으로 로그인해 주세요' using errcode='42501'; end if;
 admin:=ai_chat_private.ai_chat_is_admin();
 insert into public.ai_chat_members(user_id,status) values(auth.uid(),case when admin then 'approved' else 'pending' end)
 on conflict(user_id) do nothing;
 select * into m from public.ai_chat_members where user_id=auth.uid();
 return jsonb_build_object('status',case when admin then 'approved' else m.status end,
  'approved',admin or m.status='approved','isAdmin',admin,'revision',m.revision);
end; $$;

create function ai_chat_private.ai_chat_list_members(p_status text default 'pending',p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not ai_chat_private.ai_chat_is_admin() then raise exception '관리자 권한이 필요합니다' using errcode='42501'; end if;
 if p_status not in ('pending','approved','rejected','revoked','all') or p_status is null
 or p_offset is null or p_offset<0 or p_offset>100000 then raise exception '목록 조건을 확인해 주세요'; end if;
 return coalesce((select jsonb_agg(to_jsonb(rows)) from (
  select m.user_id,m.status,m.requested_at,m.reviewed_at,m.revision,u.email,
   left(coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',''),100) as display_name,
   exists(select 1 from public.analytics_admin_emails a where a.email=lower(u.email)) as is_admin
  from public.ai_chat_members m join auth.users u on u.id=m.user_id
  where p_status='all' or m.status=p_status
  order by m.requested_at desc,m.user_id limit 50 offset p_offset
 ) rows),'[]'::jsonb);
end; $$;

create function ai_chat_private.ai_chat_review_member(p_user_id uuid,p_status text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.ai_chat_members;
begin
 if not ai_chat_private.ai_chat_is_admin() then raise exception '관리자 권한이 필요합니다' using errcode='42501'; end if;
 if p_status is null or p_status not in ('approved','rejected','revoked') then raise exception '승인 상태를 확인해 주세요'; end if;
 if p_user_id=auth.uid() or exists(select 1 from auth.users u join public.analytics_admin_emails a on a.email=lower(u.email) where u.id=p_user_id) then
  raise exception '기존 관리자 권한은 회원 승인 화면에서 변경할 수 없습니다'; end if;
 select * into m from public.ai_chat_members where user_id=p_user_id for update;
 if not found or p_revision is null or m.revision<>p_revision then raise exception '다른 관리자가 변경했습니다. 목록을 새로고침해 주세요' using errcode='40001'; end if;
 if m.status=p_status then return jsonb_build_object('status',m.status,'revision',m.revision); end if;
 if (p_status='rejected' and m.status<>'pending') or (p_status='revoked' and m.status<>'approved') then raise exception '현재 상태에서 할 수 없는 변경입니다'; end if;
 update public.ai_chat_members set status=p_status,reviewed_at=now(),reviewed_by=auth.uid(),revision=revision+1 where user_id=p_user_id;
 insert into public.ai_chat_member_reviews(user_id,reviewer_id,previous_status,status) values(p_user_id,auth.uid(),m.status,p_status);
 return jsonb_build_object('status',p_status,'revision',m.revision+1);
end; $$;

revoke all on function ai_chat_private.ai_chat_is_google_user(),ai_chat_private.ai_chat_is_admin(),ai_chat_private.ai_chat_has_access(),ai_chat_private.ai_chat_membership(),
 ai_chat_private.ai_chat_list_members(text,integer),ai_chat_private.ai_chat_review_member(uuid,text,bigint) from public,anon,authenticated;
grant execute on function ai_chat_private.ai_chat_is_google_user(),ai_chat_private.ai_chat_is_admin(),ai_chat_private.ai_chat_has_access(),ai_chat_private.ai_chat_membership(),
 ai_chat_private.ai_chat_list_members(text,integer),ai_chat_private.ai_chat_review_member(uuid,text,bigint) to authenticated;

-- Only narrow invoker wrappers are exposed as RPCs; privileged implementations live in a private schema.
create or replace function public.ai_chat_is_google_user() returns boolean language sql stable security invoker set search_path='' as $$ select ai_chat_private.ai_chat_is_google_user(); $$;
create or replace function public.ai_chat_is_admin() returns boolean language sql stable security invoker set search_path='' as $$ select ai_chat_private.ai_chat_is_admin(); $$;
create or replace function public.ai_chat_has_access() returns boolean language sql stable security invoker set search_path='' as $$ select ai_chat_private.ai_chat_has_access(); $$;
create or replace function public.ai_chat_membership() returns jsonb language sql volatile security invoker set search_path='' as $$ select ai_chat_private.ai_chat_membership(); $$;
create or replace function public.ai_chat_list_members(p_status text default 'pending',p_offset integer default 0) returns jsonb language sql volatile security invoker set search_path='' as $$ select ai_chat_private.ai_chat_list_members(p_status,p_offset); $$;
create or replace function public.ai_chat_review_member(p_user_id uuid,p_status text,p_revision bigint) returns jsonb language sql volatile security invoker set search_path='' as $$ select ai_chat_private.ai_chat_review_member(p_user_id,p_status,p_revision); $$;
revoke all on function public.ai_chat_is_google_user(),public.ai_chat_is_admin(),public.ai_chat_has_access(),public.ai_chat_membership(),public.ai_chat_list_members(text,integer),public.ai_chat_review_member(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.ai_chat_is_google_user(),public.ai_chat_is_admin(),public.ai_chat_has_access(),public.ai_chat_membership(),public.ai_chat_list_members(text,integer),public.ai_chat_review_member(uuid,text,bigint) to authenticated;
-- Add an approval requirement to every existing owner policy, keeping conversation ownership private.
create policy ai_chat_threads_approved on public.ai_chat_threads as restrictive for all to authenticated
 using((select public.ai_chat_has_access())) with check((select public.ai_chat_has_access()));

-- The quota replacement below retains all prior counters and the Google user's hashed identity.
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
 if v_used>=60 or v_total>=100 or (p_provider is not null and v_provider_used>=30) then v_reason:='daily';
 elsif p_reserve and v_last is not null and v_last>now()-interval '10 seconds' then v_reason:='rate'; end if;
 if p_reserve and v_reason='' then
  insert into public.ai_lab_daily_usage(usage_date,user_id,attempts,last_at) values(v_day,v_uid,1,now())
  on conflict(usage_date,user_id) do update set attempts=ai_lab_daily_usage.attempts+1,last_at=now();
  insert into public.ai_lab_provider_usage(usage_date,user_id,provider,attempts) values(v_day,v_uid,p_provider,1)
  on conflict(usage_date,user_id,provider) do update set attempts=ai_lab_provider_usage.attempts+1;
  v_used:=v_used+1;v_total:=v_total+1;
  if p_provider='gemini' then v_gemini:=v_gemini+1;else v_groq:=v_groq+1;end if;
 end if;
 v_common:=greatest(0,least(60-v_used,100-v_total));
 v_providers:=jsonb_build_object(
  'gemini',jsonb_build_object('used',v_gemini,'limit',30,'remaining',greatest(0,least(30-v_gemini,v_common))),
  'groq',jsonb_build_object('used',v_groq,'limit',30,'remaining',greatest(0,least(30-v_groq,v_common))));
 return jsonb_build_object('allowed',v_reason='','reason',v_reason,'used',v_used,'remaining',v_common,'day',v_day,
  'globalRemaining',greatest(0,100-v_total),'unassignedUsed',greatest(0,v_used-v_gemini-v_groq),'providers',v_providers);
end; $$;
revoke all on function public.ai_lab_model_quota(uuid,text,boolean) from public,anon;
grant execute on function public.ai_lab_model_quota(uuid,text,boolean) to authenticated,service_role;

notify pgrst, 'reload schema';
