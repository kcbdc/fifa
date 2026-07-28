# Footballdata.io 자동수집 설정

## Cloudflare Variables and Secrets

일반 변수:

- `DATA_PROVIDER` = `footballdata`
- `FIFA_RANKING_URL` = `https://footballdata.io/api/v1/fifa-rankings/current?ranking_type=men&limit=100`
- `FOOTBALLDATA_PERIODS_URL` = `https://footballdata.io/api/v1/fifa-rankings/periods?ranking_type=men&limit=100`
- `MATCH_API_URL` = `https://footballdata.io/api/v1/fixtures/results?from={from}&to={to}&limit=100&page={page}`
- `COUNTRY_API_URL` = `https://footballdata.io/api/v1/countries?limit=100`
- `DATA_WINDOW_YEARS` = `4`
- `MATCH_WINDOW_DAYS` = `31`
- `RANKING_BACKFILL_PER_RUN` = `2`

Secret:

- `FOOTBALLDATA_API_KEY` = Footballdata.io 대시보드에서 발급한 API 키

저장 후 Worker를 다시 배포합니다.

## 수집 방식

- 현재 랭킹: `/fifa-rankings/current`
- 과거 랭킹: `/fifa-rankings/periods`에서 날짜를 확인한 뒤 날짜별 `/fifa-rankings`
- 경기: `/fixtures/results?from=...&to=...`를 최대 31일 단위로 페이지 순회
- 국가대표 필터: 랭킹에 저장된 국가명과 경기 팀명을 정규화하여 일치하는 경기만 저장

## 무료 플랜 주의

공식 사이트 내 무료 요청량 표기가 1,000회와 2,000회로 혼재되어 있으므로 실제 계정 대시보드의 한도를 기준으로 운영합니다. 4년 전체 경기 백필은 호출량이 많아 여러 달에 나누거나 유료 플랜이 필요할 수 있습니다.
