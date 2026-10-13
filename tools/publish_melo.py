# -*- coding: utf-8 -*-
"""성령사연 한 편을 MeloTTS(여자 목소리, CPU)로 읽어 게시한다 — 현수 음성 서버가 막혔을 때의 대안.

쓰는 법(깃허브 Actions '성령사연 Melo 음성 게시' 에서 돈다. MeloTTS 설치가 필요하다)
    python tools/publish_melo.py 179

하는 일
  1. 그 편의 제목과 문단을 Melo 로 읽어 audio/<번호>-melo.mp3 를 만든다.
  2. 제목 다음 본문 문단의 시작 시간을 audio/sync.json 에 파일 이름 열쇠로 넣는다.
  3. sayeon.json 의 그 편에 "tts": "audio/<번호>-melo.mp3" 를 연결한다.
이미 tts(현수·Melo)가 있는 편은 건드리지 않는다. 원고와 육성(audio)은 바꾸지 않는다.
SAYEON_PASS 환경변수가 필요하다. 연결·시간표 저장은 make_tts.py 와 같은 함수를 쓴다.
"""
import contextlib
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crypt  # noqa: E402
import make_tts  # noqa: E402

REPO = make_tts.REPO


def spoken_paragraphs(entry):
    """제목 먼저, 그다음 문단마다 한 덩어리. <> 는 Melo 가 못 읽어 공백으로 바꾼다."""
    out = [entry['title']]
    for paragraph in entry.get('paragraphs', []):
        lines = [line.strip() for line in make_tts.lines_of(paragraph) if line.strip()]
        if lines:
            out.append(' '.join(lines))
    return [text.translate(str.maketrans({'<': ' ', '>': ' '})) for text in out]


def main(no):
    data = crypt.read_json(make_tts.SAYEON)
    entry = next((e for e in data if e['no'] == no), None)
    if entry is None:
        raise SystemExit('%d 편 원고가 없습니다.' % no)
    if entry.get('tts'):
        raise SystemExit('%d 편에는 이미 컴퓨터 음성이 있습니다(%s). 건드리지 않습니다.' % (no, entry['tts']))
    texts = spoken_paragraphs(entry)
    body = len(texts) - 1
    if body != len([p for p in entry.get('paragraphs', []) if make_tts.lines_of(p)]):
        raise SystemExit('문단 수를 세지 못했습니다.')

    import numpy as np
    import soundfile as sf
    import torch
    from melo.api import TTS
    torch.set_num_threads(4)
    model = TTS(language='KR', device='cpu')
    rate = model.hps.data.sampling_rate
    parts, times, position = [], [], 0
    for text in texts:
        times.append(round(position / rate, 3))
        # Melo 는 읽을 글을 화면에 찍는다. 잠긴 원고가 로그에 남지 않게 막는다.
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink):
            audio = model.tts_to_file(text, model.hps.data.spk2id['KR'], speed=1.0, quiet=True)
        gap = np.zeros(int(rate * 0.5), dtype=np.float32)
        parts += [audio, gap]
        position += len(audio) + len(gap)

    rel = 'audio/%d-melo.mp3' % no
    out = os.path.join(REPO, rel)
    wav = out[:-4] + '.wav'
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sf.write(wav, np.concatenate(parts), rate)
    try:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-ac', '1', '-b:a', '128k', out], check=True)
    finally:
        if os.path.exists(wav):
            os.remove(wav)
    seconds = position / rate
    if seconds < 10 or os.path.getsize(out) < 10000:
        os.remove(out)
        raise SystemExit('만들어진 음성이 너무 짧습니다.')

    make_tts.save_sync(no, times[1:], rel)      # 제목 다음 본문 문단부터
    make_tts.link_audio(no, rel)
    print('%d 편: 문단 %d, %.0f초 → %s (%s bytes)' % (no, body, seconds, rel, format(os.path.getsize(out), ',')))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(int(sys.argv[1]))
