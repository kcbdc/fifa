# FIFA Network Lab v5 — 무료 공개데이터 버전

## 데이터 공급원

1. 남자 국가대표 경기: `martj42/international_results`의 `results.csv`
   - 기본 URL: `https://raw.githubusercontent.com/martj42/international_results/master/results.csv`
   - FIFA 월드컵, 예선, 친선 등 남자 성인 국가대표 경기 수록
   - 최근 4년만 D1에 적재
2. 국가·좌표·지역: World Bank Country API
3. 1인당 GDP: World Bank `NY.GDP.PCAP.CD`
4. 인구: World Bank `SP.POP.TOTL`
5. FIFA 랭킹: 무료 공개 CSV URL을 `FREE_RANKING_CSV_URL`에 지정하거나 홈페이지에서 CSV 업로드

## 중요한 제한

FIFA가 일반 연구자에게 장기간 안정적으로 보장하는 공개 랭킹 API는 확인되지 않았습니다. 따라서 이 버전은 허가되지 않은 비공개 엔드포인트를 하드코딩하지 않습니다. 랭킹은 출처가 확인된 CSV를 업로드하거나, 연구자가 관리하는 공개 CSV URL을 연결합니다.

### 랭킹 CSV 필수 열

```csv
fifa_code,name,confederation,release_date,rank,points,previous_rank
KOR,Korea Republic,AFC,2026-07-10,23,1587.23,22
```

다음 별칭도 자동 인식합니다.

- 국가: `country_full`, `country`, `team`, `name`
- 코드: `country_abrv`, `country_code`, `iso3`, `code`
- 발표일: `rank_date`, `date`, `release_date`
- 포인트: `total_points`, `points`

## Cloudflare 홈페이지 설정

`Workers & Pages → fifa-network-lab → Settings → Variables and Secrets`에서 아래 일반 변수를 확인합니다.

- `DATA_WINDOW_YEARS` = `4`
- `MATCH_CSV_URL` = 기본 GitHub Raw URL
- `WORLD_BANK_COUNTRY_URL` = 기본 World Bank URL
- `WORLD_BANK_GDP_URL` = 기본 World Bank GDP URL
- `WORLD_BANK_POP_URL` = 기본 World Bank 인구 URL
- `FREE_RANKING_CSV_URL` = 선택사항

API 키나 Secret은 필요하지 않습니다.

## D1 반영

Cloudflare D1 Console에서 `migrations/0003_free_sources.sql` 내용을 한 번 실행합니다. 기존 0001·0002가 아직 적용되지 않았다면 순서대로 모두 실행합니다.

## 자동수집

Cron은 `15 2 * * *`로 설정되어 한국시간 매일 오전 11시 15분에 실행됩니다. 경기 CSV는 전체 파일을 읽되 최근 4년 행만 저장하고, 동일 경기는 `external_id`로 갱신합니다.

## 연구상 주의

- 경기 데이터는 커뮤니티 공개 데이터이며 FIFA의 공식 API가 아닙니다.
- `source_url`, 수집시각, 공급원 스냅샷을 D1에 기록합니다.
- 논문에서는 출처, 라이선스, 수집일과 국가명 매핑·결측 처리방식을 명시하십시오.
