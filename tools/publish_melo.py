# -*- coding: utf-8 -*-
"""성령사연을 MeloTTS(여자 목소리, CPU)로 읽어 게시한다 — 현수 음성 서버가 막혔을 때의 대안.

쓰는 법(깃허브 Actions '성령사연 Melo 음성 게시' 에서 돈다. MeloTTS 설치가 필요하다)
    python tools/publish_melo.py 179 180          # 아직 컴퓨터 음성이 없는 편
    python tools/publish_melo.py --replace 178    # 이미 Melo 음성이 있는 편을 다시 만들어 바꾼다

하는 일
  1. 제목과 문단을 **줄마다 따로** 읽고 줄 사이에 쉼을 넣어 audio/<번호>-melo[N].mp3 를 만든다.
     (현수 음성은 줄 끝마다 마침표를 붙여 쉬었는데, 줄을 한 덩어리로 이어 읽으면 쉼이 없어 빠르고 딱딱하다)
  2. 제목 다음 본문 문단의 시작 시간을 audio/sync.json 에 파일 이름 열쇠로 넣는다.
  3. sayeon.json 의 그 편에 "tts" 를 연결한다. --replace 면 옛 파일·시간표를 지우고 새 파일로 바꾼다.
     (파일 이름이 바뀌므로 폰에 남은 옛 소리를 쓰지 않는다)
원고와 육성(audio)은 바꾸지 않는다. SAYEON_PASS 환경변수가 필요하다.
"""
import contextlib
import io
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crypt  # noqa: E402
import make_tts  # noqa: E402

REPO = make_tts.REPO
LINE_GAP = 0.55      # 같은 문단 안에서 줄이 바뀔 때 쉬는 시간(초)
COMMA_GAP = 0.3      # 줄이 쉼표로 끝나 말이 이어질 때
PARA_GAP = 1.0       # 문단이 바뀔 때
END_MARKS = '.!?…。,”’)]}〉》'


def spoken_paragraphs(entry):
    """[[줄, ...], ...] — 첫 칸이 제목, 그다음은 원고 문단과 **같은 순서·같은 개수**(구분선처럼 읽을 줄이 없는
    문단은 빈 칸). 뷰어가 시간표의 몇 번째를 원고의 몇 번째 문단으로 보기 때문이다.
    <> 는 Melo 가 못 읽어 공백으로 바꾼다. 화면 원문은 그대로 두고, 음성에서만 줄 끝에 마침표를 붙인다
    (이미 문장부호가 있으면 안 붙인다)."""
    out = [[entry['title']]]
    for paragraph in entry.get('paragraphs', []):
        lines = []
        for line in make_tts.lines_of(paragraph):
            line = line.strip().translate(str.maketrans({'<': ' ', '>': ' '})).strip()
            if not line:
                continue
            if line[-1] not in END_MARKS:
                line += '.'
            lines.append(line)
        out.append(lines)
    return out


def next_name(no, old):
    """폰에 남은 옛 파일을 안 쓰도록 새 이름을 쓴다: 179-melo.mp3 → 179-melo2.mp3 → ..."""
    n = 1
    while True:
        name = '%d-melo%s.mp3' % (no, '' if n == 1 else n)
        rel = 'audio/' + name
        if rel != old and not os.path.exists(os.path.join(REPO, rel)):
            return rel
        n += 1


def relink(no, old, new):
    """이미 있는 "tts" 줄의 경로만 갈아 끼운다(통째로 다시 쓰지 않아 diff 가 한 줄이다)."""
    text = crypt.read_text(make_tts.SAYEON)
    needle = '"tts": "%s"' % old
    if text.count(needle) != 1:
        raise SystemExit('%d 편의 tts 줄을 찾지 못했습니다 (%d 군데)' % (no, text.count(needle)))
    crypt.write_text(make_tts.SAYEON, text.replace(needle, '"tts": "%s"' % new, 1))


def forget_old(old):
    path = os.path.join(REPO, old)
    if os.path.exists(path):
        os.remove(path)
    sync = json.load(io.open(make_tts.SYNC, encoding='utf-8'))
    if sync.pop(os.path.basename(old), None) is not None:
        io.open(make_tts.SYNC, 'w', encoding='utf-8', newline='').write(
            json.dumps(sync, ensure_ascii=False, separators=(',', ':')))


def render(model, np, paragraphs):
    rate = model.hps.data.sampling_rate
    parts, times, position = [], [], 0
    for lines in paragraphs:
        times.append(round(position / rate, 3))
        for at, line in enumerate(lines):
            # Melo 는 읽을 글을 화면에 찍는다. 잠긴 원고가 로그에 남지 않게 막는다.
            with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink):
                audio = model.tts_to_file(line, model.hps.data.spk2id['KR'], speed=1.0, quiet=True)
            if at == len(lines) - 1:
                gap = PARA_GAP
            else:
                gap = COMMA_GAP if line.endswith(',') else LINE_GAP
            pause = np.zeros(int(rate * gap), dtype=np.float32)
            parts += [audio, pause]
            position += len(audio) + len(pause)
    return rate, np.concatenate(parts), times


def main(numbers, replace):
    data = crypt.read_json(make_tts.SAYEON)
    todo = []
    for no in numbers:
        entry = next((e for e in data if e['no'] == no), None)
        if entry is None:
            raise SystemExit('%d 편 원고가 없습니다.' % no)
        old = entry.get('tts')
        if old and not replace:
            raise SystemExit('%d 편에는 이미 컴퓨터 음성이 있습니다(%s). 바꾸려면 --replace.' % (no, old))
        if replace and not old:
            raise SystemExit('%d 편에는 바꿀 컴퓨터 음성이 없습니다. --replace 없이 만드세요.' % no)
        todo.append((entry, old))

    import numpy as np
    import soundfile as sf
    import torch
    from melo.api import TTS
    torch.set_num_threads(4)
    model = TTS(language='KR', device='cpu')

    for entry, old in todo:
        no = entry['no']
        paragraphs = spoken_paragraphs(entry)
        body = len(paragraphs) - 1
        rate, wave, times = render(model, np, paragraphs)
        rel = next_name(no, old)
        out = os.path.join(REPO, rel)
        wav = out[:-4] + '.wav'
        sf.write(wav, wave, rate)
        try:
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-ac', '1', '-b:a', '128k', out], check=True)
        finally:
            if os.path.exists(wav):
                os.remove(wav)
        seconds = len(wave) / rate
        if seconds < 10 or os.path.getsize(out) < 10000:
            os.remove(out)
            raise SystemExit('%d 편: 만들어진 음성이 너무 짧습니다.' % no)
        make_tts.save_sync(no, times[1:], rel)      # 제목 다음 본문 문단부터
        if old:
            relink(no, old, rel)
            forget_old(old)
        else:
            make_tts.link_audio(no, rel)
        print('%d 편: 문단 %d, %.0f초 → %s (%s bytes)%s' % (
            no, body, seconds, rel, format(os.path.getsize(out), ','), ' (교체)' if old else ''))


if __name__ == '__main__':
    args = sys.argv[1:]
    replace = '--replace' in args
    numbers = [int(a) for a in args if a != '--replace']
    if not numbers:
        raise SystemExit(__doc__)
    main(numbers, replace)
