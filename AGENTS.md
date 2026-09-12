# 작업 규칙

이 저장소를 맡은 사람(또는 AI 도구)이 먼저 읽는 문서다.
Codex 는 `AGENTS.md`, Claude Code 는 `CLAUDE.md` 를 자동으로 읽는데,
규칙이 갈라지지 않도록 **내용은 이 파일 하나에 둔다**(`CLAUDE.md` 는 여기를 가리킨다).

## 두 대에서 번갈아 쓴다 (집 / 사무실)

같은 저장소를 컴퓨터 두 대에서 번갈아 쓰기 때문에, **다른 쪽에서 이미 올려 둔
변경을 덮어쓰지 않도록** 아래를 지킨다.

- **시작할 때: 먼저 `git pull` 하고 시작한다.**
  파일을 읽거나 고치기 전에 먼저 받아 온다. 다른 컴퓨터에서 사연을 추가했거나
  기능을 고쳐 뒀을 수 있다.
- **끝낼 때: 커밋하고 푸시한다.**
  작업을 마쳤으면 반드시 `git push` 까지 한다. 푸시하지 않고 두면 다음에
  다른 컴퓨터에서 이어서 할 때 충돌한다.

```bash
git pull origin main     # 시작할 때
git push origin main     # 끝낼 때
```

푸시가 거부되면(다른 쪽에서 먼저 올렸을 때) 억지로 밀지 말고 `git pull` 로
받아 온 뒤 합치고 다시 올린다.

## 사이트 구성

GitHub Pages 로 <https://patrickdfg.github.io/sayeon/> 에 올라간다.
페이지 세 개가 상단 탭(성령사연 / 월명동사연 / 말씀)으로 이어져 있다.

| 경로 | 내용 | 데이터 |
| --- | --- | --- |
| `index.html` | 성령 사연 (2026 / 2025 두 해) | `sayeon.json`, `sayeon2025.json` |
| `stones/index.html` | 월명동 돌과 나무 이야기 | `stones/stones.json` + `stones/img/` |
| `malsseum/index.html` | 주일·수요 말씀 | `malsseum/malsseum.json` |

음성 파일은 `audio/`(사연), `malsseum/audio/`(말씀)에 편 번호로 넣는다.
JSON 항목에 `"audio": "audio/22.m4a"` 처럼 적어 두면 그 편은 그 파일을 틀어 주고,
없으면 브라우저가 그 자리에서 읽어 준다(기기 TTS).

## 자주 하는 일: 새 사연 올리기

원고(붙여넣은 글 / hwp / pdf)를 받으면 순서는 이렇다.

1. `git pull origin main`
2. `sayeon.json` 맨 뒤에 항목을 붙인다 — `{"no", "title", ("audio"), "paragraphs"}`
   - `paragraphs` 는 **문단(연) 단위 배열**이고, 각 문단은 줄들의 배열이다.
     원고의 빈 줄이 문단 경계, 빈 줄 없이 이어진 줄들은 한 문단 안의 줄들이다.
   - 붙여넣은 글은 줄바꿈이 뭉개져 오기도 한다. **pdf 로 받으면 원래 줄 나눔이
     그대로 보이니** 그쪽이 정확하다.
3. 음성이 있으면 `audio/<번호>.m4a|mp3` 로 넣고, 없으면 아래 TTS 로 만든다.
4. 음성이 있는 편은 `python build_sync.py base` 로 문단 시간표를 만든다.
5. 커밋·푸시하고, 배포(Actions)가 끝나면 실제 주소에서 확인한다.

```bash
gh run list --repo patrickdfg/sayeon --limit 3      # 배포 끝났는지
```

## 모바일 Work에서 성령사연 자동 게시

ChatGPT Work가 `work-upload/<편번호>.json` 작업표를 main에 올리면
`.github/workflows/work-upload.yml`이 현수 TTS, 문단 시간표, 데이터 연결과 Pages
재배포까지 처리한다. 작업표와 모바일에서 쓸 요청문은 `work-upload/README.md`에 있다.

- 현재 대상은 2026년 성령사연이다.
- Work는 원고의 빈 줄을 문단 경계로 보존해야 한다.
- 기존 편을 덮어쓰지 않는다. 의도적인 교체에만 `replace: true`를 쓴다.
- 성공한 작업표는 자동으로 삭제되고 생성 결과가 main에 커밋된다.

