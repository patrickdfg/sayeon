# 작업 규칙

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
| `index.html` | 성령 사연 | `sayeon.json`, `sayeon2025.json` |
| `stones/index.html` | 월명동 돌과 나무 이야기 | HTML 안에 들어 있음 |
| `malsseum/index.html` | 주일·수요 말씀 | `malsseum/malsseum.json` |

음성 파일은 `audio/`(사연), `malsseum/audio/`(말씀)에 편 번호로 넣는다.
JSON 항목에 `"audio": "audio/22.m4a"` 처럼 적어 두면 그 편은 사람 목소리로
읽어 주고, 없으면 컴퓨터 음성(TTS)으로 읽는다.

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

- **음성 파일은 GitHub 이 한 개 100MB 를 넘으면 아예 안 받는다.**
  말씀 녹음은 원본이 커서 48kbps 모노로 변환해 넣는다.

  ```bash
  ffmpeg -i 원본.mp3 -vn -ac 1 -ar 44100 -b:a 48k audio/0802.mp3
  ```

- **검색은 세 카테고리를 한 번에 찾는다.** 각 페이지가 다른 카테고리의 JSON 을
  그때그때 받아서 찾으므로, 사연을 더 넣어도 검색 쪽은 손댈 것이 없다.
  **단 월명동만 예외다.** `stones/index.html` 은 사진이 통째로 들어 있어 10MB 라
  그대로 받아 쓸 수 없어서, 글자만 뽑아 둔 `stones/stones-search.json` 을 쓴다.
  **월명동 항목을 고치거나 추가했으면 이 파일을 다시 만들어야 한다:**

  ```python
  import re, io, json
  src = io.open('stones/index.html', encoding='utf-8').read()
  data = json.loads(re.search(r'^const DATA = (\[.*?\]);\s*$', src, re.M|re.S).group(1))
  out = [{'no': d['num'], 'title': d['title'], 'text': d.get('search','')} for d in data]
  io.open('stones/stones-search.json','w',encoding='utf-8',newline='').write(
      json.dumps(out, ensure_ascii=False, separators=(',',':')))
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

- **읽어주기 기본값**: 속도 90%, 목소리는 구글 한국어를 먼저 고른다.
  기기마다 있는 목소리가 달라 설정에서 직접 고를 수도 있다.

- 원고가 한글(.hwp) 파일로 오면 본문만 뽑아 JSON 으로 옮긴다.
  HWP 5.0 은 OLE 복합 문서라 `olefile` 로 `BodyText/SectionN` 을 풀어
  읽으면 된다(문단 텍스트는 태그 67, UTF-16LE).
