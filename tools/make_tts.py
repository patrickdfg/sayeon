# -*- coding: utf-8 -*-
"""아직 음성이 없는 편을 컴퓨터 목소리(TTS)로 읽어 mp3 로 만들고 원고에 연결한다.

육성 녹음이 오기 전까지 임시로 쓰는 음성이다. 나중에 녹음이 오면 같은 번호로
파일만 바꿔 끼우고 sync 를 다시 만들면 된다.

쓰는 법 (tools/ 에서 실행):
    python -m pip install edge-tts        # 처음 한 번만
    python make_tts.py 159               # 한 편
    python make_tts.py 159 161 162       # 여러 편
    python make_tts.py --all             # 음성 없는 편 전부
    python make_tts.py --all --limit 40  # 그중 앞에서 40 편만
    문단 시간표도 동시에 생성한다. 육성 녹음만 build_sync.py로 맞춘다.

육성 녹음과 같이 제목("성령 사연 159")을 먼저 읽고 본문으로 들어간다.
뷰어는 audio 가 있는 편의 제목을 따로 읽지 않기 때문이다.
"""
import asyncio
import io
import json
import os
import re
import subprocess
import sys
import tempfile

import crypt
import edge_tts
import imageio_ffmpeg
from mutagen.mp3 import MP3

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAYEON = os.path.join(REPO, 'sayeon.json')   # 실제 파일은 sayeon.json.enc (잠겨 있다)
SYNC = os.path.join(REPO, 'audio', 'sync.json')
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
    paragraph_indexes = []
    for p in e.get('paragraphs', []):
        body = ' '.join(lines_of(p)).strip()
        # 짧은 한 음절 질문인 '왜?'는 현수 TTS에서 음높이가 튀는 경우가 있어
        # 화면 원문은 유지하고 음성에서만 자연스러운 연결어로 읽는다.
        body = body.replace('왜?', '왜냐하면,')
        if body:
            paragraph_indexes.append(len(parts))
            parts.append(body)
    # 문단 사이 빈 줄 — 읽을 때 잠깐 쉰다
    text = '\n\n'.join(parts)
    starts = []
    offset = 0
    for index, part in enumerate(parts):
        if index in paragraph_indexes:
            starts.append(offset)
        offset += len(part) + 2
    return text, starts


async def synthesize_part(text, out, pitch='+0Hz', rate='+0%'):
    """한 구간의 음성과 문장 경계를 만든다."""
    boundaries = []
    cursor = 0
    with open(out, 'wb') as audio:
        communicate = edge_tts.Communicate(
            text, VOICE, pitch=pitch, rate=rate,
            boundary='SentenceBoundary')
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


def audio_duration(path):
    """mp3의 실제 재생 시간을 초 단위로 구한다."""
    return float(MP3(path).info.length)


async def synthesize(text, out):
    """음성과 문장 경계를 만들고, 필요한 경우 짧은 '왜?'를 별도로 잇는다."""
    if '왜?' not in text:
        return await synthesize_part(text, out)

    # 한 음절 질문은 현수 음성의 음높이가 순간적으로 튀는 경우가 있다.
    # 화면 원문은 그대로 두고 '왜?'만 같은 현수 목소리로 따로 생성해
    # 음높이와 속도를 낮춘 뒤 앞뒤 음성과 연결한다.
    pieces = [piece for piece in re.split(r'(왜\?)', text) if piece]
    boundaries = []
    char_offset = 0
    time_offset = 0.0
    with tempfile.TemporaryDirectory(prefix='sayeon_tts_') as temp_dir:
        audio_files = []
        for index, piece in enumerate(pieces):
            path = os.path.join(temp_dir, '%03d.mp3' % index)
            is_why = piece == '왜?'
            spoken = '왜' if is_why else piece
            part_boundaries = await synthesize_part(
                spoken, path,
                pitch='-18Hz' if is_why else '+0Hz',
                rate='-8%' if is_why else '+0%')
            boundaries.extend(
                (char_offset + pos, time_offset + when)
                for pos, when in part_boundaries)
            audio_files.append(path)
            char_offset += len(piece)
            time_offset += audio_duration(path)

        concat_list = os.path.join(temp_dir, 'files.txt')
        with io.open(concat_list, 'w', encoding='utf-8', newline='') as stream:
            for path in audio_files:
                stream.write("file '%s'\n" % path.replace("'", "'\\''"))
        subprocess.check_call([
            imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y',
            '-f', 'concat', '-safe', '0',
            '-i', concat_list, '-c', 'copy', out
        ])
    return boundaries


def paragraph_times(starts, boundaries):
    if not boundaries:
        raise RuntimeError('TTS 문장 시간 정보를 받지 못했습니다.')
    times = []
    for start in starts:
        following = [time for pos, time in boundaries if pos >= start]
        times.append(round(following[0] if following else boundaries[-1][1], 2))
    return times


def save_sync(no, times):
    sync = (json.load(io.open(SYNC, encoding='utf-8'))
            if os.path.exists(SYNC) else {})
    sync[str(no)] = times
    io.open(SYNC, 'w', encoding='utf-8', newline='').write(
        json.dumps(sync, ensure_ascii=False, separators=(',', ':')))


def link_audio(no, rel_path):
    """sayeon.json 의 그 항목에 audio 줄을 끼워 넣는다.

    통째로 다시 쓰지 않고 문자열만 갈아 끼워, diff 가 그 한 줄만 바뀌게 한다.
    """
    text = crypt.read_text(SAYEON)
    e = [x for x in json.loads(text) if x['no'] == no][0]
    if e.get('audio'):
        return False
    needle = ' {\n  "no": %d,\n  "title": "%s",\n' % (no, e['title'])
    if text.count(needle) != 1:
        raise SystemExit('%d 편 위치를 찾지 못했다 (%d 군데)' % (no, text.count(needle)))
    # "tts": true 로 컴퓨터 목소리임을 표시한다.
    # 뷰어는 이것으로 육성 녹음(🎙️)과 컴퓨터 목소리(🤖)를 가른다.
    # 나중에 육성이 오면 파일을 바꿔 끼우고 이 줄을 지운다.
    text = text.replace(
        needle, needle + '  "audio": "%s",\n  "tts": true,\n' % rel_path, 1)
    crypt.write_text(SAYEON, text)
    return True


async def main(args):
    limit = 0
    if '--limit' in args:
        at = args.index('--limit')
        limit = int(args[at + 1])
        args = args[:at] + args[at + 2:]

    data = crypt.read_json(SAYEON)
    by_no = {x['no']: x for x in data}
    targets = ([x['no'] for x in data if not x.get('audio')]
               if args == ['--all'] else [int(a) for a in args])
    if limit:
        targets = targets[:limit]

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
        text, starts = build_text(e)
        boundaries = await synthesize(text, out)
        save_sync(no, paragraph_times(starts, boundaries))
        print('  %d 편: 문단 %d, 글자 %d → %s (%s bytes)'
              % (no, len(e.get('paragraphs', [])), len(text),
                 out, format(os.path.getsize(out), ',')))
        link_audio(no, 'audio/%d.mp3' % no)

    print('\n문단 시간표도 함께 만들었습니다.')


if __name__ == '__main__':
    if not sys.argv[1:]:
        raise SystemExit(__doc__)
    asyncio.run(main(sys.argv[1:]))
