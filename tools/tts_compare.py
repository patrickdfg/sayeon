"""Isolated, public test text: never changes published sermon data or audio."""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
import wave
from xml.sax.saxutils import escape

PARAGRAPHS = [
    '안녕하세요. 오늘은 차분하고 자연스러운 한국어 낭독을 비교해 보겠습니다.',
    '아침 햇살이 창문으로 들어옵니다. 잠시 숨을 고르고, 오늘 해야 할 일을 하나씩 생각해 봅니다. 서두르지 않아도 괜찮습니다.',
    '서로의 이야기를 끝까지 듣고, 따뜻한 말 한마디를 건네 보세요. 작은 배려가 하루를 바꿀 수 있습니다. 왜 그럴까요? 진심은 말의 속도보다 오래 남기 때문입니다.',
    '오늘은 십월 십이일입니다. 오후 세 시 삼십 분에 다시 만나겠습니다. 여기까지 음성 비교를 위한 예문이었습니다.',
]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('engine', choices=['melo', 'azure', 'gemini'])
    parser.add_argument('--voice', default='Charon', help='Gemini voice name')
    parser.add_argument('--output', default='tts-samples')
    parser.add_argument('--story', type=int, help='2026 story number')
    args = parser.parse_args()
    paragraphs = PARAGRAPHS
    if args.story is not None:
        import crypt
        data = crypt.read_json(str(Path(__file__).resolve().parent.parent / 'sayeon.json'))
        entry = next(e for e in data if int(e['no']) == args.story)
        paragraphs = [entry['title']]
        for paragraph in entry['paragraphs']:
            lines = paragraph.get('p', [paragraph.get('h', '')]) if isinstance(paragraph, dict) else paragraph
            text = ' '.join(line.strip() for line in lines if line.strip())
            if text:
                paragraphs.append(text)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    if args.story is None:
        (out / 'sample-text.txt').write_text('\n\n'.join(paragraphs), encoding='utf-8')
    started = time.monotonic()
    if args.engine == 'melo':
        import numpy as np
        import soundfile as sf
        import torch
        from melo.api import TTS
        torch.set_num_threads(4)
        model = TTS(language='KR', device='cpu')
        sr = model.hps.data.sampling_rate
        parts, times, position = [], [], 0
        for paragraph in paragraphs:
            times.append(round(position / sr, 3))
            # Melo prints input sentences internally; keep protected manuscripts out of logs.
            import contextlib
            with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink):
                audio = model.tts_to_file(paragraph.translate(str.maketrans({'<': ' ', '>': ' '})), model.hps.data.spk2id['KR'], speed=1.0, quiet=True)
            parts.append(audio)
            parts.append(np.zeros(int(sr * 0.5), dtype=np.float32))
            position += len(audio) + len(parts[-1])
        wav = out / (f'melo-sayeon-{args.story}.wav' if args.story else 'melo-korean.wav')
        sf.write(wav, np.concatenate(parts), sr)
        (out / 'melo-paragraph-times.json').write_text(json.dumps(times), encoding='utf-8')
    elif args.engine == 'gemini':
        key = os.environ.get('GEMINI_API_KEY')
        if not key:
            raise SystemExit('Set GEMINI_API_KEY in repository secrets; never paste keys into source.')
        frames, times, position, sr = [], [], 0, 24000
        for paragraph in paragraphs:
            body = json.dumps({
                'model': 'gemini-3.8-flash-tts',
                'input': [{'type': 'user_input', 'content': [{
                    'type': 'text', 'text': paragraph,
                    'annotations': [{'type': 'speech_metadata', 'style': '차분하고 따뜻한 목소리로 천천히 또박또박 낭독'}],
                }]}],
                'response_format': {'type': 'audio'},
                'generation_config': {'speech_config': [{'voice': args.voice}]},
            }).encode('utf-8')
            req = urllib.request.Request(
                'https://generativelanguage.googleapis.com/v1beta/interactions',
                data=body, headers={'x-goog-api-key': key, 'Content-Type': 'application/json'})
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(req, timeout=180) as response:
                        result = json.load(response)
                    break
                except urllib.error.HTTPError as error:
                    # Free tier allows few requests per minute; wait instead of failing the whole story.
                    if error.code != 429 or attempt == 3:
                        raise
                    time.sleep(30)
            audio = [c for step in result['steps'] if step.get('type') == 'model_output'
                     for c in step.get('content', []) if c.get('type') == 'audio'][-1]
            with wave.open(io.BytesIO(base64.b64decode(audio['data']))) as part:
                sr = part.getframerate()
                pcm = part.readframes(part.getnframes())
            times.append(round(position / sr, 3))
            frames.append(pcm + b'\0' * (sr // 2 * 2))
            position += len(frames[-1]) // 2
        wav = out / (f'gemini-{args.voice}-{args.story}.wav' if args.story else f'gemini-{args.voice}.wav')
        with wave.open(str(wav), 'wb') as whole:
            whole.setnchannels(1)
            whole.setsampwidth(2)
            whole.setframerate(sr)
            whole.writeframes(b''.join(frames))
        (out / 'gemini-paragraph-times.json').write_text(json.dumps(times), encoding='utf-8')
    else:
        key = os.environ.get('AZURE_SPEECH_KEY')
        region = os.environ.get('AZURE_SPEECH_REGION')
        if not key or not region:
            raise SystemExit('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in repository secrets; never paste keys into source.')
        if not region.replace('-', '').isalnum():
            raise SystemExit('Invalid Azure region')
        # One short request only. No loops/retries that could consume extra quota.
        body = '<break time="500ms"/>'.join(escape(p) for p in paragraphs)
        ssml = '<speak version="1.0" xml:lang="ko-KR"><voice name="ko-KR-HyunsuMultilingualNeural"><prosody rate="0%">' + body + '</prosody></voice></speak>'
        req = urllib.request.Request(
            f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1',
            data=ssml.encode('utf-8'), headers={
                'Ocp-Apim-Subscription-Key': key,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
                'User-Agent': 'sayeon-tts-comparison',
            })
        wav = out / (f'azure-hyunsu-{args.story}.wav' if args.story else 'azure-hyunsu.wav')
        with urllib.request.urlopen(req, timeout=120) as response:
            wav.write_bytes(response.read())
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-ac', '1', '-b:a', '128k', str(wav.with_suffix('.mp3'))], check=True)
    probe = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(wav)])
    seconds = float(json.loads(probe)['format']['duration'])
    if seconds < 10 or wav.stat().st_size < 10000:
        raise RuntimeError('Audio is unexpectedly short or empty')
    info = {'engine': args.engine, 'duration_seconds': seconds, 'generation_seconds': round(time.monotonic()-started, 2), 'characters': sum(map(len, paragraphs))}
    (out / (args.engine + '-report.json')).write_text(json.dumps(info, indent=2), encoding='utf-8')
    print(json.dumps(info))

if __name__ == '__main__':
    main()
