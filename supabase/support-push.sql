-- Private administrator push notifications. VAPID private key and dispatch token live in Vault.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
revoke all on schema net from public,anon,authenticated;
revoke all on all tables in schema net from public,anon,authenticated;
revoke all on all functions in schema net from public,anon,authenticated;
create table support_private.push_config (
 singleton boolean primary key default true check(singleton),
 public_key text not null check(length(public_key)=87)
);
create table support_private.push_wakes (token_hash text primary key,expires_at timestamptz not null);
alter table support_private.push_wakes enable row level security;
create policy support_push_wakes_private on support_private.push_wakes for all using(false) with check(false);
revoke all on support_private.push_wakes from public,anon,authenticated;
create table support_private.push_subscriptions (
 endpoint text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 p256dh text not null,
 auth text not null,
 created_at timestamptz not null default now()
);
create index support_push_owner on support_private.push_subscriptions(user_id);
create table support_private.push_deliveries (
 id uuid primary key default gen_random_uuid(),
 message_id uuid references support_private.messages(client_id) on delete cascade,
 endpoint text not null references support_private.push_subscriptions(endpoint) on delete cascade,
 is_test boolean not null default false,
 created_at timestamptz not null default now(),
 next_at timestamptz not null default now(),
 lease_id uuid,
 lease_until timestamptz,
 attempts integer not null default 0,
 sent_at timestamptz,
 last_error integer,
 unique(message_id,endpoint),
 check((is_test and message_id is null) or (not is_test and message_id is not null))
);
create index support_push_endpoint on support_private.push_deliveries(endpoint);
create index support_push_due on support_private.push_deliveries(next_at) where sent_at is null and attempts<8;
alter table support_private.push_config enable row level security;
alter table support_private.push_subscriptions enable row level security;
alter table support_private.push_deliveries enable row level security;
create policy support_push_config_private on support_private.push_config for all using(false) with check(false);
create policy support_push_subscriptions_private on support_private.push_subscriptions for all using(false) with check(false);
create policy support_push_deliveries_private on support_private.push_deliveries for all using(false) with check(false);
revoke all on support_private.push_config,support_private.push_subscriptions,support_private.push_deliveries from public,anon,authenticated;

create function support_private.push_wake() returns void language plpgsql security definer set search_path='' as $$
declare nonce text;
begin
 if not exists(select 1 from support_private.push_deliveries where sent_at is null and attempts<8
  and created_at>now()-interval '24 hours' and next_at<=now() and coalesce(lease_until,'-infinity')<=now()) then return; end if;
 -- pg_net owns a transient request queue; never place a durable credential in it.
 nonce:=encode(extensions.gen_random_bytes(32),'hex');
 delete from support_private.push_wakes where expires_at<now();
 insert into support_private.push_wakes values(encode(extensions.digest(nonce,'sha256'),'hex'),now()+interval '5 minutes');
 perform net.http_post(url:='https://maoylwwnluyyfmwqfkfl.supabase.co/functions/v1/support-notify',
  headers:=jsonb_build_object('Content-Type','application/json','x-support-token',nonce),body:='{}'::jsonb,timeout_milliseconds:=15000);
exception when others then
 -- A temporary notification outage must not discard an inquiry; cron retries the durable queue.
 raise warning 'Support notification wake failed';
end; $$;

create function support_private.push_config_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not support_private.is_admin() then raise exception '지정된 관리자 Google 계정으로 로그인해 주세요' using errcode='42501'; end if;
 return (select jsonb_build_object('publicKey',public_key) from support_private.push_config where singleton);
