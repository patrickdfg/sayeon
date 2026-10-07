# 관리자 문의 채팅 (2026-10-07)

- 사용자 요청: 월명동 화면의 제작 문구와 자료실 footer를 제거하고 관리자에게 문의하기를 넣는다. 문의자는 로그인 없이 이용하고 관리자 egibynote105g@gmail.com은 Google 로그인으로 답변한다.
- /sayeon/contact.html은 문의자 대화와 관리자 문의함을 제공한다. 이미 지정 계정으로 로그인한 관리자는 문의함이 자동으로 열린다. 관리자 로그인은 기존 AI 화면의 OAuth Redirect URL을 재사용하며 로그인 완료 후 고정 문의 주소로 돌아온다. 임의 외부 return URL은 받지 않는다.
- 문의자는 Auth 계정을 생성하지 않는다. 브라우저에서 암호학적 난수 32바이트 문의 키와 대화 ID를 만들고 로컬 저장한다. 서버에는 SHA-256 해시만 보관하며 URL에 키를 넣지 않는다. 다른 기기나 브라우저에는 익명 문의 기록이 동기화되지 않는다. 첫 메시지를 보낼 때만 문의를 만든다.
- support_private의 두 표에 RLS를 적용하고 직접 표·시퀀스 접근을 거부한다. public에는 SECURITY INVOKER RPC만 노출한다. 비공개 함수는 문의 키 또는 현재 확인된 Google 계정을 대조한 뒤에만 조회·전송한다. 원문/AI 대화 테이블의 접근 권한은 바꾸지 않는다.
- 관리자 판단은 auth.users의 확인된 이메일, Google identity, 금지 상태를 사용한다. 클라이언트 이메일·수정 가능한 user_metadata는 권한 근거로 쓰지 않는다. 기존 다른 관리자라도 문의함은 지정 계정만 열 수 있다. 문의 키 해시·관리자 내부 ID는 응답에 반환하지 않는다.
- 메시지 ID를 재사용하여 응답 유실 재전송이 중복되지 않게 한다. 방문자·관리자 역할은 서버가 고정한다. HTML은 화면에서 textContent로 표시한다. 방문자에게 1분 10회 전송 제한을 적용하며 문의·답변은 각각 4,000자까지다. 대화는 100개씩 순서대로 읽고 문의함은 50개씩 표시한다.
- 열린 화면은 8초마다 새 대화와 답변을 확인한다. 관리자 접속·실시간 온라인 상태나 즉시 답변을 보장하는 표시는 하지 않는다. 현재 페이지가 숨겨져 있으면 주기 조회를 중단한다. 계정 변경·로그아웃 때 관리자 대화 화면을 비우고 오래된 요청 결과를 버린다.
- supabase/support-chat.sql을 원격 private_visitor_support_chat migration으로 적용했다. tests/support-chat-access.sql은 실제 DB에서 익명 A/B 분리, 직접 접근 거부, 조작 이메일·다른 Google 계정 거부, 지정 관리자 답변, 메시지 재전송, 긴 기록 조회, 호출 속도 제한을 확인 후 rollback한다. 시험 메시지와 시험 회원은 남지 않는다.
- 로컬 문의/AI 로그인 회귀 검사 14개 통과. 기존 테스트의 빠진 음성 입력 mock과 이전 복사/사용량 표시 기대값을 현재 승인된 화면 동작에 맞췄다. 새 문의 관련 보안 Advisor 경고는 없다.

참고: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Database RPC와 권한](https://supabase.com/docs/guides/database/functions).
