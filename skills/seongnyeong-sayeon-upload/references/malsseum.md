# C. 수요·주일 말씀 올리기 — malsseum

## 1. 사용자가 한글(.hwp)과 녹음(.mp3)을 줄 때 — `mal-upload`

`patrickdfg/malsseum` 의 `mal-upload/<묶음>/` 에 올린다. 묶음 이름은 `claude-MMDD` 처럼 겹치지 않게 짓는다.

| 파일 | 내용 |
| --- | --- |
| `script.hwp` | 원고 |
| `audio.mp3.part000`, `part001` … | 녹음을 6MB 조각으로 자른 것 |
| `job.json` | **맨 나중에** 올린다. 올라오면 `mal-upload.yml` 이 깨어난다 |

```json
{"hwp": "script.hwp", "parts": ["audio.mp3.part000", "audio.mp3.part001"],
 "sha256": "<합친 mp3 의 SHA-256>", "size": 12345678,
 "join": false, "replace": false, "no": null, "dry_run": false}
```

- 로봇이 하는 일 — 조각 합치기·SHA-256 확인 → 원고 머리글에서 날짜(`audio/MMDD.mp3`)와 제목 읽기 → 번호 매기기 → **-16 LUFS 로 맞추기**(25MB 넘으면 48kbps 모노로 함께 줄임) → 잠긴 자료에 넣기 → 문단 시간표 → 배포. 같은 날 같은 말씀이 있으면 멈춘다(`replace` 는 사용자가 말할 때만).
- 소리는 올리기 전에 따로 맞추지 않아도 된다. 이미 -16 이면 건너뛴다.
- `"dry_run": true` 로 먼저 시험해 볼 수 있다(자료에 넣지 않음).
- 인용 화자는 `"speakers": {"문단번호(0부터)": ["god", null]}` 로 지정할 수 있다. 사용자가 검토해 준 때만 쓴다.
- 처리가 막히면 묶음 폴더는 로봇이 치운다. 처음부터 다시 올린다.
- 조각 올리기·SHA-256 계산이 이 환경에서 안 되면 만들려 하지 말고 앱의 '말씀' 탭을 권한다.

## 2. 녹음이 없을 때 — 현수 목소리

1. `python tools/import_malsseum_hwp.py <hwp> --no <번호> --write` 로 원고를 넣는다(`SAYEON_PASS` 환경변수 필요, 값은 사용자가 주는 대로만 쓰고 기록하지 않는다).
2. `malsseum-tts-request.json` 에 `{"numbers":[<번호>]}` 를 올리거나 Actions 의 `말씀 현수 TTS 생성` 을 돌린다 → `audio/MMDD.mp3` + 시간표.
3. 이 경로는 -16 자동이 없다. 만든 mp3 를 `tools/loud16.py --fix 파일` 로 -16 에 맞추고, `tools/match_volume.py` 의 `KEEP_16` 목록에 파일 이름을 더한다(안 그러면 -18.4 로 되돌려진다).