end; $$;
create function support_private.push_save(p_endpoint text,p_p256dh text,p_auth text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not support_private.is_admin() then raise exception '지정된 관리자 Google 계정으로 로그인해 주세요' using errcode='42501'; end if;
 if not coalesce(p_endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)/',false)
  or length(p_endpoint)>1000 or not coalesce(p_p256dh ~ '^[A-Za-z0-9_-]{87}$',false) or not coalesce(p_auth ~ '^[A-Za-z0-9_-]{22}$',false)
 then raise exception '알림 기기 정보를 확인해 주세요'; end if;
 perform 1 from support_private.push_config where singleton for update;
 if not exists(select 1 from support_private.push_subscriptions where endpoint=p_endpoint)
  and (select count(*) from support_private.push_subscriptions where user_id=auth.uid())>=10 then raise exception '알림 기기는 10대까지 등록할 수 있습니다'; end if;
 insert into support_private.push_subscriptions(endpoint,user_id,p256dh,auth) values(p_endpoint,auth.uid(),p_p256dh,p_auth)
 on conflict(endpoint) do update set user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth;
 -- On first enabling a device, also notify about unread inquiries already waiting.
 insert into support_private.push_deliveries(message_id,endpoint)
 select (select m.client_id from support_private.messages m where m.conversation_id=c.id and m.sender='guest' order by m.seq desc limit 1),p_endpoint
 from support_private.conversations c where c.last_guest_at>coalesce(c.last_admin_seen_at,'-infinity')
 order by c.last_guest_at desc limit 20 on conflict(message_id,endpoint) do nothing;
 perform support_private.push_wake();
end; $$;
create function support_private.push_remove(p_endpoint text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not support_private.is_admin() then raise exception '지정된 관리자 Google 계정으로 로그인해 주세요' using errcode='42501'; end if;
 delete from support_private.push_subscriptions where endpoint=p_endpoint and user_id=auth.uid();
end; $$;
create function support_private.push_status(p_endpoint text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not support_private.is_admin() then raise exception '지정된 관리자 Google 계정으로 로그인해 주세요' using errcode='42501'; end if;
 return exists(select 1 from support_private.push_subscriptions where endpoint=p_endpoint and user_id=auth.uid());
end; $$;
create function support_private.push_test(p_endpoint text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not support_private.is_admin() then raise exception '지정된 관리자 Google 계정으로 로그인해 주세요' using errcode='42501'; end if;
 perform 1 from support_private.push_subscriptions where endpoint=p_endpoint and user_id=auth.uid() for update;
 if not found then raise exception '이 기기의 문의 알림을 먼저 켜 주세요'; end if;
 if exists(select 1 from support_private.push_deliveries where endpoint=p_endpoint and is_test and created_at>now()-interval '1 minute') then raise exception '시험 알림은 1분 뒤에 다시 보내 주세요'; end if;
 insert into support_private.push_deliveries(endpoint,is_test) values(p_endpoint,true);
 perform support_private.push_wake();
end; $$;

create function support_private.push_enqueue() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.sender='guest' then
  insert into support_private.push_deliveries(message_id,endpoint)
  select new.client_id,s.endpoint from support_private.push_subscriptions s
  where exists(select 1 from auth.users u where u.id=s.user_id and lower(u.email)='egibynote105g@gmail.com'
   and u.email_confirmed_at is not null and not u.is_anonymous and (u.banned_until is null or u.banned_until<=now())
   and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
  on conflict(message_id,endpoint) do nothing;
  perform support_private.push_wake();
 end if;
 return new;
end; $$;
create trigger support_push_new_guest_message after insert on support_private.messages for each row execute function support_private.push_enqueue();

-- Server-only claims redeem one-time database wakes; completion also requires the Vault token.
create function support_private.push_check_token(p_token text) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' or not exists(select 1 from vault.decrypted_secrets where name='support_push_dispatch_token'
  and extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_token,'sha256')) then raise exception 'forbidden' using errcode='42501'; end if;
end; $$;
create function support_private.push_claim(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare jobs jsonb;
begin
 -- A database wake is single-use and short-lived. Only service_role may redeem it.
 delete from support_private.push_wakes where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>=now();
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 with picked as (
  select d.id from support_private.push_deliveries d where d.sent_at is null and d.attempts<8 and d.created_at>now()-interval '24 hours'
   and d.next_at<=now() and coalesce(d.lease_until,'-infinity')<=now()
   and exists(select 1 from support_private.push_subscriptions s join auth.users u on u.id=s.user_id
    where s.endpoint=d.endpoint and lower(u.email)='egibynote105g@gmail.com' and u.email_confirmed_at is not null and not u.is_anonymous
    and (u.banned_until is null or u.banned_until<=now()) and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google'))
   order by d.next_at,d.id for update skip locked limit 20
 ), leased as (
  update support_private.push_deliveries d set lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=d.attempts+1
  from picked p where d.id=p.id returning d.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'lease',l.lease_id,'endpoint',l.endpoint,'p256dh',s.p256dh,'auth',s.auth,'test',l.is_test)),'[]') into jobs
 from leased l join support_private.push_subscriptions s on s.endpoint=l.endpoint;
 if jsonb_array_length(jobs)=0 then return jsonb_build_object('jobs',jobs); end if;
 return jsonb_build_object('jobs',jobs,'vapid',(select decrypted_secret::jsonb from vault.decrypted_secrets where name='support_push_vapid'),
  'finishToken',(select decrypted_secret from vault.decrypted_secrets where name='support_push_dispatch_token'));
end; $$;
create function support_private.push_finish(p_token text,p_id uuid,p_lease uuid,p_status integer) returns void language plpgsql security definer set search_path='' as $$
declare target text;
begin
 perform support_private.push_check_token(p_token);
 if p_status is null or p_status not between 100 and 599 then raise exception 'invalid status'; end if;
 select endpoint into target from support_private.push_deliveries where id=p_id and lease_id=p_lease and sent_at is null for update;
 if not found then return; end if;
 if p_status in(404,410) then delete from support_private.push_subscriptions where endpoint=target; return; end if;
 update support_private.push_deliveries set sent_at=case when p_status between 200 and 299 then now() else null end,
  lease_until=null,lease_id=null,last_error=case when p_status between 200 and 299 then null else p_status end,
  next_at=now()+make_interval(mins=>least(60,power(2,attempts)::integer)) where id=p_id;
end; $$;

revoke all on function support_private.push_wake(),support_private.push_config_read(),support_private.push_save(text,text,text),support_private.push_remove(text),support_private.push_status(text),support_private.push_test(text),support_private.push_enqueue(),support_private.push_check_token(text),support_private.push_claim(text),support_private.push_finish(text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function support_private.push_config_read(),support_private.push_save(text,text,text),support_private.push_remove(text),support_private.push_status(text),support_private.push_test(text) to authenticated;
grant usage on schema support_private to service_role;
grant execute on function support_private.push_claim(text),support_private.push_finish(text,uuid,uuid,integer) to service_role;
create function public.support_admin_push_config() returns jsonb language sql stable security invoker set search_path='' as $$ select support_private.push_config_read(); $$;
create function public.support_admin_push_save(p_endpoint text,p_p256dh text,p_auth text) returns void language sql security invoker set search_path='' as $$ select support_private.push_save(p_endpoint,p_p256dh,p_auth); $$;
create function public.support_admin_push_remove(p_endpoint text) returns void language sql security invoker set search_path='' as $$ select support_private.push_remove(p_endpoint); $$;
create function public.support_admin_push_status(p_endpoint text) returns boolean language sql stable security invoker set search_path='' as $$ select support_private.push_status(p_endpoint); $$;
create function public.support_admin_push_test(p_endpoint text) returns void language sql security invoker set search_path='' as $$ select support_private.push_test(p_endpoint); $$;
create function public.support_push_claim(p_token text) returns jsonb language sql security invoker set search_path='' as $$ select support_private.push_claim(p_token); $$;
create function public.support_push_finish(p_token text,p_id uuid,p_lease uuid,p_status integer) returns void language sql security invoker set search_path='' as $$ select support_private.push_finish(p_token,p_id,p_lease,p_status); $$;
revoke all on function public.support_admin_push_config(),public.support_admin_push_save(text,text,text),public.support_admin_push_remove(text),public.support_admin_push_status(text),public.support_admin_push_test(text),public.support_push_claim(text),public.support_push_finish(text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.support_admin_push_config(),public.support_admin_push_save(text,text,text),public.support_admin_push_remove(text),public.support_admin_push_status(text),public.support_admin_push_test(text) to authenticated;
grant execute on function public.support_push_claim(text),public.support_push_finish(text,uuid,uuid,integer) to service_role;
select cron.schedule('support-push-retry','* * * * *','select support_private.push_wake();');
