# -*- coding: utf-8 -*-
"""성령사연을 Azure Speech 공식 API 의 현수(ko-KR-HyunsuMultilingualNeural)로 읽어 게시한다.

edge-tts(비공식 길)가 막혔을 때 쓰는 공식 길이다. 무료 등급(F0, 월 50만 자)으로 쓴다.
쓰는 법(깃허브 Actions '성령사연 Azure 현수 음성 게시' 에서 돈다)
    python tools/publish_azure.py 179 180          # 아직 컴퓨터 음성이 없는 편
    python tools/publish_azure.py --replace 178    # 이미 Melo·현수 음성이 있는 편을 현수(Azure)로 바꾼다

저장소 비밀값 AZURE_SPEECH_KEY, AZURE_SPEECH_REGION 이 있어야 한다(키는 어디에도 적지 않는다).
하는 일은 publish_melo.py 와 같다. 줄마다 쉼(SSML break)을 넣고 문단 단위로 요청해 이어 붙인다.
  - 제목과 각 문단을 한 번씩 요청한다(한 편에 요청 10번 안팎). 문단 안의 줄 사이는 <break> 로 쉰다.
  - 문단 시작 시간표를 audio/sync.json 에, "tts" 를 sayeon.json 에 연결한다. 원고와 육성은 건드리지 않는다.
무료 한도를 지키려고 한 번에 글자 수가 많으면(MAX_CHARS) 멈춘다. 한도를 넘는 일은 요청이 거절될 뿐 과금되지 않는
무료 등급을 쓰는 것이 전제다(계정에서 F0 인지 확인할 것).
"""
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crypt  # noqa: E402
import make_tts  # noqa: E402
import publish_melo as pm  # noqa: E402

REPO = make_tts.REPO
VOICE = 'ko-KR-HyunsuMultilingualNeural'
FORMAT = 'riff-24khz-16bit-mono-pcm'
RATE = '0%'
MAX_CHARS = 30000          # 한 번 돌릴 때 글자 수 상한(무료 월 50만 자를 지키는 안전장치)


def ssml_for(lines):
    """한 문단의 줄들을 SSML 로. 줄 사이는 쉼(break)으로 쉰다."""
    pieces = []
    for at, line in enumerate(lines):
        pieces.append(escape(line))
        if at < len(lines) - 1:
            pause = int((pm.COMMA_GAP if line.endswith(',') else pm.LINE_GAP) * 1000)
            pieces.append('<break time="%dms"/>' % pause)
    return ('<speak version="1.0" xml:lang="ko-KR"><voice name="%s"><prosody rate="%s">%s</prosody></voice></speak>'
            % (VOICE, RATE, ''.join(pieces)))


