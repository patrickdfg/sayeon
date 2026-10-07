-- Everything rolls back, including pg_net requests; no fixture reaches a real phone.
begin;
do $$begin perform set_config('support_test.owner',(select id::text from auth.users where lower(email)='egibynote105g@gmail.com'),true);end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous)
values('dd770077-1111-4111-8111-111111111111','authenticated','authenticated','push-fixture@example.invalid',now(),'{"provider":"google"}','{"email":"egibynote105g@gmail.com"}',false);
insert into auth.identities(user_id,provider_id,provider,identity_data) values('dd770077-1111-4111-8111-111111111111','push-fixture','google','{"sub":"push-fixture"}');
set local role anon;
do $$begin
 begin perform public.support_admin_push_config();raise exception 'anon config allowed';exception when insufficient_privilege then null;end;
 begin perform public.support_push_claim(repeat('c',64));raise exception 'anon claim allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from support_private.push_subscriptions;raise exception 'raw subscribers exposed';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
do $$begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"dd770077-1111-4111-8111-111111111111","email":"egibynote105g@gmail.com"}',true);end $$;
do $$begin
 begin perform public.support_admin_push_save('https://fcm.googleapis.com/fcm/send/fixture',repeat('B',87),repeat('a',22));raise exception 'forged Google owner registered';exception when insufficient_privilege then null;end;
 begin perform public.support_push_claim(repeat('c',64));raise exception 'user claim allowed';exception when insufficient_privilege then null;end;
end $$;
do $$begin perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('support_test.owner'))::text,true);end $$;
do $$begin
 if length(public.support_admin_push_config()->>'publicKey')<>87 then raise exception 'public key missing';end if;
 begin perform public.support_admin_push_save('https://attacker.invalid/',repeat('B',87),repeat('a',22));raise exception 'SSRF endpoint accepted';exception when raise_exception then if sqlerrm='SSRF endpoint accepted' then raise;end if;end;
 perform public.support_admin_push_save('https://fcm.googleapis.com/fcm/send/fixture',repeat('B',87),repeat('a',22));
 if not public.support_admin_push_status('https://fcm.googleapis.com/fcm/send/fixture') then raise exception 'owner registration missing';end if;
end $$;
set local role anon;
select public.support_guest_send('dd770077-2222-4222-8222-222222222222',repeat('d',64),'dd770077-3333-4333-8333-333333333333','private fixture body','Fixture');
select public.support_guest_send('dd770077-2222-4222-8222-222222222222',repeat('d',64),'dd770077-3333-4333-8333-333333333333','private fixture body','Fixture');
reset role;
do $$begin
 if (select count(*) from support_private.push_deliveries where message_id='dd770077-3333-4333-8333-333333333333')<>1 then raise exception 'new guest notification or idempotence failed';end if;
 perform set_config('support_test.delivery',(select id::text from support_private.push_deliveries where message_id='dd770077-3333-4333-8333-333333333333'),true);
 insert into support_private.push_wakes values(encode(extensions.digest(repeat('c',64),'sha256'),'hex'),now()+interval '1 minute');
end $$;
set local role service_role;
do $$declare batch jsonb; item jsonb; finished_token text;begin
 begin perform public.support_push_claim(repeat('e',64));raise exception 'invalid wake allowed';exception when insufficient_privilege then null;end;
 batch:=public.support_push_claim(repeat('c',64));
 select j into item from jsonb_array_elements(batch->'jobs') j where j->>'id'=current_setting('support_test.delivery');
 if item is null or (batch->'jobs')::text like '%private fixture body%' then raise exception 'claim failed or private text exposed';end if;
 perform set_config('support_test.lease',item->>'lease',true);
 begin perform public.support_push_claim(repeat('c',64));raise exception 'wake replay allowed';exception when insufficient_privilege then null;end;
 finished_token:=batch->>'finishToken';
 perform public.support_push_finish(finished_token,(item->>'id')::uuid,gen_random_uuid(),201);
 perform public.support_push_finish(finished_token,(item->>'id')::uuid,(item->>'lease')::uuid,503);
end $$;
reset role;
do $$begin
 if not exists(select 1 from support_private.push_deliveries where id=current_setting('support_test.delivery')::uuid and sent_at is null and lease_until is null and attempts=1 and next_at>now()) then raise exception 'retry or stale lease failed';end if;
 update support_private.push_deliveries set next_at=now() where id=current_setting('support_test.delivery')::uuid;
 insert into support_private.push_wakes values(encode(extensions.digest(repeat('f',64),'sha256'),'hex'),now()+interval '1 minute');
end $$;
set local role service_role;
do $$declare b jsonb;j jsonb;begin
 b:=public.support_push_claim(repeat('f',64));select x into j from jsonb_array_elements(b->'jobs') x where x->>'id'=current_setting('support_test.delivery');
 perform public.support_push_finish(b->>'finishToken',(j->>'id')::uuid,(j->>'lease')::uuid,201);
 perform public.support_push_finish(b->>'finishToken',(j->>'id')::uuid,(j->>'lease')::uuid,503);
end $$;
reset role;
do $$begin if not exists(select 1 from support_private.push_deliveries where id=current_setting('support_test.delivery')::uuid and sent_at is not null and attempts=2) then raise exception 'success acknowledgement failed';end if;end $$;
set local role authenticated;
do $$begin perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('support_test.owner'))::text,true);end $$;
do $$begin
 perform public.support_admin_push_test('https://fcm.googleapis.com/fcm/send/fixture');
 begin perform public.support_admin_push_test('https://fcm.googleapis.com/fcm/send/fixture');raise exception 'test rate limit failed';exception when raise_exception then if sqlerrm='test rate limit failed' then raise;end if;end;
 perform public.support_admin_push_remove('https://fcm.googleapis.com/fcm/send/fixture');
 if public.support_admin_push_status('https://fcm.googleapis.com/fcm/send/fixture') then raise exception 'disable failed';end if;
end $$;
rollback;
select 'PASS: owner-only registration, guest message enqueue, deduplication, private payload, one-time wake, lease, retry, acknowledgement and opt-out' as result;
