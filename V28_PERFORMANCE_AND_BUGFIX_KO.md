# v28 — 전체 코드 정밀 분석: 성능 병목 및 버그 수정

전체 `src/index.ts`(578줄)와 `public/app.js`(252줄)를 처음부터 끝까지 다시 읽으며
점검했습니다. "분석 속도"와 직결된 문제를 우선순위로 찾았습니다.

## 🔴 가장 심각한 버그: 창 크기 변경마다 대시보드 전체를 다시 불러오고 있었음

**증상과 정확히 일치하는 원인을 찾았습니다.** `public/app.js`의 `resize` 이벤트 핸들러가:

```js
// 이전 코드
window.addEventListener('resize',()=>{
  clearTimeout(window.__graphResize);
  window.__graphResize=setTimeout(()=>{
    init();  // ← /api/dashboard, /api/quality, /api/rankings, /api/network 등
              //    5개 API를 매번 다시 호출!
    if($('#network').classList.contains('active'))drawExplorer();
  },180)
});
```

**모바일 브라우저는 화면 키보드가 열리거나 닫힐 때마다 `resize` 이벤트를 발생시킵니다.**
즉 실행번호 입력창, 검색창 등 **어떤 입력 필드를 탭하기만 해도** 대시보드 전체가 서버에서
다시 계산되고 있었습니다. 이번 대화에서 계속 보여주신 스크린샷들이 대부분 모바일
(Samsung Internet)이었던 걸 감안하면, 이게 체감 "속도 문제"의 상당 부분을 설명할 가능성이
높습니다.

### 수정
캔버스 리사이즈는 순수 클라이언트 작업(`draw()`는 서버 데이터가 필요 없고 이미 받아온
데이터만 다시 그림)이므로, 마지막으로 성공적으로 받아온 네트워크 데이터를
`window.__lastHomeNetwork`/`window.__lastExplorerNetwork`에 저장해뒀다가 리사이즈 시
**그 데이터로만 다시 그리도록** 바꿨습니다. 서버 재조회는 데이터가 아직 한 번도 로드되지
않은 최초 1회만 발생합니다.

## 성능 최적화

### 1. 엣지 캐싱 (가장 효과 큰 최적화)
`/api/dashboard`, `/api/network`, `/api/analytics`, `/api/temporal-network`,
`/api/period-comparison`, `/api/quality`는 매 요청마다 D1에서 수천 건의 경기 데이터를
읽고 PageRank·커뮤니티 계산을 새로 합니다. Cloudflare Workers 표준 **Cache API**
(`caches.default`)로 짧은 TTL(30~120초)의 엣지 캐싱을 추가했습니다.

- 탭을 전환했다가 돌아오거나, 같은 조건으로 새로고침하면 D1까지 가지 않고 즉시 응답합니다.
- 응답 헤더의 `x-cache: HIT/MISS`로 캐시 적중 여부를 확인할 수 있습니다.
- **데이터가 실제로 바뀌는 시점(배치 수집·가져오기·정규화 직후)에는 `/api/dashboard`
  캐시를 즉시 무효화**하도록 만들어서, "방금 수집했는데 숫자가 그대로"인 혼란을 방지했습니다.
- 연구용 대시보드 특성상 수십 초의 캐시 지연은 문제되지 않는다고 판단했습니다. TTL이 너무
  길게/짧게 느껴지면 `cachedJson()` 호출부의 초 단위 숫자만 조정하면 됩니다.

### 2. `network()` 쿼리 컬럼 최소화
경기 조회 시 `matches.*`(id, external_id, competition, stage, importance, neutral,
source_url, collected_at 등 실제로 안 쓰는 컬럼 포함 전체)를 가져오고 있었습니다.
실제 사용하는 `match_date, home_score, away_score`만 선택하도록 좁혀서 D1↔Worker 간
전송량과 JSON 파싱 비용을 줄였습니다.

### 3. 시간 구간별(연도별) 조회 병렬화
`temporalNetwork()`(연도별 지표 계산)가 연도마다 `for` 루프 안에서 순차적으로
`await network(...)`를 호출하고 있었습니다 — 4년 조회면 4번의 왕복 지연이 그대로
누적됩니다. `Promise.all`로 모든 연도를 동시에 조회하도록 바꿨습니다.

### 4. 복합 인덱스 추가 (`migrations/0009_performance_indexes.sql`)
`matches(match_date, home_team_id, away_team_id)` 복합 인덱스를 추가했습니다. 기존에는
`match_date` 단일 컬럼 인덱스만 있어서, 데이터가 계속 쌓일수록(현재도 이미 5천~1만 건대로
추정) 날짜 필터 이후 팀 조인 단계가 점점 느려지는 구조였습니다.

### 5. 중복 DB 조회 제거
`dashboard()`가 같은 `fifa_normalized_at` 상태값을 함수 시작과 끝에서 두 번 조회하고
있었습니다. 한 번만 조회하고 재사용하도록 정리했습니다(정규화가 방금 처음 실행된 경우만
값이 바뀌므로 그 경우에만 다시 읽음).

## 검증

```
npm run check
# tests 15
# pass 15
# fail 0
```

`tsc --noEmit` 통과, 15개 테스트 전부 통과. `caches.default` 사용이 프로젝트의 TS
설정(`lib: ["ES2022","WebWorker"]`)에서 정상적으로 타입 체크되는 것도 확인했습니다.

## 적용 방법

```bash
npm run db:remote   # 0009 마이그레이션(인덱스) 적용
npm run deploy
```

배포 후 브라우저 개발자도구 Network 탭에서 `/api/dashboard` 등의 응답 헤더에
`x-cache: HIT`가 뜨는지, 그리고 입력창을 탭했을 때(모바일) 더 이상 전체 화면이
버벅이지 않는지 확인해보시면 됩니다.
