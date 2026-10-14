# -*- coding: utf-8 -*-
# 올린 음성(육성 녹음)의 소리 크기를 현수 음성과 같게 맞춰 제자리에 바꿔 넣는다.
"""쓰는 법 (저장소 맨 위에서 실행)

    python tools/match_volume.py                 # 소리가 어긋난 육성 전부
    python tools/match_volume.py 173 174         # 편 번호만
    python tools/match_volume.py --check         # 재 보기만 하고 바꾸지 않는다

녹음마다 소리 크기가 제각각이라, 현수 음성을 듣다가 육성으로 넘어가면 갑자기 작아졌다.
현수 음성이 모두 -18.4 LUFS 쯤이라 육성도 거기에 맞춘다(2026-10-14 기준 육성은 가운데가
-24.7, 작은 것은 -32.2 까지 있었다).

- **길이가 바뀌지 않는다.** loudnorm 은 소리 크기만 손대므로 `audio/sync.json` 문단
  시간표를 다시 만들 필요가 없다. 끝나고 길이를 검사해 0.3초 넘게 어긋나면 되돌린다.
- 잡음 제거(`clean_voice.py`)와는 다른 일이다. 이 도구는 잡음을 건드리지 않는다.
- 이미 맞는 파일(차이 1dB 미만)은 건너뛴다. 그래서 여러 번 돌려도 소리가 망가지지 않는다.
- 원본은 덮어쓰지만 git 기록에 남아 있어 되돌릴 수 있다.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crypt

REPO = crypt.REPO
TARGET_LUFS = -18.4      # 현수 음성의 가운데값. clean_voice.py 도 같은 값을 쓴다
TARGET_TP = -1.5         # 가장 큰 순간에 여유를 둬 찌그러지지 않게
TARGET_LRA = 11
NEAR = 1.0               # 이만큼 안에 들면 이미 맞는 것으로 본다


def ffmpeg():
    """저장소 일꾼에는 ffmpeg 가 깔려 있고, 내 컴퓨터에는 파이썬 꾸러미로 들어 있다."""
    if shutil.which('ffmpeg'):
        return 'ffmpeg'
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


FF = ffmpeg()


def loudness(path):
    """지금 소리 크기(LUFS). 못 재면 None."""
    out = subprocess.run([FF, '-hide_banner', '-nostats', '-i', path,
                          '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
                         capture_output=True, text=True, errors='replace').stderr
    m = re.search(r'I:\s*(-?\d+\.\d+) LUFS', out)
    return float(m.group(1)) if m else None


def info(path):
    """길이(초)와 비트레이트(kbps). 원본과 같은 품질로 다시 저장하려고 본다."""
    out = subprocess.run([FF, '-hide_banner', '-i', path], capture_output=True,
                         text=True, errors='replace').stderr
    d = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', out)
    sec = int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3)) if d else 0.0
    b = re.search(r'Audio:.*?, (\d+) kb/s', out)
    return sec, int(b.group(1)) if b else 128


def measure(path):
    """1차: 이 파일이 얼마나 큰지 재어 둔다(2단계 loudnorm 의 앞 단계)."""
    out = subprocess.run(
        [FF, '-hide_banner', '-nostats', '-i', path, '-af',
         'loudnorm=I=%s:TP=%s:LRA=%s:print_format=json' % (TARGET_LUFS, TARGET_TP, TARGET_LRA),
         '-f', 'null', '-'], capture_output=True, text=True, errors='replace').stderr
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', out, re.S)
    if not m:
        raise SystemExit('소리 크기를 재지 못했습니다: %s' % path)
    return json.loads(m.group(0))


def fix(path):
    """소리 크기를 맞춰 제자리에 바꿔 넣는다. 바꿨으면 (전, 후) 를 돌려준다."""
    before = loudness(path)
    if before is None:
        print('  %s: 소리를 재지 못해 건너뜀' % os.path.basename(path))
        return None
    if abs(before - TARGET_LUFS) < NEAR:
        return None
    sec0, kbps = info(path)
    st = measure(path)
    # 2차: 1차에서 잰 값을 넣어 고르게(linear) 올린다 — 소리의 높낮이 흐름이 그대로 남는다
    af = ('loudnorm=I=%s:TP=%s:LRA=%s:measured_I=%s:measured_TP=%s:measured_LRA=%s:'
          'measured_thresh=%s:offset=%s:linear=true:print_format=summary'
          % (TARGET_LUFS, TARGET_TP, TARGET_LRA, st['input_i'], st['input_tp'],
             st['input_lra'], st['input_thresh'], st['target_offset']))
    ext = os.path.splitext(path)[1].lower()
    codec = (['-c:a', 'aac'] if ext == '.m4a' else ['-c:a', 'libmp3lame'])
    tmp = tempfile.mktemp(suffix=ext)
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', path,
                    '-vn', '-af', af, '-b:a', '%dk' % min(kbps, 192), *codec, tmp], check=True)
    sec1 = info(tmp)[0]
    if abs(sec1 - sec0) > 0.3:          # 길이가 바뀌면 문단 시간표가 어긋난다
        os.remove(tmp)
        raise SystemExit('길이가 %.2f초 바뀌어 되돌립니다: %s' % (sec1 - sec0, path))
    shutil.move(tmp, path)
    after = loudness(path)
    return before, after


def targets(args):
    data = crypt.read_json(os.path.join(REPO, 'sayeon.json'))
    nums = set(int(a) for a in args if a.isdigit())
    out = []
    for e in data:
        p = e.get('audio')
        if not isinstance(p, str):
            continue
        if nums and e['no'] not in nums:
            continue
        full = os.path.join(REPO, p.replace('/', os.sep))
        if os.path.exists(full):
            out.append((e['no'], full))
    return out


def main(args):
    items = targets(args)
    check = '--check' in args
    print('육성 %d편%s' % (len(items), ' — 재 보기만 합니다' if check else ''))
    changed = 0
    for no, path in items:
        if check:
            v = loudness(path)
            print('  %3d편 %6.1f LUFS  %s'
                  % (no, v, '맞음' if abs(v - TARGET_LUFS) < NEAR else '어긋남'))
            continue
        r = fix(path)
        if r:
            changed += 1
            print('  %3d편 %6.1f → %6.1f LUFS' % (no, r[0], r[1]))
    if not check:
        print('%d편 맞췄습니다 (목표 %.1f LUFS). 문단 시간표는 그대로 씁니다.'
              % (changed, TARGET_LUFS))


if __name__ == '__main__':
    main(sys.argv[1:])
