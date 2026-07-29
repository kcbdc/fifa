# FIFA Network Lab v8 — ERGM 사전검증·R 변환 안정화

## 수정된 오류

GitHub Actions에서 발생하던 다음 오류를 수정했습니다.

```
arguments imply differing number of rows: 1, 0
```

원인은 JSON의 행별 누락 필드를 `as.data.frame()`이 직접 처리하면서 열 길이가 달라진 것이었습니다. v8은 모든 JSON 레코드의 필드 합집합을 만든 뒤 누락값을 `NA`로 채우는 `records_to_df()`를 사용합니다.

## 새 기능

- `/api/model-validation?type=win|match` 사전검증 API
- 홈페이지 `실행 전 검증` 버튼
- 국가·경기·랭킹·사용 가능 엣지 수 표시
- 데이터 부족 시 GitHub Actions를 호출하지 않고 422 응답
- R 분석 전 필수 열·행·엣지 검증
- 실패 시 `data-validation.json`, `model-result.json`, `model-summary.txt` 생성
- ergm 버전별 계수표 열 이름 차이를 자동 인식
- 랭킹이 없어도 0점으로 대체하고 경고 기록

## 적용

기존 저장소 파일을 v8 파일로 교체하되 `wrangler.jsonc`의 실제 D1 `database_id`는 유지하십시오. 커밋 후 Cloudflare와 GitHub Actions가 자동 갱신됩니다.

새 D1 마이그레이션은 필요하지 않습니다.
