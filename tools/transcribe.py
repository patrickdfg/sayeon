# -*- coding: utf-8 -*-
"""녹음에서 '몇 초에 무슨 말을 했는지'를 뽑아낸다.

받아쓰기 자체가 목적이 아니라, 이미 있는 원고에 시간을 맞춰 붙이려는 것이므로
작은 모델로도 충분하다. 결과는 {시작, 끝, 말} 목록으로 저장한다.
"""
import io
import json
import sys
import time

from faster_whisper import WhisperModel


def run(audio_path, out_path, model_size="base"):
    t0 = time.time()
    # int8 = CPU 에서 가장 빠른 양자화. 6코어라 워커는 넉넉히 준다.
    model = WhisperModel(model_size, device="cpu", compute_type="int8", cpu_threads=6)
    load = time.time() - t0

    t1 = time.time()
    segments, info = model.transcribe(
        audio_path,
        language="ko",
        vad_filter=True,                      # 말 없는 구간은 건너뛴다
        vad_parameters={"min_silence_duration_ms": 400},
    )
    segs = [{"s": round(x.start, 2), "e": round(x.end, 2), "t": x.text.strip()}
            for x in segments]
    took = time.time() - t1

    io.open(out_path, "w", encoding="utf-8", newline="").write(
        json.dumps(segs, ensure_ascii=False, indent=1))

    dur = info.duration
    print("녹음 %.1f분 / 인식 %.1f초 (모델 로딩 %.1f초)" % (dur / 60, took, load))
    print("속도: 약 %.1f배속, 조각 %d개" % (dur / took if took else 0, len(segs)))
    return segs


if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "base")
