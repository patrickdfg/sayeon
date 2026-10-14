# -*- coding: utf-8 -*-
# 성령사연 육성 녹음(audio/<번호>.m4a)의 잡음·공간 울림을 AI(DeepFilterNet)로 줄이고 음량을 맞춰 제자리에 바꿔 넣는다.
"""쓰는 법 (저장소 맨 위에서 실행)

    python tools/clean_voice.py audio/169.m4a audio/170.m4a   # 지정한 파일
    python tools/clean_voice.py --changed <이전커밋> <지금커밋>   # 그 사이에 새로 들어오거나 바뀐 육성만

- 한 번 보정한 파일은 audio/clean.json 에 지문(sha256)을 적어 두고 다시 하지 않는다.
  녹음을 새로 바꿔 넣으면 지문이 달라져 다시 보정한다.
- 길이는 바뀌지 않는다(지연 보정 -D). 그래서 audio/sync.json 문단 시간표는 그대로 쓴다.
- 결과 검사(길이·조용한 구간 음량)를 통과하지 못하면 원본을 그대로 두고 실패로 끝낸다.
- 원본은 덮어쓰지만 git 기록에 남아 있어 되돌릴 수 있다.
"""
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(REPO, 'audio', 'clean.json')
DF_URL = ('https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/'
          'deep-filter-0.5.6-x86_64-unknown-linux-musl')
DF_BIN = os.environ.get('DEEP_FILTER') or os.path.join(REPO, '.seg_cache', 'deep-filter')

# 잡음 제거 뒤 다듬기: 저음 웅웅거림 제거, 울림 대역(300Hz) 약간 깎기, 발음(3kHz) 약간 올리기,
# 음량은 현수 음성과 같은 -18.4 LUFS (match_volume.py 와 같은 값 — 다르면 둘이 서로 되돌린다)
POST = ('highpass=f=80,equalizer=f=300:t=q:w=1:g=-3,equalizer=f=3000:t=q:w=1:g=2,'
        'acompressor=threshold=-22dB:ratio=3:attack=10:release=200:makeup=2,'
        'loudnorm=I=-18.4:TP=-1.5:LRA=9')


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def run(*cmd):
    subprocess.run(cmd, check=True)


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                          '-of', 'csv=p=0', path], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def quiet_db(path):
    """조용한 구간(하위 10%) 음량. 잡음이 줄었는지 보는 데 쓴다."""
    import numpy as np
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '16000',
                          '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    n = 800
    x = x[:len(x) // n * n].reshape(-1, n)
    d = 20 * np.log10(np.sqrt(np.mean(x ** 2, 1)) + 1e-9)
    return float(np.percentile(d, 10))


def ensure_bin():
    if os.path.isfile(DF_BIN) and os.access(DF_BIN, os.X_OK):
        return
    os.makedirs(os.path.dirname(DF_BIN), exist_ok=True)
    print('DeepFilterNet 실행 파일 받는 중...', flush=True)
    urllib.request.urlretrieve(DF_URL, DF_BIN)
    os.chmod(DF_BIN, os.stat(DF_BIN).st_mode | stat.S_IEXEC)


def clean(rel, log):
    src = os.path.join(REPO, rel)
    if log.get(rel) == sha(src):
        print(f'{rel}: 이미 보정함, 건너뜀')
        return True
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'in.wav')
        run('ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '48000',
            '-c:a', 'pcm_s16le', wav)
        run(DF_BIN, '-D', '--pf', '-o', os.path.join(tmp, 'df'), wav)
        out = os.path.join(tmp, 'out' + os.path.splitext(src)[1])
        codec = ['-c:a', 'aac', '-b:a', '128k'] if src.endswith('.m4a') else ['-c:a', 'libmp3lame', '-b:a', '128k']
        run('ffmpeg', '-v', 'error', '-y', '-i', os.path.join(tmp, 'df', 'in.wav'), '-af', POST,
            '-ar', '48000', *codec, out)

        d0, d1 = duration(src), duration(out)
        q0, q1 = quiet_db(src), quiet_db(out)
        print(f'{rel}: 길이 {d0:.1f}s → {d1:.1f}s, 조용한 구간 {q0:.1f}dB → {q1:.1f}dB')
        if abs(d0 - d1) > 0.5:
            print(f'::error::{rel}: 길이가 달라져 원본을 그대로 둡니다')
            return False
        if q1 > q0:
            print(f'::error::{rel}: 조용한 구간이 오히려 커져 원본을 그대로 둡니다')
            return False
        shutil.copyfile(out, src)
    log[rel] = sha(src)
    return True


def changed(before, after):
    if not before or set(before) == {'0'}:
        cmd = ['git', 'show', '--name-only', '--diff-filter=AM', '--format=', after, '--', 'audio/*.m4a']
    else:
        cmd = ['git', 'diff', '--name-only', '--diff-filter=AM', before, after, '--', 'audio/*.m4a']
    out = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, check=True).stdout
    return [p for p in out.split() if p]


def main(argv):
    files = changed(argv[1], argv[2]) if argv[:1] == ['--changed'] else argv
    files = [os.path.relpath(os.path.join(REPO, f) if not os.path.isabs(f) else f, REPO) for f in files]
    if not files:
        print('보정할 육성 녹음이 없습니다.')
        return 0
    ensure_bin()
    log = json.load(open(LOG, encoding='utf-8')) if os.path.exists(LOG) else {}
    before = dict(log)
    ok = True
    for rel in files:
        if not os.path.exists(os.path.join(REPO, rel)):
            print(f'::warning::{rel}: 파일이 없어 건너뜀')
            continue
        ok = clean(rel, log) and ok
    if log == before:
        return 0 if ok else 1
    with open(LOG, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(log.items())), f, ensure_ascii=False, indent=1)
        f.write('\n')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
