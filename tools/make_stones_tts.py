# -*- coding: utf-8 -*-
"""월명동 돌·나무 이야기의 TTS 음성을 만든다.

쓰는 법 (tools/ 에서 실행):
    python make_stones_tts.py 1
    python make_stones_tts.py 1 2 3

결과는 stones/audio/<번호>.mp3 에 저장한다. 제목과 번호를 먼저 읽고
메타 정보와 본문을 차례로 읽는다.
"""
import asyncio
import io
import json
import os
import re
import sys

import edge_tts


REPO = '..'
STONES_HTML = os.path.join(REPO, 'stones', 'index.html')
VOICE = 'ko-KR-HyunsuMultilingualNeural'


def load_data():
    text = io.open(STONES_HTML, encoding='utf-8').read()
    match = re.search(r'^const DATA = (\[.*?\]);\s*$', text, re.M | re.S)
    if not match:
        raise SystemExit('stones/index.html 에서 DATA를 찾지 못했습니다.')
    return json.loads(match.group(1))


def link_audio(number, path):
    text = io.open(STONES_HTML, encoding='utf-8').read()
    match = re.search(r'^const RECORDED_AUDIO = (\{.*\});$', text, re.M)
    if not match:
        raise SystemExit('stones/index.html 에서 RECORDED_AUDIO를 찾지 못했습니다.')
    audio = json.loads(match.group(1))
    audio[str(number)] = path
    replacement = 'const RECORDED_AUDIO = %s;' % json.dumps(
        audio, ensure_ascii=False, separators=(',', ':'))
    text = text[:match.start()] + replacement + text[match.end():]
    io.open(STONES_HTML, 'w', encoding='utf-8', newline='').write(text)


def build_text(item):
    parts = ['%s번, %s.' % (item['num'], item['title'])]
    if item.get('meta'):
        parts.append(item['meta'] + '.')
    section_indexes = []
    for section in item.get('sections', []):
        body = section.get('text', '').strip()
        if body:
            section_indexes.append(len(parts))
            parts.append(body + ('' if body[-1:] in '.!?' else '.'))
    text = '\n\n'.join(parts)
    starts = []
    offset = 0
    for index, part in enumerate(parts):
        if index in section_indexes:
            starts.append(offset)
        offset += len(part) + 2
    return text, starts


async def synthesize(text, out):
    boundaries = []
    cursor = 0
    with open(out, 'wb') as audio:
        communicate = edge_tts.Communicate(
            text, VOICE, boundary='SentenceBoundary')
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                audio.write(chunk['data'])
            elif chunk['type'] == 'SentenceBoundary':
                body = chunk.get('text', '')
                pos = text.find(body, cursor)
                if pos < 0:
                    pos = cursor
                boundaries.append((pos, chunk['offset'] / 10_000_000))
                cursor = pos + len(body)
    return boundaries


def section_times(starts, boundaries):
    times = []
    for start in starts:
        following = [time for pos, time in boundaries if pos >= start]
        times.append(round(following[0] if following else boundaries[-1][1], 2))
    return times


async def main(args):
    if not args:
        raise SystemExit(__doc__)
    data = {str(item['num']): item for item in load_data()}
    out_dir = os.path.join(REPO, 'stones', 'audio')
    os.makedirs(out_dir, exist_ok=True)
    sync_path = os.path.join(out_dir, 'sync.json')
    sync = (json.load(io.open(sync_path, encoding='utf-8'))
            if os.path.exists(sync_path) else {})

    for number in args:
        item = data.get(str(number))
        if item is None:
            print('%s번: 원고 없음' % number)
            continue
        out = os.path.join(out_dir, '%s.mp3' % number)
        text, starts = build_text(item)
        boundaries = await synthesize(text, out)
        if boundaries:
            sync[str(number)] = section_times(starts, boundaries)
        link_audio(number, 'audio/%s.mp3' % number)
        print('%s번 %s: 글자 %d → %s (%s bytes)'
                 % (number, item['title'], len(text), out,
                 format(os.path.getsize(out), ',')))

    io.open(sync_path, 'w', encoding='utf-8', newline='').write(
        json.dumps(sync, ensure_ascii=False, separators=(',', ':')))
    print('문단 시간표 → %s' % sync_path)


if __name__ == '__main__':
    asyncio.run(main(sys.argv[1:]))
