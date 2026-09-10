# ChatGPT Work 원고함

모바일 ChatGPT의 **Work**에서 이 저장소를 연 뒤 원고 파일을 첨부하고 아래처럼
요청한다.

> AGENTS.md를 읽고 첨부한 성령사연 원고를 `work-upload/<편번호>.json` 작업표로
> 만들어 main에 커밋·푸시해 줘. 원고의 빈 줄은 문단 경계로 보존해 줘.

Work가 작업표 하나를 올리면 GitHub Actions가 자동으로 다음을 처리한다.

1. `sayeon.json`에 새 편 추가
2. 현수 목소리 MP3 생성
3. 읽는 문단을 표시할 `audio/sync.json` 생성
4. 생성 결과를 main에 커밋
5. GitHub Pages 재배포

작업표 형식은 다음과 같다. `content` 대신 문단별 배열인 `paragraphs`를 넣어도 된다.

```json
{
  "category": "sayeon",
  "year": 2026,
  "no": 162,
  "title": "성령 사연 162",
  "content": "첫 문단 첫 줄\n첫 문단 둘째 줄\n\n둘째 문단"
}
```

이미 있는 편을 의도적으로 교체할 때만 `"replace": true`를 추가한다. 현재 자동
파이프라인은 2026년 성령사연을 지원한다. 말씀과 월명동은 기존 자료 구조와 이미지
처리가 서로 달라 별도 작업표 형식으로 확장한다.
