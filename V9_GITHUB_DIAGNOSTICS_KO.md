# FIFA Network Lab v9 설정 안내

## 핵심 변경

- `/api/github/diagnostics`에서 GitHub 사용자 인증, 저장소 접근, `analyze.yml` 접근을 순서대로 검사합니다.
- ERGM 화면의 **GitHub 연결 진단** 버튼으로 HTTP 상태와 대상 저장소를 확인합니다.
- Dispatch 오류에 실제 대상 URL, 저장소, 방식이 포함됩니다.
- 기본 ERGM 선택값은 `edges`만 활성화됩니다.
- 요청 모형이 퇴화하면 R 분석기가 `gwesp` 제거 → `mutual` 제거 → `edges` 순으로 안전한 후보 모형을 자동 재시도합니다.

## Cloudflare 변수

- `GITHUB_OWNER=kcbdc`
- `GITHUB_REPO=fifa`
- `GITHUB_WORKFLOW_FILE=analyze.yml` (선택)
- `GITHUB_DISPATCH_MODE=auto` (기본: repository_dispatch 실패 시 workflow_dispatch 자동 재시도)

Fine-grained PAT에는 `kcbdc/fifa` 저장소 접근과 **Contents: Read and write** 권한이 필요합니다.
`workflow_dispatch` 방식으로 변경하면 **Actions: Read and write** 권한이 필요합니다.

## 진단 결과 해석

- `authenticated-user 200`, `repository 404`: 토큰이 저장소에 접근하지 못함
- `repository 200`, `workflow 404`: `.github/workflows/analyze.yml` 위치 또는 기본 브랜치 문제
- 세 항목 모두 200: Dispatch 실행 가능 상태
