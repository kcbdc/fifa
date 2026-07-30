# v21 — ERGM 실행 중 GitHub Actions 단계별 진행률 표시

## 문제

[ERGM] 탭에서 "모형 실행"을 누르면 상태가 `dispatched` → (몇 분 뒤) `completed`로만 바뀌고,
그 사이에는 화면에 아무 진행 표시도 없었습니다. 실제로는 GitHub Actions에서 R 환경 설치 →
ERGM 적합 → 결과 업로드까지 여러 단계를 거치는데(보통 수 분~10분 이상 소요), 화면만 보면
"멈췄다" 또는 "이미 끝났다"고 오해하기 쉬웠습니다.

## 해결 방식

Cloudflare Worker는 `repository_dispatch`로 워크플로를 "깨우기"만 할 뿐, 그 결과로 실제
어떤 GitHub Actions 실행(run)이 시작됐는지 알 방법이 원래 없습니다(디스패치 API가 run id를
돌려주지 않음). 그래서 **워크플로 스스로 자기 실행 ID를 맨 첫 단계에서 Worker에 보고**하도록
만들고, Worker는 그 ID로 GitHub API를 조회해 단계별 상태를 화면에 보여줍니다.

### 1. 워크플로 (`analyze.yml`)
새 첫 번째 단계 `Report GitHub run ID to API`가 `${{ github.run_id }}`를
`POST /api/model-github-run`으로 즉시 전송합니다. 실패해도(`|| echo ...`) 전체 워크플로가
죽지 않도록 했습니다 — 진행률 표시는 부가 기능이지 핵심 분석 파이프라인이 아니기 때문입니다.

### 2. DB
`migrations/0008_github_run_tracking.sql`로 `model_runs`에 `github_run_id`,
`github_run_url` 컬럼을 추가했습니다.

### 3. Worker API
- `POST /api/model-github-run` — 워크플로가 자기 실행 ID를 보고하는 곳(`ANALYSIS_API_TOKEN` 인증)
- `GET /api/github/run-progress?id=<model_run_id>` — 저장된 `github_run_id`로
  `GET /repos/{owner}/{repo}/actions/runs/{id}/jobs`를 호출해, 9개 단계
  (실행 ID 보고 → 체크아웃 → R 설정 → 패키지 설치 → 설정 검증 → ERGM 적합 → TERGM 적합 →
  기록 저장 → 결과물 업로드) 각각의 `status`/`conclusion`을 한국어 라벨과 함께 반환합니다.

### 4. 프론트엔드
- [ERGM] 탭 "분석 상태" 아래에 단계별 체크리스트(`✅`/`🔄`/`⏳`/`❌`)가 새로 표시됩니다.
- "모형 실행" 또는 "상태 조회"를 누르면 8초 간격으로 자동 폴링을 시작하고, GitHub job과
  모형 상태가 모두 완료/실패로 끝나면 자동으로 폴링을 멈춥니다.
- 다른 탭으로 이동하면 폴링이 중단되어 불필요한 API 호출이 쌓이지 않습니다.
- 체크리스트 옆에 "Actions에서 보기" 링크로 GitHub의 실제 로그 페이지로 바로 이동할 수
  있습니다.

## 참고

- 이 보고 단계는 `curl`만 쓰는 가벼운 단계라 R 환경 설치보다 먼저 실행되며, 보통 몇 초 안에
  끝나 화면에 진행률이 뜨기까지 오래 기다릴 필요가 없습니다.
- 과거에 실행된(이번 v21 배포 이전) 모형 실행 기록은 `github_run_id`가 없으므로, 그 실행번호로
  조회하면 "GitHub 실행이 아직 시작되지 않았거나 보고되지 않았습니다"라는 안내만 뜹니다 —
  정상입니다. v21 배포 이후 새로 실행한 것부터 단계별 진행률이 보입니다.
