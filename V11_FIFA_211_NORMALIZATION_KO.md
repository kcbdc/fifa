# v11 FIFA 211 회원국 정규화

## 핵심
- FIFA 공식 회원협회 수 211개를 분석 마스터로 고정
- 공식 FIFA 코드·6개 대륙연맹 저장
- South Korea/Korea Republic 등 별칭을 canonical FIFA 코드로 통합
- 비회원·역사국가·지역팀은 분석에서 제외하고 unmapped_team_names에 기록
- 기존 teams/matches/rankings를 한 번에 canonical 팀 ID로 병합
- 대시보드, 네트워크, ERGM 입력, JSON export는 FIFA 회원국만 사용

## 배포 후 필수
1. D1 마이그레이션 `0005_fifa_211_normalization.sql` 적용
2. 홈페이지 데이터 탭에서 `FIFA 211 정규화` 1회 실행
3. 대시보드에서 FIFA 회원국 211 확인

대시보드 최초 호출 시 정규화 이력이 없으면 자동으로 한 번 실행됩니다.
