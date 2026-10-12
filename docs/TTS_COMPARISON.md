# 한국어 TTS 비교 시험

기존 원고와 게시된 음성은 바꾸지 않는다. `tools/tts_compare.py`의 공개 예문
4문단을 MeloTTS(CPU) 또는 Azure 현수로 생성해 Actions artifact에 저장한다.
표시용 줄마다 마침표를 추가하지 않으며 문단 사이에는 0.5초를 둔다.
기본 속도에서 먼저 비교하고, 같은 플레이어 속도로 들어야 한다.

## MeloTTS

GitHub Actions → **한국어 TTS 비교 시험** → Run workflow → `melo`.
완료 후 `melo-korean-sample` artifact를 받는다. MP3, WAV, 예문,
문단 시작 시간, 생성 시간 보고서가 들어 있다. 보관 기간은 14일이다.
공개 저장소 표준 Ubuntu CPU runner를 사용한다. MeloTTS 소스 버전은 고정했다.
첫 실행은 설치와 모델 다운로드 때문에 실제 합성보다 오래 걸릴 수 있다.

## Azure 현수: 사용자 계정 설정 필요

1. https://portal.azure.com 에서 로그인한다.
2. Speech 리소스를 만들고 가격 계층을 **Free F0**로 선택한다.
   F0가 없으면 유료 S0로 대신 만들지 말고 중단한다.
3. 리소스의 **Keys and Endpoint**에서 키와 지역 코드를 확인한다.
4. https://github.com/patrickdfg/sayeon/settings/secrets/actions 에서
   다음 repository secrets를 추가한다.
   - `AZURE_SPEECH_KEY`: Speech 리소스 키
   - `AZURE_SPEECH_REGION`: 해당 리소스의 지역 코드
5. Actions → **한국어 TTS 비교 시험** → Run workflow → `azure`.
6. `azure-hyunsu-sample` artifact를 내려받아 같은 예문을 비교한다.

키는 채팅·원고·코드·일반 변수에 적지 않는다. 기존 `SAYEON_PASS`와는 다른 값이다.
이 시험은 짧은 예문 1회 요청이며 자동 재시도하지 않는다. F0 선택 여부는
Azure에서 확인해야 하며, 코드가 계정 요금제를 확인하거나 변경하지는 않는다.

https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech

## 실제 게시 연결 전 확인

발음, 문장 연결, 질문 억양, 긴 문단, 원문 누락 여부를 청취한다.
선택된 엔진에만 원고 처리와 파일별 문단 시간표를 연결한다.
이번 시험 자체는 실제 게시 엔진을 교체하지 않는다.
