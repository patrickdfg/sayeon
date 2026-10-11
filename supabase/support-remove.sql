-- 문의 기능(2026-10) 서버 쪽을 모두 지운다. Supabase 대시보드 → SQL Editor 에서 한 번 실행한다.
-- 주의: 받은 문의 대화와 알림 구독 기록이 영구히 지워지고 되돌릴 수 없다.
-- 이 저장소에는 지운 뒤의 코드만 남아 있고, 옛 코드는 git 기록(2026-10-11 이전 커밋)에 있다.

-- 1) 매분 도는 알림 재시도 작업을 끈다(pg_cron 이 있을 때만)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'support-push-retry';
  end if;
end $$;

-- 2) 공개 스키마의 support_ 로 시작하는 함수(화면이 부르던 것)를 모두 지운다
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'support\_%'
  loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;

-- 3) 문의 표·함수·트리거가 든 비공개 스키마를 통째로 지운다
drop schema if exists support_private cascade;

-- 이 파일로 지워지지 않는 것(대시보드에서 직접)
--  · Edge Function `support-notify` 삭제 (Edge Functions → support-notify → Delete)
--  · 그 함수에 넣어 둔 Secret(문의 알림용 VAPID·토큰 등)이 있으면 삭제
