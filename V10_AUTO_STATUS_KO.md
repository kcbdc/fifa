# FIFA Network Lab v10

## 주요 수정
- 첫 화면 진입 즉시 `/api/health`로 Worker와 D1 상태를 확인하여 `정상` 표시
- 대시보드의 일부 API가 실패해도 전체 초기화를 중단하지 않는 `Promise.allSettled` 방식 적용
- 외부 데이터 소스 연결진단을 첫 화면에서 자동 수행하고 상태를 갱신
- 데이터가 없어도 네트워크 캔버스에서 오류 대신 안내문 표시
- ERGM 화면 진입 시 GitHub 저장소·워크플로 접근을 자동 진단
- Wrangler 배포 시 Dashboard 변수를 덮어쓰던 GitHub placeholder를 `kcbdc/fifa`로 교체
- 버전 10.0.0

## 적용 전 필수
`wrangler.jsonc`의 `database_id`는 운영 중인 실제 D1 Database ID를 유지하십시오.

## 정상 확인
배포 직후 대시보드 상태 원에는 `정상`이 먼저 표시되고, 외부 데이터 소스 확인이 끝나면 `DB 및 외부 데이터 소스 5/5 연결`처럼 갱신됩니다.
