# FIFA Network Lab v6 배치 수집 안내

## 해결한 오류

`Too many API requests by single Worker invocation` 오류를 방지하기 위해 한 번의 Worker 실행에서 전체 자료를 처리하지 않습니다.

- 1회 실행 = 작업 1개
- 국가, GDP, 인구를 각각 별도 실행
- 경기 = 월별 1개 배치
- FIFA 랭킹 = 월별 1개 배치
- D1 INSERT/UPDATE는 `DB.batch()`로 75개씩 묶어 실행
- 진행 위치는 `collection_state.v6_cursor`에 저장
- 실패 시 커서가 이동하지 않아 다음 실행에서 동일 작업 재시도

## 홈페이지 사용

1. 데이터 메뉴로 이동합니다.
2. `다음 배치 수집`을 누릅니다.
3. 진행률과 다음 작업을 확인합니다.
4. 버튼을 반복하거나 Cron을 기다립니다.

`처음부터 재설정`은 진행 커서만 0으로 되돌립니다. 이미 적재된 데이터는 삭제하지 않으며 UPSERT로 중복을 방지합니다.

## Cloudflare 변수

- `DATA_WINDOW_YEARS=4`
- `BATCH_STATEMENTS=75`
- `MATCH_CSV_URL=https://raw.githubusercontent.com/martj42/international_results/master/results.csv`
- `FREE_RANKING_CSV_URL=https://raw.githubusercontent.com/Dato-Futbol/fifa-ranking/refs/heads/master/ranking_fifa_historical.csv`

무료 플랜에서 오류가 지속되면 `BATCH_STATEMENTS`를 `40` 또는 `25`로 낮추십시오.

## 진행 상태 API

- `/api/progress`
- `/api/dashboard`

예시:

```json
{
  "total": 101,
  "completed": 12,
  "remaining": 89,
  "percent": 12,
  "next": {"kind":"matches","month":"2023-04","label":"경기 2023-04"}
}
```

## Cron

기본 Cron은 매일 한국시간 오전 11시 15분에 다음 배치 하나를 처리합니다.

```text
15 2 * * *
```

초기 4년 백필을 빨리 끝내려면 홈페이지에서 수동으로 여러 번 실행하되, 이전 요청이 끝난 뒤 다음 버튼을 누르십시오.
