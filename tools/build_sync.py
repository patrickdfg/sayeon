# -*- coding: utf-8 -*-
"""육성 낭독이 있는 편들의 '문단별 시작 시각'을 만들어 sync.json 으로 저장한다.

녹음을 받아쓴 뒤(transcribe) 원고에 시간을 맞춰 붙여(align) 문단마다 시작 시각을 얻는다.
뷰어는 재생 위치를 보고 지금 읽고 있는 문단을 짚어 준다.

쓰는 법:  python build_sync.py [모델크기]
이미 만들어 둔 편은 건너뛰므로, 녹음을 새로 넣은 뒤 다시 돌려도 그 편만 처리한다.
"""
import io
import json
import os
import sys
import time

import align

REPO = '..'          # tools/ 에서 실행한다
CACHE = '../.seg_cache'          # 받아쓴 결과를 편별로 남겨 둔다 (다시 돌릴 때 아낀다)
OUT = os.path.join(REPO, 'audio', 'sync.json')
SOURCES = [('sayeon.json', REPO)]


def main(model_size='base'):
    os.makedirs(CACHE, exist_ok=True)
    sync = {}
    if os.path.exists(OUT):
        sync = json.load(io.open(OUT, encoding='utf-8'))

    from faster_whisper import WhisperModel
    model = None

    for src, base in SOURCES:
        data = json.load(io.open(os.path.join(base, src), encoding='utf-8'))
        targets = [e for e in data if e.get('audio')]
        print('%s: 육성 %d편' % (src, len(targets)))

        for e in targets:
            no = str(e['no'])
            if no in sync:
                continue
            audio = os.path.join(base, e['audio'])
            if not os.path.exists(audio):
                print('  %s 편: 파일 없음' % no)
                continue

            seg_path = os.path.join(CACHE, '%s.json' % no)
            if os.path.exists(seg_path):
                segs = json.load(io.open(seg_path, encoding='utf-8'))
            else:
                if model is None:
                    model = WhisperModel(model_size, device='cpu',
                                         compute_type='int8', cpu_threads=6)
                t0 = time.time()
                gen, info = model.transcribe(
                    audio, language='ko', vad_filter=True,
                    vad_parameters={'min_silence_duration_ms': 400})
                segs = [{'s': round(x.start, 2), 'e': round(x.end, 2),
                         't': x.text.strip()} for x in gen]
                io.open(seg_path, 'w', encoding='utf-8', newline='').write(
                    json.dumps(segs, ensure_ascii=False))
                print('  %s 편: %.1f분 → %.0f초 (%.1f배속)'
                      % (no, info.duration / 60, time.time() - t0,
                         info.duration / max(time.time() - t0, 0.01)))

            times = align.align(e, segs)
            if times:
                sync[no] = times
            else:
                print('  %s 편: 맞추지 못함' % no)

    io.open(OUT, 'w', encoding='utf-8', newline='').write(
        json.dumps(sync, ensure_ascii=False, separators=(',', ':')))
    print('\n저장: %s (%d편)' % (OUT, len(sync)))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'base')
