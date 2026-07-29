# v7 GitHub Actions R/ERGM 자동분석 설정

## GitHub 저장소 Secrets
Settings → Secrets and variables → Actions → New repository secret

- `API_BASE_URL`: `https://fifa-network-lab.junewoopark16.workers.dev`
- `ANALYSIS_API_TOKEN`: 임의의 긴 보안 문자열. Cloudflare의 동일 이름 Secret과 값이 같아야 합니다.

## Cloudflare Variables and Secrets
Workers & Pages → fifa-network-lab → Settings → Variables and Secrets

일반 변수:
- `GITHUB_OWNER`: GitHub 계정명
- `GITHUB_REPO`: 저장소명
- `PUBLIC_BASE_URL`: 운영 Worker 주소

Secret:
- `GITHUB_TOKEN`: Fine-grained PAT. 해당 저장소의 Contents Read and write 권한을 부여합니다.
- `ANALYSIS_API_TOKEN`: GitHub Secret과 동일한 긴 문자열

## GitHub Workflow 확인
저장소의 `.github/workflows/analyze.yml`이 main 브랜치에 올라가면 Actions 탭의 `All workflows` 메뉴에서 `ERGM Analysis`가 표시됩니다.

## 실행
홈페이지 ERGM 메뉴에서 모형 실행을 누르면 Worker가 repository_dispatch를 호출합니다. Actions 실행 후 D1의 model_runs 상태가 completed 또는 failed로 갱신됩니다. 홈페이지에서 실행번호를 입력하고 상태 조회를 누릅니다.

## 수동 실행
GitHub → Actions → ERGM Analysis → Run workflow → D1 model_runs ID 입력.
