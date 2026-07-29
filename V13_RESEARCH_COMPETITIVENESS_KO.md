# FIFA Network Lab v13 논문 경쟁력 강화

## 추가 기능
- 연구 프로젝트 관리
- 데이터셋 동결 및 SHA-256 체크섬
- 연도별 반복단면 네트워크 지표(TERGM/STERGM 준비)
- GraphML/GEXF 내보내기
- BibTeX/RIS/APA 인용문 생성
- 상세 재현성·감사 추적 보고서

## D1 적용
`migrations/0006_research_competitiveness.sql`을 적용하십시오. 기존 D1에 `project_id` 열이 이미 있으면 ALTER TABLE 문은 제외하고 나머지를 실행하십시오.

## 주의
연도별 지표는 시간모형의 입력 준비 기능이며 TERGM 추정 자체는 후속 R 워크플로에서 수행해야 합니다. 데이터 동결 체크섬은 메타데이터·건수·출처를 기준으로 생성됩니다.
