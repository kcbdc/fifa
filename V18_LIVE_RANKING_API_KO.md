# v18 — 실시간 FIFA 랭킹 API 연동

## 배경

기존 `FREE_RANKING_CSV_URL`(Dato-Futbol `ranking_fifa_historical.csv`)은 2024년 9월 이후로
더 이상 갱신되지 않는 정적 스냅샷입니다. 이 버전은 FIFA 공식 사이트가 랭킹 테이블을 렌더링할 때
내부적으로 호출하는 비공개(hidden) JSON API를 별도 소스로 추가하여, 2026년을 포함한 최신 발표본을
계속 확보할 수 있게 합니다.

- 참고: FIFA 사이트는 랭킹 페이지에서 `https://www.fifa.com/api/ranking-overview?locale=en&dateId=idXXXXX`
  형태의 내부 API를 호출합니다. `dateId`를 생략하면 가장 최근 발표본을 반환합니다.
  ([관련 아티클](https://medium.com/@rico69/scraping-fifa-mens-ranking-with-scrapy-and-hidden-api-7799570b7737))
- 이 API는 FIFA가 공식적으로 문서화하거나 계약 형태로 보장하는 엔드포인트가 아닙니다. 사전 고지 없이
  응답 스키마나 URL이 바뀔 수 있으므로, 운영 전 이용조건을 반드시 확인하고 정기적으로 정상 동작을
  점검해야 합니다.

## 추가된 것

- `Env.LIVE_FIFA_RANKING_URL` — 실시간 랭킹 API 주소(기본값: 위 엔드포인트, dateId 생략)
- `cfg(e).apiRankingUrl` — provider 설정에 노출되어 `/api/provider`, `/api/provider/test`로 상태를 확인할 수 있습니다.
- `extractRankingRows()` / `pick()` / `normalizeLiveRow()` — FIFA API가 필드명을 바꾸더라도 어느 정도
  견딜 수 있도록, 응답 트리 전체를 순회해 "rank류 필드"와 "국가명/코드류 필드"를 함께 가진 배열 중
  가장 큰 것을 랭킹 테이블로 추정하는 방어적 파서입니다.
- `taskLiveRanking(e)` — 위 파서로 받은 행을 기존 `rankings` 테이블 스키마(team_id, release_date, rank,
  points, previous_rank, source_url)에 맞춰 UPSERT합니다. 기존 `taskRankings()`(CSV 기반, 월 단위 백필)와
  나란히 동작하며 서로 데이터를 덮어쓰지 않습니다.
- 배치 수집 계획(`plan()`)에 `최신 FIFA 랭킹(실시간 API)` 작업이 1건 추가되어, 4년 백필이 끝난 뒤
  자동으로 최신 스냅샷도 함께 수집됩니다.
- `POST /api/collect-live-ranking` (관리자 토큰 필요) — 배치 순서를 기다리지 않고 즉시 최신 랭킹만
  갱신하고 싶을 때 호출합니다.

## 설정 방법

`wrangler.jsonc`의 `vars`에 다음을 추가하십시오(기본값을 그대로 쓸 경우 생략 가능):

```jsonc
"LIVE_FIFA_RANKING_URL": "https://www.fifa.com/api/ranking-overview?locale=en"
```

배포 후 확인:

```bash
curl -s -X POST https://<your-worker>/api/collect-live-ranking \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

응답의 `inserted`가 0이고 `warning`에 "랭킹 배열을 찾지 못했습니다"라는 메시지가 나오면 FIFA가
API 응답 구조를 변경한 것이므로, `extractRankingRows()`/`normalizeLiveRow()`의 필드 매칭 정규식을
실제 응답 스키마에 맞게 조정해야 합니다.

## 운영상 주의

1. 이 엔드포인트는 FIFA의 공개·계약 API가 아니므로 재배포·상업적 이용 전 이용허가를 별도로 확인하십시오.
2. 요청 빈도를 과도하게 높이지 마십시오(배치 사이클당 1회, 필요 시 수동 1회 정도가 적절합니다).
3. 이 소스는 "현재 시점의 최신 발표본"만 제공합니다. 과거 이력은 계속 `FREE_RANKING_CSV_URL`
   (Dato-Futbol, 2024-09까지) 등 별도의 히스토리 소스로 보강해야 합니다.
