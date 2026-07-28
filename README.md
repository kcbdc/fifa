# FIFA Network Lab

Cloudflare Workers + Static Assets + D1 + Workers AI + GitHub Actions/R 기반 국가대표 경기 네트워크 연구 플랫폼.

## 포함 범위
1. 자동 수집 어댑터와 4년 데이터 창
2. D1 저장·품질검사·JSON/CSV 반입
3. 경기/승리 네트워크 그래프
4. ERGM 모델 빌더와 GitHub Actions R 실행 골격
5. 연구 데이터 내보내기 및 AI 해설 API

> FIFA가 일반 연구자용으로 보장하는 공개 API 주소는 프로젝트에 하드코딩하지 않았습니다. 사용 허가를 받은 공식 피드 또는 합법적 공급자 API를 `FIFA_RANKING_URL`, `MATCH_API_URL`로 지정하고 공급자 스키마에 맞춰 `collect()` 매핑을 완성하십시오.

## 로컬 실행
```bash
npm install
npm run db:local
npm run seed:local
npm run dev
```
브라우저: http://localhost:8787

## 배포
상세 절차는 `SETUP_KO.md` 참고.

## v2 자동수집 어댑터

`PROVIDER_SETUP_KO.md`를 참고하십시오. Sportradar FIFA Rankings와 Daily Summaries JSON 매핑, 국가대표 코드 필터, 최근 4년 분할 백필 커서가 포함되어 있습니다.
