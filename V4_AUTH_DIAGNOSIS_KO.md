# v4 인증·권한 진단 안내

## 핵심 변경
- `Authorization: Bearer <키>` 헤더를 Secret에서 읽어 자동 전송합니다.
- `/api/provider/test`에서 account, countries, rankings, matches를 각각 검사합니다.
- 응답 본문의 오류 코드와 메시지를 화면에 표시합니다. API 키 원문은 표시하지 않습니다.
- FIFA 랭킹이 403이어도 국가·경기 수집은 계속 진행합니다.

## Cloudflare 설정
Secret 이름은 정확히 `FOOTBALLDATA_API_KEY`로 등록하고 저장 후 새 배포를 실행합니다.

## 결과 해석
- `missing_api_key`: Secret 이름, Production 적용, 재배포 확인
- `invalid_api_key`, `api_key_inactive`: 공급자 대시보드에서 키 상태 확인
- 랭킹만 403: 해당 요금제에 FIFA 랭킹 권한이 없는 상태일 가능성이 큼
- 429: 호출량 초과

Footballdata.io 공식 도움말 기준 FIFA 랭킹은 Starter 이상이 필요할 수 있습니다. 무료 플랜에서는 국가·경기 데이터를 수집하고 랭킹은 CSV 업로드 또는 별도 허가 데이터로 보완하십시오.