## 음성 만들기 (육성 녹음이 오기 전 임시)

무료 Edge TTS(마이크로소프트 신경망 음성)를 쓴다. API 키가 필요 없다.

```bash
python -m pip install edge-tts     # 처음 한 번만
cd tools
python make_tts.py 159             # 한 편 (여러 편은 번호를 나열, 전부는 --all)
```

- 목소리는 `tools/make_tts.py` 의 `VOICE` 로 바꾼다.
- **아직 음성이 없는 편을 한꺼번에 만들려면** 깃허브 Actions 의
  "성령사연 남은 편 음성 만들기" 를 돌린다(`.github/workflows/make-tts-all.yml`).
  편 수를 넣어 나눠 돌릴 수도 있고, `work-upload/tts/request.json` 을 올려도 돈다.
  한 편 끝날 때마다 `sayeon.json` 에 바로 연결되므로 중간에 멈춰도
  만든 편은 남고, 다시 돌리면 남은 편부터 이어서 만든다.
- **컴퓨터 목소리로 만든 편에는 `"tts": true` 가 붙는다.** 뷰어는 이것으로
  육성 녹음(🎙️)과 컴퓨터 목소리(🤖)를 가른다. 나중에 육성이 오면
  파일을 바꿔 끼우고 이 줄을 지운다.
  현수(남자) `ko-KR-HyunsuMultilingualNeural` — 지금 쓰는 것.
  선희(여자) `ko-KR-SunHiNeural`, 인준(남자) `ko-KR-InJoonNeural`.
- 육성 녹음과 똑같이 **제목을 먼저 읽고** 본문으로 들어간다.
  (뷰어는 `audio` 가 있는 편의 제목을 따로 읽지 않는다)
- `make_tts.py`는 Edge 문장 경계를 함께 받아 `audio/sync.json`도 바로 만든다.
  새 TTS에는 Whisper `build_sync.py`를 다시 실행할 필요가 없다.
- 나중에 육성 녹음이 오면 **같은 번호로 파일만 바꿔 끼우고** sync 를 다시 만든다
  (그 편의 `audio/sync.json` 항목을 지우고 `build_sync.py` 를 돌리면 다시 만든다).

## 손볼 때 알아 둘 것

- **세 페이지는 코드가 거의 같다.** 읽어주기·목록·검색·하이라이트·N독·스와이프
  같은 기능을 고칠 때는 **세 파일 모두** 고쳤는지 확인한다.
  (`stones/index.html` 만 디자인 계열이 달라 CSS 이름이 다르다.)

- **JSON 은 `json.dumps(data, ensure_ascii=False, indent=1)` 형식이고 끝에
  줄바꿈이 없다.** 파이썬으로 고쳐 쓸 때 이대로 맞춰야 diff 가 한 줄만 바뀐다.

  ```python
  io.open(path, 'w', encoding='utf-8', newline='').write(
      json.dumps(data, ensure_ascii=False, indent=1))
  ```

- **localStorage 키는 페이지마다 접두어가 다르다.** 같은 도메인이라 저장소를
  공유하므로 섞이면 안 된다.
  성령사연 `sayeon*`, 월명동 `wmd*`, 말씀 `mal*`.
  설정(글자·색·속도)만은 `siteSettings` 하나로 세 페이지가 같이 쓴다.
  기기 목소리 고르기는 없앴다. 음성은 깃허브에서 현수 목소리로 만들어 붙고,
  아직 녹음이 없는 편만 기기가 알아서 한국어 목소리로 읽는다.

- **음성 파일은 GitHub 이 한 개 100MB 를 넘으면 아예 안 받는다.**
  말씀 녹음은 원본이 커서 48kbps 모노로 변환해 넣는다.

  ```bash
  ffmpeg -i 원본.mp3 -vn -ac 1 -ar 44100 -b:a 48k audio/0802.mp3
  ```

