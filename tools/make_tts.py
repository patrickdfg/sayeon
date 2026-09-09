# -*- coding: utf-8 -*-
"""아직 음성이 없는 편을 컴퓨터 목소리(TTS)로 읽어 mp3 로 만들고 원고에 연결한다.

육성 녹음이 오기 전까지 임시로 쓰는 음성이다. 나중에 녹음이 오면 같은 번호로
파일만 바꿔 끼우고 sync 를 다시 만들면 된다.

쓰는 법 (tools/ 에서 실행):
    python -m pip install edge-tts        # 처음 한 번만
    python make_tts.py 159               # 한 편
    python make_tts.py 159 161 162       # 여러 편
    python make_tts.py --all             # 음성 없는 편 전부
    python build_sync.py base            # 이어서 문단 시간표 만들기 (필수)

육성 녹음과 같이 제목("성령 사연 159")을 먼저 읽고 본문으로 들어간다.
뷰어는 audio 가 있는 편의 제목을 따로 읽지 않기 때문이다.
"""
import asyncio
import io
import json
import os
import sys

import edge_tts

REPO = '..'                                  # tools/ 에서 실행한다
SAYEON = os.path.join(REPO, 'sayeon.json')
VOICE = 'ko-KR-HyunsuMultilingualNeural'     # 현수(남자). 선희(여자)는 ko-KR-SunHiNeural


def lines_of(p):
    """문단은 ["줄", ...] 또는 {p:[...]}, {h:"소제목"} 세 가지 꼴이다."""
    if isinstance(p, dict):
        if 'p' in p:
            return p['p']
        if 'h' in p:
            return [p['h']]
        return []
    return p if isinstance(p, list) else []


def build_text(e):
    parts = [e['title']]
    for p in e.get('paragraphs', []):
        body = ' '.join(lines_of(p)).strip()
        if body:
            parts.append(body)
    # 문단 사이 빈 줄 — 읽을 때 잠깐 쉰다
    return '\n\n'.join(parts)


def link_audio(no, rel_path):
    """sayeon.json 의 그 항목에 audio 줄을 끼워 넣는다.

    통째로 다시 쓰지 않고 문자열만 갈아 끼워, diff 가 그 한 줄만 바뀌게 한다.
    """
    with io.open(SAYEON, encoding='utf-8') as f:
        text = f.read()
    e = [x for x in json.loads(text) if x['no'] == no][0]
    if e.get('audio'):
        return False
    needle = ' {\n  "no": %d,\n  "title": "%s",\n' % (no, e['title'])
    if text.count(needle) != 1:
        raise SystemExit('%d 편 위치를 찾지 못했다 (%d 군데)' % (no, text.count(needle)))
    text = text.replace(needle, needle + '  "audio": "%s",\n' % rel_path, 1)
    io.open(SAYEON, 'w', encoding='utf-8', newline='').write(text)
    return True


async def main(args):
    data = json.load(io.open(SAYEON, encoding='utf-8'))
    by_no = {x['no']: x for x in data}
    targets = ([x['no'] for x in data if not x.get('audio')]
               if args == ['--all'] else [int(a) for a in args])

    print('만들 편: %d 개' % len(targets))
    for no in targets:
        e = by_no.get(no)
        if e is None:
            print('  %d 편: 원고 없음' % no)
            continue
        if e.get('audio'):
            print('  %d 편: 이미 음성 있음 (%s)' % (no, e['audio']))
            continue
        out = os.path.join(REPO, 'audio', '%d.mp3' % no)
        text = build_text(e)
        await edge_tts.Communicate(text, VOICE).save(out)
        print('  %d 편: 문단 %d, 글자 %d → %s (%s bytes)'
              % (no, len(e.get('paragraphs', [])), len(text),
                 out, format(os.path.getsize(out), ',')))
        link_audio(no, 'audio/%d.mp3' % no)

    print('\n이어서 문단 시간표를 만든다:  python build_sync.py base')


if __name__ == '__main__':
    if not sys.argv[1:]:
        raise SystemExit(__doc__)
    asyncio.run(main(sys.argv[1:]))
