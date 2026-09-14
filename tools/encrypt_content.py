# -*- coding: utf-8 -*-
"""원고와 사진을 잠가 .enc 로 만들고, 잠그기 전 파일은 지운다.

처음 한 번만 돌리면 되고, 그 뒤로는 도구들이 알아서 잠근 채로 다룬다.
crypt.json 이 없으면 새로 만든다(소금과 반복수를 적어 둔다).

쓰는 법 (tools/ 에서):
    SAYEON_PASS=암호 python encrypt_content.py
    SAYEON_PASS=암호 python encrypt_content.py --keep   # 원본을 남겨 둔다
"""
import base64
import glob
import io
import json
import os
import sys

import crypt

REPO = crypt.REPO
ITER = 200000

# 잠글 원고들 (저장소 뿌리에서 본 이름)
DOCS = ['sayeon.json', 'sayeon2025.json',
        os.path.join('malsseum', 'malsseum.json'),
        os.path.join('stones', 'stones.json')]
# 잠글 사진들
PICS = os.path.join('stones', 'img', '*')


def make_meta():
    if os.path.exists(crypt.META):
        return False
    io.open(crypt.META, 'w', encoding='utf-8', newline='').write(
        json.dumps({'v': 1,
                    'salt': base64.b64encode(os.urandom(16)).decode('ascii'),
                    'iter': ITER}, ensure_ascii=False, indent=1))
    return True


def main(keep):
    if make_meta():
        print('crypt.json 을 새로 만들었습니다 (소금·반복수).')

    # 암호가 맞는지 빨리 볼 수 있게 작은 표를 하나 둔다
    io.open(os.path.join(REPO, 'check.enc'), 'wb').write(
        crypt.seal(u'성령사연'.encode('utf-8')))

    todo = [os.path.join(REPO, d) for d in DOCS]
    todo += sorted(p for p in glob.glob(os.path.join(REPO, PICS))
                   if not p.endswith('.enc'))

    done = 0
    for path in todo:
        if not os.path.exists(path):
            print('  건너뜀 (없음):', os.path.relpath(path, REPO))
            continue
        io.open(path + '.enc', 'wb').write(crypt.seal(io.open(path, 'rb').read()))
        if not keep:
            os.remove(path)
        done += 1

    print('%d 개를 잠갔습니다%s.' % (done, ' (원본은 남겨 둠)' if keep else ''))
    print('푸는지 확인:', crypt.read_json(os.path.join(REPO, 'sayeon.json'))[0]['title'])


if __name__ == '__main__':
    main('--keep' in sys.argv[1:])