def synth(ssml, key, region):
    """한 번 요청해 WAV 바이트를 받는다. 429·503 은 과금되지 않으므로 잠깐 쉬었다 다시 한다(최대 3번)."""
    req = urllib.request.Request(
        'https://%s.tts.speech.microsoft.com/cognitiveservices/v1' % region,
        data=ssml.encode('utf-8'),
        headers={'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml',
                 'X-Microsoft-OutputFormat': FORMAT, 'User-Agent': 'sayeon-tts'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code in (429, 503) and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit('Azure 가 요청을 거절했습니다 (HTTP %d): %s' % (
                error.code, error.read()[:300].decode('utf-8', 'replace')))
        except urllib.error.URLError as error:
            raise SystemExit('Azure 에 연결하지 못했습니다: %s' % error.reason)


def render(paragraphs, key, region, post=synth):
    """문단마다 요청해 이어 붙인다. (샘플레이트, PCM 바이트, 문단 시작 시간들) 을 돌려준다."""
    frames, times, position, params = [], [], 0, None
    for lines in paragraphs:
        times.append(round(position / (params[2] if params else 24000), 3))
        if not lines:
            continue
        data = post(ssml_for(lines), key, region)
        with wave.open(io.BytesIO(data), 'rb') as wav:
            if params and wav.getparams()[:3] != params[:3]:
                raise SystemExit('음성 형식이 문단마다 다릅니다.')
            params = wav.getparams()
            pcm = wav.readframes(wav.getnframes())
        silence = b'\x00' * (2 * int(params[2] * pm.PARA_GAP))
        frames += [pcm, silence]
        position += (len(pcm) + len(silence)) // 2
    if not params:
        raise SystemExit('읽을 글이 없습니다.')
    return params[2], b''.join(frames), times


def next_name(no, old):
    n = 1
    while True:
        rel = 'audio/%d%s.mp3' % (no, '' if n == 1 else '-v%d' % n)
        if rel != old and not os.path.exists(os.path.join(REPO, rel)):
            return rel
        n += 1


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


def main(numbers, replace, post=synth):
    key = os.environ.get('AZURE_SPEECH_KEY')
    region = os.environ.get('AZURE_SPEECH_REGION', '')
    if not key or not region:
        raise SystemExit('저장소 비밀값 AZURE_SPEECH_KEY, AZURE_SPEECH_REGION 을 넣어 주세요 (docs/TTS_COMPARISON.md).')
    if not region.replace('-', '').isalnum():
        raise SystemExit('AZURE_SPEECH_REGION 이 올바르지 않습니다.')
    data = crypt.read_json(make_tts.SAYEON)
    todo, chars = [], 0
    for no in numbers:
        entry = next((e for e in data if e['no'] == no), None)
        if entry is None:
            raise SystemExit('%d 편 원고가 없습니다.' % no)
        old = entry.get('tts')
        if old and not replace:
            raise SystemExit('%d 편에는 이미 컴퓨터 음성이 있습니다(%s). 바꾸려면 --replace.' % (no, old))
        if replace and not old:
            raise SystemExit('%d 편에는 바꿀 컴퓨터 음성이 없습니다. --replace 없이 만드세요.' % no)
        paragraphs = pm.spoken_paragraphs(entry)
        chars += sum(len(line) for lines in paragraphs for line in lines)
        todo.append((entry, old, paragraphs))
    if chars > MAX_CHARS:
        raise SystemExit('글자 수 %d 가 한 번에 돌릴 상한(%d)을 넘습니다. 나눠서 돌리세요.' % (chars, MAX_CHARS))
    print('읽을 글자 수 %d (무료 월 50만 자 중)' % chars)

    for entry, old, paragraphs in todo:
        no = entry['no']
        rate, pcm, times = render(paragraphs, key, region, post)
        rel = next_name(no, old)
        out = os.path.join(REPO, rel)
        wav_path = out[:-4] + '.wav'
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with wave.open(wav_path, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(pcm)
        try:
            subprocess.run([ffmpeg(), '-v', 'error', '-y', '-i', wav_path, '-ac', '1', '-b:a', '96k', out], check=True)
        finally:
            if os.path.exists(wav_path):
                os.remove(wav_path)
        seconds = len(pcm) / 2 / rate
        if seconds < 10 or os.path.getsize(out) < 10000:
            os.remove(out)
            raise SystemExit('%d 편: 만들어진 음성이 너무 짧습니다.' % no)
        make_tts.save_sync(no, times[1:], rel)
        if old:
            pm.relink(no, old, rel)
            pm.forget_old(old)
        else:
            make_tts.link_audio(no, rel)
        print('%d 편: 문단 %d, %.0f초 → %s (%s bytes)%s' % (
            no, len(paragraphs) - 1, seconds, rel, format(os.path.getsize(out), ','), ' (교체)' if old else ''))


if __name__ == '__main__':
    args = sys.argv[1:]
    replace = '--replace' in args
    numbers = [int(a) for a in args if a != '--replace']
    if not numbers:
        raise SystemExit(__doc__)
    main(numbers, replace)
