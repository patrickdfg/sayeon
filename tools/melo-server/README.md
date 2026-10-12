# Oracle 무료 서버 MeloTTS 시험 준비

아직 배포하지 않았다. ARM 환경 설치·속도 검증이 남아 있다.

## 서버 확보
- Oracle 계정 가입 후 Always Free 대상 A1 인스턴스만 선택한다.
- 2026-10-12 공식 문서 기준 전체 무료 한도는 2 OCPU/12GB RAM,
  부트·블록 볼륨 합계 200GB다. 생성 화면의 무료 표시와 예상 비용을 다시 확인한다.
- Ubuntu ARM64를 사용할 계획이다. 무료 서버가 없으면 유료로 우회하지 않는다.
- 유휴 서버 회수 가능성이 있어 상시 가용성을 보장하지 않는다.

## 연결 구조
브라우저 → 인증·사용 제한을 둔 중계 서버 → HTTPS Melo API

브라우저에 MELO_API_TOKEN을 넣지 않는다. API는 한 번에 한 문단(1000자 이하),
한 요청만 처리한다. 결과는 메모리의 WAV로 반환하며 원고·음성을 파일로 저장하지 않는다.
서버는 원고를 로그에 출력하지 않고, 오류에도 원고를 포함하지 않는다.

## 설치 예정
Python 3.10 가상환경에서 검증한 MeloTTS 커밋
209145371cff8fc3bd60d7be902ea69cbdb7965a를 사용한다.
ARM64용 PyTorch/torchaudio 설치 가능 버전을 실제 서버에서 확인하고 고정한다.
ffmpeg, libsndfile1, unidic, NLTK 데이터도 설치해야 한다.
FastAPI/uvicorn으로 app:app을 **127.0.0.1:8000, worker 1개**에서 실행한다.
공개하기 전에 HTTPS, 중계 서버 인증, 요청 크기·빈도 제한을 구성하고
잘못된 토큰 거부, 동시 요청, 한글/기호 발음, 재생 중지 및 지연을 검증한다.
공유 비밀값은 운영 환경변수에만 보관한다.

공식 무료 자원 안내:
https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
