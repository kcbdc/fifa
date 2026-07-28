# 자동수집 공급자 설정

## 권장 공급자: Sportradar Soccer Extended v4

공식 문서에 공개된 엔드포인트 구조를 사용합니다.

- 현재 FIFA 남자 국가대표 랭킹
  - `https://api.sportradar.com/soccer-extended/trial/v4/en/fifa_rankings.json`
- 날짜별 경기 요약
  - `https://api.sportradar.com/soccer-extended/trial/v4/en/schedules/{date}/summaries.json`
- 인증 헤더
  - `x-api-key: 발급받은 키`

Cloudflare Dashboard에서 Worker → Settings → Variables and Secrets로 이동해 아래를 등록합니다.

### 일반 변수

| 이름 | 값 |
|---|---|
| `DATA_PROVIDER` | `sportradar` |
| `SPORTRADAR_ACCESS_LEVEL` | 체험판 `trial`, 계약판 `production` |
| `SPORTRADAR_LANGUAGE` | `en` |
| `BACKFILL_DAYS_PER_RUN` | `7` 권장 |
| `FIFA_RANKING_URL` | 위 FIFA 랭킹 URL |
| `MATCH_API_URL` | 위 날짜별 경기 URL. `{date}` 유지 |

### 암호화 Secret

| 이름 | 값 |
|---|---|
| `SPORTRADAR_API_KEY` | Sportradar에서 발급한 API Key |
| `ADMIN_TOKEN` | 자동수집 버튼 보호용 임의의 긴 문자열(선택) |

`ADMIN_TOKEN`을 설정하면 브라우저의 자동수집 버튼은 Authorization 헤더가 없으므로 401이 납니다. 공개 운영에서 버튼을 숨기거나 별도 로그인 기능을 붙이기 전에는 ADMIN_TOKEN을 비워 두고, 데이터 변경 API 보안이 필요하면 반드시 인증 UI를 추가하십시오.

## 최근 4년 백필 방식

Workers의 한 번 실행에서 1,461일을 모두 호출하면 시간 제한과 API 호출한도를 초과할 수 있습니다. 이 소스는 `collection_state.match_backfill_cursor`에 진행 날짜를 저장하고 Cron 실행 때마다 `BACKFILL_DAYS_PER_RUN`만큼 전진합니다.

- 7일/일 실행: 약 209일 소요
- 14일/일 실행: 약 105일 소요
- 31일/일 실행: 약 48일 소요

공급자 요금제 호출한도를 먼저 확인하십시오. 특정 날짜는 데이터 수집센터에서 직접 지정할 수 있습니다.

## 중요한 연구상 한계

Sportradar의 FIFA Rankings 엔드포인트는 현재 스냅샷과 직전 변동값을 제공합니다. 과거 4년의 모든 공식 발표 스냅샷이 한 번에 반환된다고 보장되지 않습니다. 따라서:

1. 배포 시점부터 매일 랭킹 스냅샷을 자동 축적하고,
2. 과거 랭킹은 라이선스가 있는 역사 데이터 공급자 또는 출처가 명확한 CSV로 보완하며,
3. 논문에는 공급자, 조회일, 이용조건, 결측 보완방법을 기록해야 합니다.

## 대체 공급자

Footballdata.io는 JSON API, 과거 경기 결과와 FIFA 랭킹 기능을 안내하지만 FIFA 랭킹은 유료 Starter 이상이며 구체적인 계약·엔드포인트 권한은 계정에서 확인해야 합니다. 소스에는 `DATA_PROVIDER=footballdata`용 범용 매퍼가 포함되어 있으나, 계정에서 제공되는 실제 FIFA Ranking URL과 Fixture URL을 `FIFA_RANKING_URL`, `MATCH_API_URL`에 넣어야 합니다.
