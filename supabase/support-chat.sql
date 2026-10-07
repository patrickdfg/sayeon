-- Guests use a 256-bit browser capability, never a login or public message table.
create schema support_private;
revoke all on schema support_private from public,anon,authenticated;
grant usage on schema support_private to anon,authenticated;
create table support_private.conversations (
 id uuid primary key,
 token_hash text not null unique check(length(token_hash)=64),
 display_name text not null check(length(display_name) between 1 and 80),
 subject text not null check(length(subject) between 1 and 100),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_guest_at timestamptz not null default now(),
 last_admin_at timestamptz,
 last_admin_seen_at timestamptz
);
create table support_private.messages (
 seq bigint generated always as identity primary key,
 client_id uuid not null unique,
 conversation_id uuid not null references support_private.conversations(id),
 sender text not null check(sender in ('guest','admin')),
 body text not null check(length(btrim(body)) between 1 and 4000),
 author_id uuid references auth.users(id),
 created_at timestamptz not null default now(),
 check((sender='guest' and author_id is null) or (sender='admin' and author_id is not null))
);
create index support_messages_conversation_seq on support_private.messages(conversation_id,seq);
create index support_messages_rate on support_private.messages(conversation_id,sender,created_at desc);
create index support_conversations_created on support_private.conversations(created_at desc,id);
create index support_messages_author on support_private.messages(author_id);
alter table support_private.conversations enable row level security;
alter table support_private.messages enable row level security;
create policy support_conversations_no_direct_access on support_private.conversations for all using(false) with check(false);
create policy support_messages_no_direct_access on support_private.messages for all using(false) with check(false);
revoke all on all tables in schema support_private from public,anon,authenticated;
revoke all on all sequences in schema support_private from public,anon,authenticated;

create function support_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and ai_chat_private.ai_chat_is_google_user()
 and exists(select 1 from auth.users u where u.id=auth.uid() and lower(u.email)='egibynote105g@gmail.com');
$$;
create function support_private.check_guest(p_id uuid,p_token text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_id is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' or not exists(
  select 1 from support_private.conversations where id=p_id and token_hash=encode(extensions.digest(p_token,'sha256'),'hex'))
 then raise exception '이 브라우저의 문의 기록을 확인할 수 없습니다' using errcode='42501'; end if;
end; $$;
create function support_private.read_messages(p_id uuid,p_after bigint) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) from (
  select seq,client_id,sender,body,created_at from support_private.messages where conversation_id=p_id and seq>p_after order by seq limit 100
 ) rows;
$$;
-- Internal helpers are not executable by API roles. Narrow entry points below authorize first.
revoke all on function support_private.is_admin(),support_private.check_guest(uuid,text),support_private.read_messages(uuid,bigint) from public,anon,authenticated;

