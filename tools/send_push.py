# -*- coding: utf-8 -*-
"""새 성령 사연이 올라오면, 설정에서 '새 사연 알림 → 받기'를 누른 기기로 알림을 보낸다.

쓰는 법 (저장소 루트에서):
    python tools/send_push.py          # 마지막 편을 아직 안 보냈으면 보낸다
    python tools/send_push.py --test   # 시험 알림 (보낸 기록을 남기지 않는다)

필요한 것:
    pip install pywebpush cryptography
    환경변수 SAYEON_PASS        원고 암호 (마지막 편 번호를 읽는다)
             VAPID_PRIVATE_KEY  알림 서명 열쇠 (짝인 공개 열쇠는 settings.js)
             PUSH_TOKEN         Supabase 명단을 읽는 발송 토큰 (supabase-push.sql)
    알림 비밀값이 없으면 아무것도 안 하고 끝난다 — 자동 게시를 멈추지 않기 위해서.

한 편은 한 번만 보낸다. 보내기 전에 Supabase 에 '이 편 보냄'을 먼저 적고,
이미 적혀 있으면 건너뛴다(같은 편을 고쳐서 다시 올려도 알림이 또 가지 않는다).
"""
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crypt  # noqa: E402

SITE = 'https://patrickdfg.github.io/sayeon/'
ENDPOINT_OK = re.compile(
    r'^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|'
    r'[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)/')


def supabase():
    """방문 통계가 쓰는 공개 주소와 공개 열쇠를 그대로 쓴다."""
    text = io.open(os.path.join(crypt.REPO, 'analytics-config.js'), encoding='utf-8').read()
    url = re.search(r'supabaseUrl:\s*"([^"]+)"', text).group(1).rstrip('/')
    key = re.search(r'supabaseAnonKey:\s*"([^"]+)"', text).group(1)
    return url, key


def rpc(name, body):
    url, key = supabase()
    req = urllib.request.Request(
        url + '/rest/v1/rpc/' + name, data=json.dumps(body).encode('utf-8'),
        headers={'apikey': key, 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode('utf-8')
    return json.loads(raw) if raw else None


def wait_for_pages(timeout=600):
    """알림을 눌렀는데 옛 목록이 보이면 안 되므로, 새 원고가 사이트에 올라갈 때까지 기다린다."""
    local = open(os.path.join(crypt.REPO, 'sayeon.json.enc'), 'rb').read()
    end = time.time() + timeout
    while time.time() < end:
        try:
            u = SITE + 'sayeon.json.enc?v=%d' % time.time()
            with urllib.request.urlopen(u, timeout=30) as r:
                if r.read() == local:
                    print('사이트에 새 원고가 올라간 것 확인')
                    return
        except Exception as e:  # 배포 중에는 잠깐 실패할 수 있다
            print('  사이트 확인 중: %s' % e)
        time.sleep(20)
    print('사이트 반영을 %d초 기다렸지만 확인 못 함 — 그래도 보낸다' % timeout)


def main(args):
    from pywebpush import WebPushException, webpush

    vapid = os.environ.get('VAPID_PRIVATE_KEY', '').strip()
    token = os.environ.get('PUSH_TOKEN', '').strip()
    if not vapid or not token:
        print('알림 비밀값(VAPID_PRIVATE_KEY, PUSH_TOKEN)이 없어 알림은 건너뜀')
        return

    test = '--test' in args
    if test:
        no = 'test'
        payload = {'title': '알림 시험', 'body': '새 사연 알림이 잘 옵니다.',
                   'url': '/sayeon/', 'tag': 'sayeon-test'}
    else:
        data = crypt.read_json(os.path.join(crypt.REPO, 'sayeon.json'))
        last = max(data, key=lambda e: e['no'])
        no = str(last['no'])
        wait_for_pages()
        if not rpc('push_claim', {'p_token': token, 'p_item_no': no}):
            print('%s편 알림은 이미 보냈음 — 건너뜀' % no)
            return
        payload = {'title': '새 성령 사연', 'body': '%s 이(가) 올라왔습니다' % last['title'],
                   'url': '/sayeon/#n=' + urllib.parse.quote(no), 'tag': 'sayeon-' + no}

    subs = rpc('push_list', {'p_token': token}) or []
    sent = gone = failed = 0
    for s in subs:
        if not ENDPOINT_OK.match(s['endpoint']):
            continue
        try:
            webpush(subscription_info={'endpoint': s['endpoint'],
                                       'keys': {'p256dh': s['p256dh'], 'auth': s['auth']}},
                    data=json.dumps(payload, ensure_ascii=False),
                    vapid_private_key=vapid,
                    vapid_claims={'sub': 'https://patrickdfg.github.io'},
                    ttl=24 * 3600)
            sent += 1
        except WebPushException as e:
            status = e.response.status_code if e.response is not None else None
            if status in (404, 410):      # 알림을 끄거나 앱을 지운 기기
                rpc('push_drop', {'p_token': token, 'p_endpoint': s['endpoint']})
                gone += 1
            else:
                failed += 1
                print('  보내기 실패 (%s): %s' % (status, str(e)[:120]))
    print('%s 알림: 명단 %d대, 보냄 %d, 사라진 기기 정리 %d, 실패 %d'
          % (no, len(subs), sent, gone, failed))


if __name__ == '__main__':
    main(sys.argv[1:])
