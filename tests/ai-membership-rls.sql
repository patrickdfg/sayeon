-- Run against the project as postgres. Every fixture and review is rolled back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous)
values
 ('aaaaaaaa-1111-4111-8111-111111111111','authenticated','authenticated','approval-fixture-a@example.invalid',now(),'{"provider":"google"}','{"full_name":"Fixture A"}',false),
 ('bbbbbbbb-2222-4222-8222-222222222222','authenticated','authenticated','approval-fixture-b@example.invalid',now(),'{"provider":"google"}','{}',false),
 ('cccccccc-3333-4333-8333-333333333333','authenticated','authenticated','approval-fixture-admin@example.invalid',now(),'{"provider":"google"}','{}',false),
 ('dddddddd-4444-4444-8444-444444444444','authenticated','authenticated','approval-fixture-email@example.invalid',now(),'{"provider":"email"}','{}',false);
insert into auth.identities(user_id,provider_id,provider,identity_data)
select id,id::text,'google',jsonb_build_object('sub',id::text,'email',email) from auth.users
where id in ('aaaaaaaa-1111-4111-8111-111111111111','bbbbbbbb-2222-4222-8222-222222222222','cccccccc-3333-4333-8333-333333333333');
insert into public.analytics_admin_emails(email) values('approval-fixture-admin@example.invalid');
insert into public.ai_chat_threads(id,user_id,title) values
 ('aaaaaaaa-5555-4555-8555-555555555555','aaaaaaaa-1111-4111-8111-111111111111','fixture private A'),
 ('bbbbbbbb-6666-4666-8666-666666666666','bbbbbbbb-2222-4222-8222-222222222222','fixture private B');
insert into public.ai_lab_daily_usage(usage_date,user_id,attempts,last_at)
 values(timezone('Asia/Seoul',now())::date,substring(encode(extensions.digest('ai-lab-public:aaaaaaaa-1111-4111-8111-111111111111','sha256'),'hex'),1,32)::uuid,5,now()-interval '1 minute');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-1111-4111-8111-111111111111","role":"authenticated","email":"approval-fixture-admin@example.invalid"}',true);
do $$ declare x jsonb; n integer; begin
 x:=public.ai_chat_membership();
 if x->>'status'<>'pending' or (x->>'isAdmin')::boolean or public.ai_chat_has_access() then raise exception 'pending or forged admin claim accepted'; end if;
 if exists(select 1 from public.ai_chat_threads) then raise exception 'pending history exposed'; end if;
 begin perform public.ai_chat_list_members();raise exception 'self approval list allowed';exception when insufficient_privilege then null;end;
 begin perform public.ai_chat_review_member(auth.uid(),'approved',0);raise exception 'self approval allowed';exception when insufficient_privilege then null;end;
 begin update public.ai_chat_members set status='approved' where user_id=auth.uid();raise exception 'direct approval allowed';exception when insufficient_privilege then null;end;
 begin perform public.ai_lab_model_quota();raise exception 'pending quota allowed';exception when insufficient_privilege then null;end;
 begin insert into public.ai_chat_threads(id,title) values('aaaaaaaa-7777-4777-8777-777777777777','pending insert');raise exception 'pending insert allowed';exception when insufficient_privilege then null;end;
 end $$;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-2222-4222-8222-222222222222","role":"authenticated"}',true);
