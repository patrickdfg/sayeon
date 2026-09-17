-- 새 사연 알림 — Supabase SQL Editor 에서 한 번 실행합니다.
--
-- 알림 받을 기기 명단과 '어느 편을 보냈는지' 기록을 둡니다.
-- 표는 잠가 두고(RLS), 브라우저는 명단에 올리고 내리는 함수만,
-- 보내는 쪽(tools/send_push.py)은 발송 토큰이 맞을 때만 명단을 읽습니다.
-- 아래 해시는 깃허브 비밀값 PUSH_TOKEN 의 SHA-256 입니다(토큰 자체는 적지 않음).
-- 토큰을 바꾸면 push_admin 의 해시도 새로 넣어야 합니다.

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);

create table if not exists public.push_sent (
  item_no text primary key,
  sent_at timestamptz not null default now()
);

create table if not exists public.push_admin (
  token_hash text primary key
);

alter table public.push_subscriptions enable row level security;
alter table public.push_sent enable row level security;
alter table public.push_admin enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_sent from anon, authenticated;
revoke all on public.push_admin from anon, authenticated;

insert into public.push_admin (token_hash)
values ('c8cd280d78f32a6c53de18297b25330105f77ab07ed8e9873fb088a2b89c58cd')
on conflict do nothing;

-- 알림 서버 주소만 받는다 (크롬·삼성 인터넷 = fcm, 파이어폭스, 엣지, 사파리)
create or replace function public.push_endpoint_ok(p_endpoint text) returns boolean
language sql immutable
as $$
  select coalesce(
    p_endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)/'
    and length(p_endpoint) <= 1000, false);
$$;

-- 브라우저: 명단에 올리기 (이미 있으면 열쇠와 마지막 확인 시각만 새로 고침)
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.push_endpoint_ok(p_endpoint)
     or length(coalesce(p_p256dh, '')) not between 40 and 200
     or length(coalesce(p_auth, '')) not between 10 and 100 then
    raise exception 'invalid subscription';
  end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth)
  values (p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, seen_at = now();
end;
$$;

-- 브라우저: 명단에서 내리기 (주소는 기기마다 길고 무작위라 남이 알 수 없다)
create or replace function public.remove_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

create or replace function public.push_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.push_admin
                 where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex'));
$$;

-- 보내는 쪽: 이 편을 보냈다고 먼저 적는다. 이미 적혀 있으면 false (두 번 보내지 않음)
create or replace function public.push_claim(p_token text, p_item_no text) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.push_token_ok(p_token) then raise exception 'forbidden'; end if;
  insert into public.push_sent (item_no) values (p_item_no) on conflict do nothing;
  return found;
end;
$$;

-- 보내는 쪽: 명단 읽기
create or replace function public.push_list(p_token text)
returns table (endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.push_token_ok(p_token) then raise exception 'forbidden'; end if;
  return query select s.endpoint, s.p256dh, s.auth from public.push_subscriptions s;
end;
$$;

-- 보내는 쪽: 알림 서버가 '없는 기기'라고 답한 주소를 지운다
create or replace function public.push_drop(p_token text, p_endpoint text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.push_token_ok(p_token) then raise exception 'forbidden'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end;
$$;

revoke all on function public.push_endpoint_ok(text) from public;
revoke all on function public.push_token_ok(text) from public;
revoke all on function public.save_push_subscription(text,text,text) from public;
revoke all on function public.remove_push_subscription(text) from public;
revoke all on function public.push_claim(text,text) from public;
revoke all on function public.push_list(text) from public;
revoke all on function public.push_drop(text,text) from public;
grant execute on function public.save_push_subscription(text,text,text) to anon, authenticated;
grant execute on function public.remove_push_subscription(text) to anon, authenticated;
grant execute on function public.push_claim(text,text) to anon;
grant execute on function public.push_list(text) to anon;
grant execute on function public.push_drop(text,text) to anon;
