#!/usr/bin/env python3
# 음성 파일의 통합 음량(LUFS)과 꼭대기(dBFS)를 재서 -16 규칙에 맞는지 알려 준다.
"""Measure loudness and peaks of an audio file and compare with the -16 LUFS rule."""

import argparse
import re
import subprocess
import sys


def measure(path):
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", path,
         "-af", "ebur128=peak=sample+true:framelog=quiet", "-f", "null", "-"],
        capture_output=True, text=True)
    text = proc.stderr
    loud = re.findall(r"^\s+I:\s*(-?[0-9.]+) LUFS", text, re.M)
    peaks = re.findall(r"^\s+Peak:\s*(-?[0-9.]+|-inf) dBFS", text, re.M)
    if proc.returncode != 0 or not loud or len(peaks) < 2:
        raise RuntimeError("측정 실패: " + (text.strip().splitlines() or ["ffmpeg 출력 없음"])[-1])
    num = lambda p: float("-inf") if p == "-inf" else float(p)
    # 앞이 샘플 꼭대기(loud16.py 가 -1.0 이하로 맞추는 값), 뒤가 참 꼭대기(0 미만이어야 함)
    return float(loud[-1]), num(peaks[-2]), num(peaks[-1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+")
    parser.add_argument("--target", type=float, default=-16.0)
    parser.add_argument("--tol", type=float, default=0.3)
    parser.add_argument("--peak-max", type=float, default=-1.0)
    args = parser.parse_args()
    bad = 0
    for path in args.files:
        try:
            lufs, peak, true_peak = measure(path)
        except (OSError, RuntimeError) as error:
            print("%s  %s" % (path, error)); bad += 1; continue
        ok = abs(lufs - args.target) <= args.tol and peak <= args.peak_max and true_peak < 0
        bad += 0 if ok else 1
        print("%s  %.1f LUFS  샘플 꼭대기 %.1f  참 꼭대기 %.1f dBFS  %s"
              % (path, lufs, peak, true_peak, "맞음" if ok else "어긋남"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
