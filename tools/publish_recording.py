# -*- coding: utf-8 -*-
"""recording-upload/<편번호>.m4a를 보정하고 기존 원고에 육성·시간표를 연결한다."""
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

import align
import clean_voice
import crypt
import loud16

REPO = Path(__file__).resolve().parent.parent


def incoming(before, after):
    args = (['git', 'show', '--format=', '--name-only', '--diff-filter=AM', after]
            if not before or set(before) == {'0'} else
            ['git', 'diff', '--name-only', '--diff-filter=AM', before, after])
    result = subprocess.run(args + ['--', 'recording-upload/*.m4a'],
                            cwd=REPO, check=True, capture_output=True, text=True)
    files = result.stdout.splitlines()
    for path in files:
        if not re.fullmatch(r'recording-upload/[1-9][0-9]*[.]m4a', path):
            raise ValueError('올바르지 않은 육성 파일 경로')
    return files


def measure(path):
    proc = subprocess.run(
        ['ffmpeg', '-hide_banner', '-nostats', '-i', str(path),
         '-af', 'ebur128=framelog=verbose', '-f', 'null', '-'],
        capture_output=True, text=True, check=True)
    values = re.findall(r'I:\s*(-?[0-9.]+) LUFS', proc.stderr)
    if not values:
        raise ValueError('음량 측정 실패')
    return float(values[-1])


def prepare_raw(source, dest):
    """원본 녹음을 육성 기준(-16 LUFS, 64kbps 모노 48kHz, 꼭대기 -1.0 dBFS 이하)으로 만들어 dest 에 쓴다.
    소리를 바꾸는 일은 음량뿐이다. 길이가 0.3초 넘게 바뀌면 loud16 이 멈춘다."""
    loud16.CEIL = -2.0
    result = loud16.make(str(source), str(dest), None, kbps=64, mono48=True, peak_max=-1.0)
    print('원본 보정 %s: %.1f → %.1f LUFS, 꼭대기 %.1f dBFS, 길이 %.2f초' % (
        Path(source).name, result['전'][0], result['후'][0], result['후'][1], result['길이'][1]), flush=True)


def main():
    files = incoming(os.environ.get('BEFORE', ''), os.environ['AFTER'])
    if not files:
        raise ValueError('등록할 육성이 없습니다.')
    data_path = str(REPO / 'sayeon.json')
    data = crypt.read_json(data_path)
    before = copy.deepcopy(data)
    by_no = {entry['no']: entry for entry in data}
    sync_path = REPO / 'audio/sync.json'
    sync = json.loads(sync_path.read_text(encoding='utf-8'))
    original_sync = copy.deepcopy(sync)
    # 커밋 글의 표시로 어떻게 다룰지 정한다.
    #  [소리크기] 이미 음량을 맞춰 올린 육성 — 잡음 제거·목소리 변형 없이 그대로 쓴다.
    #  [원본]     앱(/sayeon/upload/)이 올린 원본 — 잡음 제거 없이 음량만 -16 LUFS·64kbps 모노로 맞춰 쓴다.
    #  표시 없음  예전 방식 — 잡음 제거(clean_voice)까지 한다.
    commit_message = subprocess.run(
        ['git', 'log', '-1', '--format=%B', os.environ['AFTER']],
        cwd=REPO, check=True, capture_output=True, text=True).stdout
    raw = '[원본]' in commit_message
    volume_only = raw or '[소리크기]' in commit_message
    targets = []
    for source in files:
        no = int(Path(source).stem)
        if no not in by_no:
            raise ValueError('%d편 원고가 없습니다.' % no)
        rel = 'audio/%d.m4a' % no
        if raw:
            prepare_raw(REPO / source, REPO / rel)
        else:
            shutil.copyfile(REPO / source, REPO / rel)
        targets.append((source, rel, by_no[no]))
    if not volume_only and clean_voice.main([rel for _, rel, _ in targets]):
        raise RuntimeError('잡음 제거 검사 실패')

    from faster_whisper import WhisperModel
    model = WhisperModel('base', device='cpu', compute_type='int8', cpu_threads=4)
    failed, done = [], []
    for source, rel, entry in targets:
        audio = REPO / rel
        lufs = measure(audio)
        if not -19.4 <= lufs <= -15.0:   # -18.4 기준(-19.4~-17.4)과 2026-11 부터 시험 중인 -16 기준을 모두 받는다
            raise ValueError('음량 기준 불일치: %.1f LUFS' % lufs)
        segments, _ = model.transcribe(
            str(audio), language='ko', vad_filter=True,
            vad_parameters={'min_silence_duration_ms': 400})
        segments = [{'s': round(s.start, 2), 'e': round(s.end, 2),
                     't': s.text.strip()} for s in segments]
        times = align.align(entry, segments)
        duration = clean_voice.duration(str(audio))
        if (not times or len(times) != len(entry['paragraphs']) or
                times != sorted(times) or
                not all(0 <= t < duration for t in times) or
                any(b <= a for a, b in zip(times, times[1:]))):
            # 한 편이 어긋나도 나머지는 올린다. 어긋난 편은 이유를 찍고 올림 폴더에 그대로 남긴다.
            print('::error::%d편 문단 시간표 검사 실패 — 이 편만 건너뜁니다' % entry['no'], flush=True)
            print('  문단 %d, 시간표 %s, 길이 %.1f초, 받아쓴 구간 %d개' % (
                len(entry['paragraphs']), len(times or []), duration, len(segments)), flush=True)
            if times:
                ties = [i for i, (a, b) in enumerate(zip(times, times[1:])) if b <= a]
                print('  시각이 겹치거나 거꾸로인 문단: %s' % ties, flush=True)
                print('  시간표: %s' % times, flush=True)
            for seg in segments[:3] + segments[-3:]:
                print('  구간 %.1f~%.1f %s' % (seg['s'], seg['e'], seg['t'][:60]), flush=True)
            failed.append(entry['no'])
            audio.unlink()
            continue
        entry['audio'] = rel
        done.append((source, rel, entry))
        sync[Path(rel).name] = times
        print('%d편: %.1f초, %.1f LUFS, 문단 %d, 육성 %s' %
              (entry['no'], duration, lufs, len(times), rel), flush=True)

    # 육성 경로와 해당 파일 시간표 외에 기존 자료가 바뀌지 않았는지 검사한다.
    if not done:
        raise ValueError('시간표를 맞춘 편이 없어 멈춥니다: %s' % failed)
    expected = copy.deepcopy(before)
    for _, rel, entry in done:
        next(e for e in expected if e['no'] == entry['no'])['audio'] = rel
    assert data == expected
    assert all(sync[k] == v for k, v in original_sync.items()
               if k not in {Path(rel).name for _, rel, _ in done})
    crypt.write_json(data_path, data)
    sync_path.write_text(json.dumps(sync, ensure_ascii=False, separators=(',', ':')),
                         encoding='utf-8')
    for source, _, _ in done:
        (REPO / source).unlink()
    if failed:
        print('::warning::시간표 검사에 걸려 올리지 못한 편: %s (올림 폴더에 남겨 둠)' % failed, flush=True)


if __name__ == '__main__':
    main()
