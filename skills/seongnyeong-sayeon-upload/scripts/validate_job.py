#!/usr/bin/env python3
"""Validate a sayeon work-upload job without changing it."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys


def fail(message: str) -> None:
    raise ValueError(message)


def validate(path: pathlib.Path, allow_replace: bool) -> dict:
    raw = path.read_text(encoding="utf-8")
    if "\r" in raw:
        fail("작업표 파일은 LF 줄 끝을 사용해야 합니다.")

    try:
        job = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"올바른 JSON이 아닙니다: {exc}")

    if not isinstance(job, dict):
        fail("작업표 최상위 값은 JSON 객체여야 합니다.")

    required = {"category", "year", "no", "title", "content"}
    missing = sorted(required - set(job))
    if missing:
        fail("필수 항목이 없습니다: " + ", ".join(missing))

    allowed = required | {"replace"}
    unknown = sorted(set(job) - allowed)
    if unknown:
        fail("알 수 없는 항목이 있습니다: " + ", ".join(unknown))

    if job["category"] != "sayeon":
        fail('category는 "sayeon"이어야 합니다.')
    if job["year"] != 2026:
        fail("현재 자동 게시 대상 year는 2026입니다.")
    if isinstance(job["no"], bool) or not isinstance(job["no"], int) or job["no"] <= 0:
        fail("no는 양의 정수여야 합니다.")

    expected_title = f'성령 사연 {job["no"]}'
    if job["title"] != expected_title:
        fail(f'title은 "{expected_title}"이어야 합니다.')

    content = job["content"]
    if not isinstance(content, str) or not content.strip():
        fail("content는 비어 있지 않은 문자열이어야 합니다.")
    if "\r" in content:
        fail("content 내부 줄바꿈은 LF만 사용해야 합니다.")

    replace = job.get("replace", False)
    if not isinstance(replace, bool):
        fail("replace는 true 또는 false여야 합니다.")
    if replace and not allow_replace:
        fail("replace:true는 --allow-replace 없이 허용되지 않습니다.")

    expected_name = f"{job['no']}.json"
    if path.name != expected_name:
        fail(f"파일 이름은 {expected_name}이어야 합니다.")

    return job


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=pathlib.Path)
    parser.add_argument("--allow-replace", action="store_true")
    args = parser.parse_args()

    try:
        job = validate(args.job, args.allow_replace)
    except (OSError, ValueError) as exc:
        print(f"검사 실패: {exc}", file=sys.stderr)
        return 1

    paragraphs = job["content"].count("\n\n") + 1
    lines = job["content"].count("\n") + 1
    print(f"검사 통과: {job['no']}편, {paragraphs}문단, {lines}줄")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
