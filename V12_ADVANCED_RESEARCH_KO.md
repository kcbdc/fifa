# FIFA Network Lab v12 고급 연구 플랫폼

## 주요 추가 기능
- 중앙성 분석: In/Out/Total Degree, PageRank
- 탐색적 커뮤니티 탐지: 연결요소 기반 군집
- 대륙연맹별 네트워크 요약
- ERGM 모형 비교: AIC/BIC/수렴/대체모형 기록
- 재현성 매니페스트 JSON 다운로드
- 최신 ERGM 결과의 자동 해설 초안
- 고급분석 전용 화면과 개선된 대시보드 UI

## API
- `GET /api/analytics?type=win|match`
- `GET /api/model-comparison`
- `GET /api/reproducibility`
- `GET /api/interpret?id={model_run_id}`

## 연구상 주의
PageRank와 연결요소 군집은 탐색적 분석입니다. 논문 최종본에서는 R의 igraph/statnet 결과와 교차검증하십시오. 자동 해설은 연구자 검토 없이 그대로 사용하지 마십시오.
