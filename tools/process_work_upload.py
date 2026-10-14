# -*- coding: utf-8 -*-
"""ChatGPT Work가 넣은 작업표를 성령사연 데이터와 TTS로 변환한다."""
import asyncio
import glob
import html
import io
import json
import os
import re
import sys

import crypt
import make_tts


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INBOX = os.path.join(REPO, 'work-upload')
SAYEON = os.path.join(REPO, 'sayeon.json')   # 실제 파일은 sayeon.json.enc (잠겨 있다)


def set_output(key, value):
    """깃허브 일꾼의 단계 출력(GITHUB_OUTPUT)에 값을 적는다. 로컬에서는 아무 일도 안 한다."""
    target = os.environ.get('GITHUB_OUTPUT')
    if target:
        with io.open(target, 'a', encoding='utf-8') as out:
            out.write('%s=%s\n' % (key, value))


def clean_line(value):
    return html.unescape(str(value)).replace('\u00a0', ' ').rstrip()


def paragraphs_from_content(content, number):
    lines = [clean_line(line) for line in str(content).splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines and re.fullmatch(r'(?:2026년\s*)?성령\s*(?:사연|말씀)\s*%d' % number,
                              lines[0].strip()):
        lines.pop(0)
    paragraphs = []
    current = []
    for line in lines:
        if line.strip():
            current.append(line.strip())
        elif current:
            paragraphs.append(current)
            current = []
    if current:
        paragraphs.append(current)
    return paragraphs


def normalize_paragraphs(value):
    if not isinstance(value, list):
        raise ValueError('paragraphs는 문단 배열이어야 합니다.')
    result = []
    for paragraph in value:
        lines = paragraph if isinstance(paragraph, list) else str(paragraph).splitlines()
        cleaned = [clean_line(line).strip() for line in lines
                   if clean_line(line).strip()]
        if cleaned:
            result.append(cleaned)
    return result


def load_job(path):
    with io.open(path, encoding='utf-8-sig') as stream:
        job = json.load(stream)
    if job.get('category', 'sayeon') != 'sayeon':
        raise ValueError('현재 자동 업로드는 성령사연(category: sayeon)만 지원합니다.')
    if int(job.get('year', 2026)) != 2026:
        raise ValueError('현재 자동 업로드는 2026년 성령사연만 지원합니다.')
    number = int(job['no'])
    if number < 1:
        raise ValueError('no는 1 이상의 편 번호여야 합니다.')
    if 'paragraphs' in job:
        paragraphs = normalize_paragraphs(job['paragraphs'])
    elif 'content' in job:
        paragraphs = paragraphs_from_content(job['content'], number)
    else:
        raise ValueError('paragraphs 또는 content가 필요합니다.')
    if not paragraphs:
        raise ValueError('본문 문단이 없습니다.')
    return {
        'no': number,
        'title': clean_line(job.get('title') or '성령 사연 %d' % number).strip(),
        'paragraphs': paragraphs,
    }, bool(job.get('replace')), bool(job.get('dry_run'))


def install_entry(entry, replace):
    data = crypt.read_json(SAYEON)
    matches = [index for index, item in enumerate(data) if item['no'] == entry['no']]
    if matches and not replace:
        raise ValueError('%d편이 이미 있습니다. 교체하려면 replace: true를 넣으세요.' % entry['no'])
    if matches:
        old = data[matches[0]]
        # 올린 음성과 현수 음성이 둘 다 있을 수 있으니 둘 다 치운다
        for key in ('audio', 'tts'):
            path = old.get(key)
            if not isinstance(path, str):
                continue
            audio_path = os.path.join(REPO, path.replace('/', os.sep))
            if os.path.exists(audio_path):
                os.remove(audio_path)
        data[matches[0]] = entry
    else:
        data.append(entry)
        data.sort(key=lambda item: item['no'])
    crypt.write_json(SAYEON, data)


async def process(path):
    entry, replace, dry_run = load_job(path)
    if dry_run:
        os.remove(path)
        print('검사 완료: %s (게시하지 않음)' % os.path.basename(path))
        return
    install_entry(entry, replace)
    try:
        await make_tts.main([str(entry['no'])])
    except Exception as error:
        # 음성 서버(마이크로소프트)가 막혀도 글은 올린다. 음성은 '성령사연 남은 편 음성 만들기'로 나중에 이어서 만든다.
        print('::warning::현수 음성을 만들지 못했습니다(%s: %s)' % (type(error).__name__, str(error)[:120]))
        partial = os.path.join(REPO, 'audio', '%d.mp3' % entry['no'])
        if os.path.exists(partial):
            os.remove(partial)          # 만들다 만 빈 파일은 남기지 않는다
        set_output('tts_failed', '1')
        set_output('tts_failed_no', str(entry['no']))
    os.remove(path)
    print('완료: 성령 사연 %d (%d문단)' %
          (entry['no'], len(entry['paragraphs'])))


async def main(paths):
    paths = paths or sorted(glob.glob(os.path.join(INBOX, '*.json')))
    if not paths:
        raise SystemExit('처리할 work-upload/*.json 파일이 없습니다.')
    for path in paths:
        full_path = path if os.path.isabs(path) else os.path.join(REPO, path)
        await process(full_path)


if __name__ == '__main__':
    asyncio.run(main(sys.argv[1:]))
