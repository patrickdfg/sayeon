begin;
do $$begin perform set_config('support_badge.owner',(select id::text from auth.users where lower(email)='egibynote105g@gmail.com'),true);end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous)
values('bc770077-1111-4111-8111-111111111111','authenticated','authenticated','badge-fixture@example.invalid',now(),'{"provider":"google"}','{"email":"egibynote105g@gmail.com"}',false);
insert into auth.identities(user_id,provider_id,provider,identity_data) values('bc770077-1111-4111-8111-111111111111','badge-fixture','google','{"sub":"badge-fixture"}');
set local role anon;
do $$begin begin perform public.support_admin_counts();raise exception 'anonymous count exposed';exception when insufficient_privilege then null;end;end $$;
set local role authenticated;
do $$begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"bc770077-1111-4111-8111-111111111111","email":"egibynote105g@gmail.com"}',true);end $$;
do $$begin begin perform public.support_admin_counts();raise exception 'forged account count exposed';exception when insufficient_privilege then null;end;end $$;
do $$begin perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('support_badge.owner'))::text,true);perform set_config('support_badge.before',public.support_admin_counts()->>'pending',true);end $$;
set local role anon;
select public.support_guest_send('bc770077-2222-4222-8222-222222222222',repeat('a',64),'bc770077-3333-4333-8333-333333333333','badge fixture','Fixture');
select public.support_guest_send('bc770077-2222-4222-8222-222222222222',repeat('a',64),'bc770077-4444-4444-8444-444444444444','badge second message','Fixture');
set local role authenticated;
do $$declare before_count integer:=current_setting('support_badge.before')::integer;begin
 if (public.support_admin_counts()->>'pending')::integer<>before_count+1 then raise exception 'count should track conversations not messages';end if;
 perform public.support_admin_read('bc770077-2222-4222-8222-222222222222');
 if (public.support_admin_counts()->>'pending')::integer<>before_count+1 then raise exception 'reading incorrectly cleared unanswered count';end if;
 perform public.support_admin_send('bc770077-2222-4222-8222-222222222222',gen_random_uuid(),'badge reply');
 if (public.support_admin_counts()->>'pending')::integer<>before_count then raise exception 'reply did not decrease count';end if;
end $$;
rollback;
select 'PASS: owner-only count, conversations not messages, reading preserves pending, reply reduces pending' as result;
