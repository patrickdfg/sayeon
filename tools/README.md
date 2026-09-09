# 음성 도구

`tools/` 안에서 실행한다. 전체 작업 규칙은 저장소 루트의 `AGENTS.md` 를 본다.

| 파일 | 하는 일 |
| --- | --- |
| `make_tts.py` | 원고를 컴퓨터 목소리로 읽어 mp3 를 만들고 `sayeon.json` 에 연결 |
| `build_sync.py` | 음성을 받아쓴 뒤 원고에 시간을 맞춰 `sync.json` 생성 |
| `align.py` | 받아쓴 결과를 원고 문단에 붙이는 계산 (build_sync 가 부른다) |
| `transcribe.py` | 받아쓰기만 따로 해 보고 싶을 때 쓰는 CLI |

## 1. 음성 만들기 (육성 녹음이 오기 전 임시)

무료 Edge TTS 를 쓴다. API 키가 필요 없다.

```bash
python -m pip install edge-tts    # 처음 한 번만
python make_tts.py 159            # 한 편
python make_tts.py 159 161 162    # 여러 편
python make_tts.py --all          # 음성 없는 편 전부
```

목소리는 `make_tts.py` 의 `VOICE` 에서 바꾼다.
현수(남자) `ko-KR-HyunsuMultilingualNeural`, 선희(여자) `ko-KR-SunHiNeural`,
인준(남자) `ko-KR-InJoonNeural`.

## 2. 문단 시간 맞추기 (음성을 넣었으면 반드시)

재생 중에 지금 읽는 문단을 짚어 주려면 `audio/sync.json` 이 필요하다.

```bash
python -m pip install faster-whisper    # 처음 한 번만
python build_sync.py base               # 이미 만든 편은 건너뛴다
```

음성을 새로 넣었으면 그 편만 처리하므로 그냥 다시 돌리면 된다.
받아쓴 중간 결과는 `.seg_cache/` 에 남는다(저장소에는 올리지 않는다).

**육성 녹음으로 교체할 때**는 `audio/sync.json` 에서 그 편 항목을 지우고
다시 돌려야 새로 맞춘다(안 지우면 건너뛴다).

## 모델 고르기

`base` 로 충분하다. 받아쓰기 자체가 목적이 아니라 시간만 맞추면 되고,
원고가 이미 있어서 좀 틀리게 들어도 앞뒤로 맞춰 붙기 때문이다.
더 정확히 하려면 `small` 을 쓰되 두 배쯤 오래 걸린다.
