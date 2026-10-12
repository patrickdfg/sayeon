# -*- coding: utf-8 -*-
"""edge-tts 가 마이크로소프트 서버에서 403 으로 거절될 때, 어느 Edge 버전 표시를 받아 주는지 시험한다(임시 진단)."""
import asyncio

import edge_tts
import edge_tts.communicate as M

BASE_UA = dict(M.WSS_HEADERS)


async def attempt(label, version, major):
    M.SEC_MS_GEC_VERSION = '1-' + version
    hdr = dict(BASE_UA)
    hdr['User-Agent'] = BASE_UA['User-Agent'].replace('Chrome/143.0.0.0', 'Chrome/%s.0.0.0' % major).replace(
        'Edg/143.0.0.0', 'Edg/%s.0.0.0' % major)
    M.WSS_HEADERS = hdr
    try:
        got = 0
        async for chunk in edge_tts.Communicate('시험입니다.', 'ko-KR-HyunsuMultilingualNeural').stream():
            if chunk['type'] == 'audio':
                got += len(chunk['data'])
        print('결과', label, version, 'OK', got, flush=True)
        return True
    except Exception as error:
        print('결과', label, version, 'FAIL', type(error).__name__, str(error)[:60].replace('\n', ' '), flush=True)
        return False


async def main():
    await attempt('기본', '143.0.3650.75', 143)
    for major in range(140, 160):
        await attempt('후보', '%d.0.0.0' % major, major)


asyncio.run(main())