- **재생에 맞춰 문단을 짚어 준다.** `audio/sync.json` 에 편별로 "문단이 몇 초에
  시작하는지"가 들어 있다. 녹음을 받아쓴 뒤 원고에 맞춰 붙여 만든 것이다.
  **음성을 새로 넣었으면 그 편만 다시 만들면 된다**(이미 있는 편은 건너뛴다):

  ```bash
  python -m pip install faster-whisper   # 처음 한 번만
  cd tools
  python build_sync.py base
  ```

  base 모델로 약 7~9배속이라 2시간 분량이 15분쯤 걸린다.
  받아쓴 중간 결과는 `.seg_cache/` 에 남아 다시 돌려도 아낀다(저장소에는 안 올린다).

- **녹음이 원고와 안 맞으면 정렬이 실패한다.** 실제로 그렇게 해서 `audio/152.m4a` 가
  152편이 아니라 153편 낭독이었음을 찾아냈다. 정렬 실패는 대개 파일이 잘못 들어간 신호다.

- **자료 파일은 캐시를 우회해서 받는다.** `sayeon.json`·`sync.json` 같은 자료는
  주소 뒤에 `?v=시각` 을 붙여 받는다. 안 붙이면 새 편을 올려도 폰에 옛것이 남아
  "목록엔 뜨는데 스크롤은 안 따라가는" 일이 생긴다.

- **검색은 세 카테고리를 한 번에 찾는다.** 각 페이지가 다른 카테고리의 JSON 을
  그때그때 받아서 찾으므로, 사연을 더 넣어도 검색 쪽은 손댈 것이 없다.
  월명동도 `stones/stones.json` 원본을 그대로 받아 쓴다. 따로 만들어 둘
  검색용 파일은 없다.

- **월명동은 글과 사진을 파일로 나눠 두었다.** `stones/index.html` 은 화면 코드만
  가진 80KB 짜리 평범한 파일이고, 이야기는 `stones/stones.json`(200KB),
  사진은 `stones/img/<번호>-<순서>.jpg`(75장, 7.8MB)에 있다.
  페이지는 열릴 때 `stones.json` 을 받아 `bootStones(DATA)` 를 부른다.
  화면 코드 전체가 그 함수 안에 들어 있으니, 손볼 때 함수 밖으로 빼지 말 것.

  예전에는 사진까지 HTML 한 줄에 base64 로 박혀 있어 파일이 10.7MB 였다.
  그러다 2026-09-12 에 도구가 파일을 읽다 잘린 채 덮어써서 52편과 사진 75장이
  통째로 날아갔다(`2e88594` 로 되돌림). **큰 파일은 통째로 다시 쓰지 말고
  부분만 고칠 것.** 월명동을 고친 뒤에는 항상 이렇게 확인한다:

  ```python
  import io, json
  d = json.load(io.open('stones/stones.json', encoding='utf-8'))
  print(len(d), sum(len(e.get('images', [])) for e in d))   # 52  75
  ```

- **다른 카테고리 검색 결과로 넘어갈 때**는 주소 뒤에 `#n=편번호` 를 붙인다
  (성령사연은 해가 둘이라 `#n=220&y=2025`). 각 페이지가 자료를 다 읽은 뒤
  그 번호를 찾아 펼친다.

- **HTML 을 파이썬으로 고칠 때는 끝나고 문법 검사를 하자.** 따옴표 안에 줄바꿈이
  들어가 페이지 전체가 죽은 적이 있다.

  ```bash
  python -c "import re,io;s=re.findall(r'<script>(.*?)</script>',io.open('index.html',encoding='utf-8').read(),re.S)[0];io.open('chk.js','w',encoding='utf-8').write(s)" && node --check chk.js
  ```

- **암호**는 세 페이지 모두 `7125` (브라우저 안에서만 막는 것이라 진짜 보안은
  아니다). 성령사연과 말씀은 잠금 상태를 같이 쓰고(`sayeon_unlocked`),
  월명동은 따로 쓴다(`wmdUnlocked`).

- **듣기 기본값**: 속도 90%, 자동 이어듣기는 **역순(이전 편)** 이 기본이다.
  설정에서 이전편/다음편/현재편만 중에 고른다. 편이 바뀔 때 1초 쉬었다 시작한다.

- 원고가 한글(.hwp) 파일로 오면 본문만 뽑아 JSON 으로 옮긴다.
  HWP 5.0 은 OLE 복합 문서라 `olefile` 로 `BodyText/SectionN` 을 풀어
  읽으면 된다(문단 텍스트는 태그 67, UTF-16LE).
