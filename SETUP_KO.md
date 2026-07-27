# 홈페이지 세팅법

## 1. GitHub
1. 새 저장소를 만들고 이 폴더 전체를 push합니다.
2. Settings → Secrets and variables → Actions에 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`를 등록합니다.
3. Worker에서 Actions를 호출하려면 Cloudflare secret `GITHUB_TOKEN`도 등록합니다. 최소 권한 토큰을 사용하십시오.

## 2. Cloudflare D1
```bash
npm install
npx wrangler login
npx wrangler d1 create fifa-network-db
```
출력된 database_id를 `wrangler.jsonc`의 `REPLACE_WITH_D1_DATABASE_ID`와 교체합니다.
```bash
npm run db:remote
npx wrangler d1 execute fifa-network-db --remote --file=./scripts/seed.sql
```

## 3. 비밀값·수집 URL
```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put GITHUB_TOKEN
```
`wrangler.jsonc`의 vars에서 `FIFA_RANKING_URL`, `MATCH_API_URL`, `GITHUB_OWNER`, `GITHUB_REPO`를 설정합니다. URL은 이용허가와 약관을 확인한 공식/계약 데이터 피드만 사용하십시오.

## 4. 배포
```bash
npm run check
npm run deploy
```
또는 GitHub main 브랜치 push 시 `.github/workflows/deploy.yml`이 자동 배포합니다.

## 5. Cloudflare 대시보드 연결 방식
Workers & Pages → Create → Import a repository에서 저장소를 연결할 수도 있습니다. Worker 이름은 `wrangler.jsonc`의 `fifa-network-lab`과 동일하게 설정합니다.

## 6. 실제 ERGM 활성화
`r-analysis/run_ergm.R`에서 배포 사이트 `/api/export` 데이터를 읽고 `network`, `ergm`, `tergm` 패키지로 네트워크를 생성합니다. 분석 결과를 D1에 회신하려면 관리자 전용 결과 업로드 API를 추가하고 GitHub Secret에 사이트 URL과 ADMIN_TOKEN을 저장합니다.

## 7. 운영 전 필수 점검
- FIFA/경기 데이터 이용허가와 재배포 범위
- 국가코드 매핑 및 중복 경기 규칙
- 승부차기·연장전·중립경기 처리
- 분석기간 고정 및 데이터 해시
- ERGM MCMC 수렴, degeneracy, GOF
- AI 해설의 연구자 검토
