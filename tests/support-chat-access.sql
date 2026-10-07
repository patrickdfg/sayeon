-- Production authorization tests; all test conversations, messages and identities roll back.
begin;
select set_config('support_test.owner',(select id::text from auth.users where lower(email)='egibynote105g@gmail.com'),true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous)
values('ee770077-1111-4111-8111-111111111111','authenticated','authenticated','support-fixture@example.invalid',now(),'{"provider":"google"}','{"email":"egibynote105g@gmail.com"}',false);
insert into auth.identities(user_id,provider_id,provider,identity_data) values('ee770077-1111-4111-8111-111111111111','support-fixture','google','{"sub":"support-fixture"}');
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select public.support_guest_send('ee770077-2222-4222-8222-222222222222',repeat('a',64),'ee770077-3333-4333-8333-333333333333','fixture inquiry A','Fixture A');
select public.support_guest_send('ee770077-4444-4444-8444-444444444444',repeat('b',64),'ee770077-5555-4555-8555-555555555555','fixture inquiry B','Fixture B');
-- The same request ID is safe to retry after a response was lost.
select public.support_guest_send('ee770077-2222-4222-8222-222222222222',repeat('a',64),'ee770077-3333-4333-8333-333333333333','fixture inquiry A','Fixture A');
do $$declare x jsonb;begin
 x:=public.support_guest_read('ee770077-2222-4222-8222-222222222222',repeat('a',64));
 if jsonb_array_length(x->'messages')<>1 or x->'messages'->0->>'sender'<>'guest' then raise exception 'guest read/idempotence failed';end if;
 begin perform public.support_guest_read('ee770077-4444-4444-8444-444444444444',repeat('a',64));raise exception 'foreign guest read allowed';exception when insufficient_privilege then null;end;
 begin perform public.support_guest_send('ee770077-4444-4444-8444-444444444444',repeat('a',64),gen_random_uuid(),'foreign write');raise exception 'foreign guest write allowed';exception when insufficient_privilege then null;end;
 begin perform public.support_admin_list();raise exception 'anon admin list allowed';exception when insufficient_privilege then null;end;
 begin perform public.support_admin_send('ee770077-2222-4222-8222-222222222222',gen_random_uuid(),'fake admin reply');raise exception 'anon admin reply allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from support_private.messages;raise exception 'raw message table exposed';exception when insufficient_privilege then null;end;
 begin perform support_private.read_messages('ee770077-4444-4444-8444-444444444444',0);raise exception 'internal helper executable';exception when insufficient_privilege then null;end;
 begin perform public.support_guest_send(gen_random_uuid(),'short',gen_random_uuid(),'invalid');raise exception 'weak capability accepted';exception when raise_exception then if sqlerrm='weak capability accepted' then raise;end if;end;
 begin perform public.support_guest_send('ee770077-2222-4222-8222-222222222222',repeat('a',64),'ee770077-3333-4333-8333-333333333333','changed retry');raise exception 'changed retry accepted';exception when raise_exception then if sqlerrm='changed retry accepted' then raise;end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"ee770077-1111-4111-8111-111111111111","email":"egibynote105g@gmail.com"}',true);
do $$ begin
 if public.support_admin_status() then raise exception 'forged email/admin metadata accepted';end if;
 begin perform public.support_admin_list();raise exception 'other Google account saw inquiries';exception when insufficient_privilege then null;end;
 begin perform public.support_admin_send('ee770077-2222-4222-8222-222222222222',gen_random_uuid(),'forged reply');raise exception 'other Google account replied';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('support_test.owner'))::text,true);
do $$declare x jsonb;begin
 if not public.support_admin_status() then raise exception 'designated admin denied';end if;
 x:=public.support_admin_list();if not exists(select 1 from jsonb_array_elements(x) t where t->>'id'='ee770077-2222-4222-8222-222222222222') then raise exception 'admin inbox missing inquiry';end if;
 if x::text like '%'||repeat('a',64)||'%' then raise exception 'capability hash exposed';end if;
 perform public.support_admin_send('ee770077-2222-4222-8222-222222222222','ee770077-6666-4666-8666-666666666666','fixture admin response');
 perform public.support_admin_send('ee770077-2222-4222-8222-222222222222','ee770077-6666-4666-8666-666666666666','fixture admin response');
 x:=public.support_admin_read('ee770077-2222-4222-8222-222222222222');if jsonb_array_length(x->'messages')<>2 then raise exception 'admin reply/read/idempotence failed';end if;
end $$;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$declare x jsonb;begin
 x:=public.support_guest_read('ee770077-2222-4222-8222-222222222222',repeat('a',64));
 if x->'messages'->1->>'body'<>'fixture admin response' or x->'messages'->1->>'sender'<>'admin' then raise exception 'guest cannot see actual admin response';end if;
end $$;
reset role;
insert into support_private.messages(client_id,conversation_id,sender,body,created_at)
select gen_random_uuid(),'ee770077-2222-4222-8222-222222222222','guest','history fixture '||n,now()-interval '2 minutes' from generate_series(1,101) n;
set local role anon;
do $$declare x jsonb;y jsonb;begin
 x:=public.support_guest_read('ee770077-2222-4222-8222-222222222222',repeat('a',64));
 if not (x->>'more')::boolean or jsonb_array_length(x->'messages')<>100 then raise exception 'pagination first page failed';end if;
 y:=public.support_guest_read('ee770077-2222-4222-8222-222222222222',repeat('a',64),(x->'messages'->99->>'seq')::bigint);
 if jsonb_array_length(y->'messages')<>3 then raise exception 'pagination dropped messages';end if;
end $$;
reset role;
insert into support_private.messages(client_id,conversation_id,sender,body) select gen_random_uuid(),'ee770077-4444-4444-8444-444444444444','guest','rate fixture '||n from generate_series(1,9) n;
set local role anon;
do $$begin
 begin perform public.support_guest_send('ee770077-4444-4444-8444-444444444444',repeat('b',64),gen_random_uuid(),'too fast');raise exception 'rate limit failed';exception when raise_exception then if sqlerrm='rate limit failed' then raise;end if;end;
end $$;
reset role;
select 'PASS: anonymous isolation, exact Google admin, replies, retries, pagination and rate limit' as result;
rollback;
