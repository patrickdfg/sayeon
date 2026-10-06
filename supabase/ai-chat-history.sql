-- Private Google-account chat history. API keys and passwords are never stored here.
create table public.ai_chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '새 대화' check (char_length(title) between 1 and 100),
  model_id text not null default 'gemini-lite' check (model_id in ('search','gemini-lite','gemini-flash','groq-oss')),
  scope text not null default 'all' check (scope in ('all','sayeon','sayeon2026','sayeon2025','malsseum','stones')),
  messages jsonb not null default '[]'::jsonb check (
    jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 120
    and octet_length(messages::text) <= 4194304
  ),
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_chat_threads_owner_recent_idx on public.ai_chat_threads(user_id, updated_at desc, id);
alter table public.ai_chat_threads enable row level security;
create policy ai_chat_threads_owner_select on public.ai_chat_threads for select to authenticated
  using ((select auth.uid()) = user_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
create policy ai_chat_threads_owner_insert on public.ai_chat_threads for insert to authenticated
  with check ((select auth.uid()) = user_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
create policy ai_chat_threads_owner_update on public.ai_chat_threads for update to authenticated
  using ((select auth.uid()) = user_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false))
  with check ((select auth.uid()) = user_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
create policy ai_chat_threads_owner_delete on public.ai_chat_threads for delete to authenticated
  using ((select auth.uid()) = user_id and not coalesce((select auth.jwt()->>'is_anonymous')::boolean,false));
revoke all on public.ai_chat_threads from public, anon, authenticated;
grant select, delete on public.ai_chat_threads to authenticated;
grant insert(id,title,model_id,scope,messages) on public.ai_chat_threads to authenticated;
grant update(title,model_id,scope,messages) on public.ai_chat_threads to authenticated;
grant all on public.ai_chat_threads to service_role;
create function public.ai_chat_stamp_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.updated_at := clock_timestamp();
  new.revision := old.revision + 1;
  return new;
end;
$$;
revoke all on function public.ai_chat_stamp_revision() from public, anon, authenticated;
create trigger ai_chat_threads_stamp before update on public.ai_chat_threads
  for each row execute function public.ai_chat_stamp_revision();
notify pgrst, 'reload schema';