create function support_private.guest_read(p_id uuid,p_token text,p_after bigint default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform support_private.check_guest(p_id,p_token);
 if p_after is null or p_after<0 then raise exception '문의 조회 위치를 확인해 주세요'; end if;
 result:=support_private.read_messages(p_id,p_after);
 return jsonb_build_object('messages',result,'more',jsonb_array_length(result)=100);
end; $$;
create function support_private.guest_send(p_id uuid,p_token text,p_message_id uuid,p_body text,p_name text default '방문자') returns jsonb language plpgsql security definer set search_path='' as $$
declare c support_private.conversations; existing support_private.messages; token_digest text; content text:=btrim(p_body); sender_name text:=coalesce(nullif(btrim(p_name),''),'방문자');
begin
 if p_id is null or p_message_id is null or p_token is null or p_token !~ '^[0-9a-f]{64}$'
 or content is null or length(content) not between 1 and 4000 or length(sender_name)>80
 then raise exception '문의 내용은 1~4000자, 이름은 80자 이내로 입력해 주세요'; end if;
 token_digest:=encode(extensions.digest(p_token,'sha256'),'hex');
 insert into support_private.conversations(id,token_hash,display_name,subject)
 values(p_id,token_digest,sender_name,left(content,100)) on conflict(id) do nothing;
 perform support_private.check_guest(p_id,p_token);
 select * into c from support_private.conversations where id=p_id for update;
 select * into existing from support_private.messages where client_id=p_message_id;
 if found then
  if existing.conversation_id<>p_id or existing.sender<>'guest' or existing.body<>content then raise exception '전송 기록이 달라 다시 확인해야 합니다'; end if;
  return jsonb_build_object('messageId',existing.client_id);
 end if;
 if (select count(*) from support_private.messages where conversation_id=p_id and sender='guest' and created_at>now()-interval '1 minute')>=10
 then raise exception '메시지를 너무 빠르게 보내셨습니다. 잠시 후 다시 보내 주세요'; end if;
 insert into support_private.messages(client_id,conversation_id,sender,body) values(p_message_id,p_id,'guest',content);
 update support_private.conversations set updated_at=now(),last_guest_at=now() where id=p_id;
 return jsonb_build_object('messageId',p_message_id);
end; $$;
create function support_private.admin_list(p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not support_private.is_admin() then raise exception '지정된 관리자 Google 계정으로 로그인해 주세요' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception '목록 위치를 확인해 주세요'; end if;
 return coalesce((select jsonb_agg(to_jsonb(rows)) from (
  select id,display_name,subject,created_at,updated_at,last_guest_at,last_admin_at,
   last_guest_at>coalesce(last_admin_seen_at,'-infinity'::timestamptz) as unread
  from support_private.conversations order by created_at desc,id limit 50 offset p_offset
 ) rows),'[]'::jsonb);
end; $$;
create function support_private.admin_read(p_id uuid,p_after bigint default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not support_private.is_admin() then raise exception '지정된 관리자 Google 계정으로 로그인해 주세요' using errcode='42501'; end if;
 if p_after is null or p_after<0 or not exists(select 1 from support_private.conversations where id=p_id) then raise exception '문의 기록을 찾지 못했습니다'; end if;
 result:=support_private.read_messages(p_id,p_after);
 update support_private.conversations set last_admin_seen_at=now() where id=p_id;
 return jsonb_build_object('messages',result,'more',jsonb_array_length(result)=100);
end; $$;
create function support_private.admin_send(p_id uuid,p_message_id uuid,p_body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing support_private.messages; content text:=btrim(p_body);
begin
 if not support_private.is_admin() then raise exception '지정된 관리자 Google 계정으로 로그인해 주세요' using errcode='42501'; end if;
 if p_message_id is null or content is null or length(content) not between 1 and 4000 then raise exception '답변은 1~4000자로 입력해 주세요'; end if;
 perform 1 from support_private.conversations where id=p_id for update;
 if not found then raise exception '문의 기록을 찾지 못했습니다'; end if;
 select * into existing from support_private.messages where client_id=p_message_id;
 if found then
  if existing.conversation_id<>p_id or existing.sender<>'admin' or existing.body<>content then raise exception '전송 기록이 달라 다시 확인해야 합니다'; end if;
  return jsonb_build_object('messageId',existing.client_id);
 end if;
 insert into support_private.messages(client_id,conversation_id,sender,body,author_id) values(p_message_id,p_id,'admin',content,auth.uid());
 update support_private.conversations set updated_at=now(),last_admin_at=now() where id=p_id;
 return jsonb_build_object('messageId',p_message_id);
end; $$;
revoke all on function support_private.guest_read(uuid,text,bigint),support_private.guest_send(uuid,text,uuid,text,text),support_private.admin_list(integer),support_private.admin_read(uuid,bigint),support_private.admin_send(uuid,uuid,text) from public,anon,authenticated;
grant execute on function support_private.guest_read(uuid,text,bigint),support_private.guest_send(uuid,text,uuid,text,text) to anon,authenticated;
grant execute on function support_private.is_admin(),support_private.admin_list(integer),support_private.admin_read(uuid,bigint),support_private.admin_send(uuid,uuid,text) to authenticated;

create function public.support_guest_read(p_id uuid,p_token text,p_after bigint default 0) returns jsonb language sql security invoker set search_path='' as $$ select support_private.guest_read(p_id,p_token,p_after); $$;
create function public.support_guest_send(p_id uuid,p_token text,p_message_id uuid,p_body text,p_name text default '방문자') returns jsonb language sql security invoker set search_path='' as $$ select support_private.guest_send(p_id,p_token,p_message_id,p_body,p_name); $$;
create function public.support_admin_status() returns boolean language sql stable security invoker set search_path='' as $$ select support_private.is_admin(); $$;
create function public.support_admin_list(p_offset integer default 0) returns jsonb language sql security invoker set search_path='' as $$ select support_private.admin_list(p_offset); $$;
create function public.support_admin_read(p_id uuid,p_after bigint default 0) returns jsonb language sql security invoker set search_path='' as $$ select support_private.admin_read(p_id,p_after); $$;
create function public.support_admin_send(p_id uuid,p_message_id uuid,p_body text) returns jsonb language sql security invoker set search_path='' as $$ select support_private.admin_send(p_id,p_message_id,p_body); $$;
revoke all on function public.support_guest_read(uuid,text,bigint),public.support_guest_send(uuid,text,uuid,text,text),public.support_admin_status(),public.support_admin_list(integer),public.support_admin_read(uuid,bigint),public.support_admin_send(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.support_guest_read(uuid,text,bigint),public.support_guest_send(uuid,text,uuid,text,text) to anon,authenticated;
grant execute on function public.support_admin_status(),public.support_admin_list(integer),public.support_admin_read(uuid,bigint),public.support_admin_send(uuid,uuid,text) to authenticated;