select public.ai_chat_membership();
select set_config('request.jwt.claims','{"sub":"cccccccc-3333-4333-8333-333333333333","role":"authenticated"}',true);
do $$ declare x jsonb; begin
 x:=public.ai_chat_membership();if not (x->>'isAdmin')::boolean or not public.ai_chat_has_access() then raise exception 'existing admin denied'; end if;
 if exists(select 1 from public.ai_chat_threads) then raise exception 'admin saw private conversations'; end if;
 if jsonb_array_length(public.ai_chat_list_members())<>2 then raise exception 'pending list incorrect';end if;
 perform public.ai_chat_review_member('aaaaaaaa-1111-4111-8111-111111111111','approved',0);
 begin perform public.ai_chat_review_member('aaaaaaaa-1111-4111-8111-111111111111','revoked',0);raise exception 'stale decision accepted';exception when serialization_failure then null;end;
 perform public.ai_chat_review_member('bbbbbbbb-2222-4222-8222-222222222222','rejected',0);
 end $$;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$ declare x jsonb;n integer;begin
 if not public.ai_chat_has_access() then raise exception 'approved user denied';end if;
 if (select count(*) from public.ai_chat_threads)<>1 then raise exception 'owner isolation failed';end if;
 update public.ai_chat_threads set title='own update' where id='aaaaaaaa-5555-4555-8555-555555555555';get diagnostics n=row_count;if n<>1 then raise exception 'own update denied';end if;
 update public.ai_chat_threads set title='foreign update' where id='bbbbbbbb-6666-4666-8666-666666666666';get diagnostics n=row_count;if n<>0 then raise exception 'foreign update allowed';end if;
 delete from public.ai_chat_threads where id='bbbbbbbb-6666-4666-8666-666666666666';get diagnostics n=row_count;if n<>0 then raise exception 'foreign delete allowed';end if;
 insert into public.ai_chat_threads(id,title) values('aaaaaaaa-7777-4777-8777-777777777777','approved insert');
 delete from public.ai_chat_threads where id='aaaaaaaa-7777-4777-8777-777777777777';get diagnostics n=row_count;if n<>1 then raise exception 'own delete denied';end if;
 x:=public.ai_lab_model_quota();if (x->>'used')::integer<>5 then raise exception 'prior hashed quota identity lost';end if;
 begin perform public.ai_lab_model_quota('bbbbbbbb-2222-4222-8222-222222222222');raise exception 'caller quota identity allowed';exception when raise_exception then if sqlerrm='caller quota identity allowed' then raise;end if;end;
 end $$;
select set_config('request.jwt.claims','{"sub":"cccccccc-3333-4333-8333-333333333333","role":"authenticated"}',true);
select public.ai_chat_review_member('aaaaaaaa-1111-4111-8111-111111111111','revoked',1);
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$declare n integer;begin
 if public.ai_chat_has_access() then raise exception 'revoked access allowed';end if;
 if exists(select 1 from public.ai_chat_threads) then raise exception 'revoked history allowed';end if;
 update public.ai_chat_threads set title='revoked update';get diagnostics n=row_count;if n<>0 then raise exception 'revoked update allowed';end if;
 delete from public.ai_chat_threads;get diagnostics n=row_count;if n<>0 then raise exception 'revoked delete allowed';end if;
 begin perform public.ai_lab_model_quota();raise exception 'revoked quota allowed';exception when insufficient_privilege then null;end;
 end $$;
select set_config('request.jwt.claims','{"sub":"dddddddd-4444-4444-8444-444444444444","role":"authenticated"}',true);
do $$begin begin perform public.ai_chat_membership();raise exception 'non Google signup allowed';exception when insufficient_privilege then null;end;end $$;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":true}',true);
do $$begin if exists(select 1 from public.ai_chat_threads) then raise exception 'anonymous history allowed';end if;end $$;
set local role anon;
do $$begin begin perform public.ai_chat_membership();raise exception 'anon signup allowed';exception when insufficient_privilege then null;end;end $$;
reset role;
do $$begin
 if (select count(*) from public.ai_chat_member_reviews where user_id in ('aaaaaaaa-1111-4111-8111-111111111111','bbbbbbbb-2222-4222-8222-222222222222'))<>3 then raise exception 'review audit missing';end if;
 if (select count(*) from public.ai_chat_threads where id in ('aaaaaaaa-5555-4555-8555-555555555555','bbbbbbbb-6666-4666-8666-666666666666'))<>2 then raise exception 'private history removed by revocation';end if;
end $$;
rollback;
select 'PASS: Google pending/approve/reject/revoke, live JWT, owner RLS, admin isolation, CAS, quota continuity, audit; fixtures rolled back' as verification;
