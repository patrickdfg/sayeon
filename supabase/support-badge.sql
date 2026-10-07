-- The badge counts unanswered conversations, rather than individual messages.
create function support_private.admin_counts() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not support_private.is_admin() then raise exception '지정된 관리자 Google 계정으로 로그인해 주세요' using errcode='42501'; end if;
 return (select jsonb_build_object('pending',count(*) filter(where last_guest_at>coalesce(last_admin_at,'-infinity'::timestamptz)),
  'unread',count(*) filter(where last_guest_at>coalesce(last_admin_seen_at,'-infinity'::timestamptz))) from support_private.conversations);
end; $$;
revoke all on function support_private.admin_counts() from public,anon,authenticated;
grant execute on function support_private.admin_counts() to authenticated;
create function public.support_admin_counts() returns jsonb language sql stable security invoker set search_path='' as $$ select support_private.admin_counts(); $$;
revoke all on function public.support_admin_counts() from public,anon,authenticated;
grant execute on function public.support_admin_counts() to authenticated;
