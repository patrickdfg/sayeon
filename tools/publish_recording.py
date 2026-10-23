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
    targets = []
    for source in files:
        no = int(Path(source).stem)
        if no not in by_no:
            raise ValueError('%d편 원고가 없습니다.' % no)
        rel = 'audio/%d.m4a' % no
        shutil.copyfile(REPO / source, REPO / rel)
        targets.append((source, rel, by_no[no]))
    # 이미 음량만 조정한 육성은 추가적인 잡음 제거·목소리 변형 없이 보존한다.
    commit_message = subprocess.run(
        ['git', 'log', '-1', '--format=%B', os.environ['AFTER']],
        cwd=REPO, check=True, capture_output=True, text=True).stdout
    volume_only = '[소리크기]' in commit_message
    if not volume_only and clean_voice.main([rel for _, rel, _ in targets]):
        raise RuntimeError('잡음 제거 검사 실패')

    from faster_whisper import WhisperModel
    model = WhisperModel('base', device='cpu', compute_type='int8', cpu_threads=4)
    for source, rel, entry in targets:
        audio = REPO / rel
        lufs = measure(audio)
        if not -19.4 <= lufs <= -17.4:
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
            raise ValueError('%d편 문단 시간표 검사 실패' % entry['no'])
        entry['audio'] = rel
        sync[Path(rel).name] = times
        print('%d편: %.1f초, %.1f LUFS, 문단 %d, 육성 %s' %
              (entry['no'], duration, lufs, len(times), rel), flush=True)

    # 육성 경로와 해당 파일 시간표 외에 기존 자료가 바뀌지 않았는지 검사한다.
    expected = copy.deepcopy(before)
    for _, rel, entry in targets:
        next(e for e in expected if e['no'] == entry['no'])['audio'] = rel
    assert data == expected
    assert all(sync[k] == v for k, v in original_sync.items()
               if k not in {Path(rel).name for _, rel, _ in targets})
    crypt.write_json(data_path, data)
    sync_path.write_text(json.dumps(sync, ensure_ascii=False, separators=(',', ':')),
                         encoding='utf-8')
    for source, _, _ in targets:
        (REPO / source).unlink()


if __name__ == '__main__':
    main()
