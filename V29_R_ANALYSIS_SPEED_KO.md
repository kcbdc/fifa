# v29 — R 분석(GitHub Actions) 속도 개선

## 레버 1: ERGM만 빠르게 실행하는 옵션 추가

지금까지는 [ERGM] 탭에서 "모형 실행"을 누르면 **항상 정적 ERGM + 시간적 TERGM을 둘 다**
순서대로 돌렸습니다(`src/index.ts`의 `triggerGithub()`에 `analysis_mode:'both'`가
하드코딩돼 있었음). TERGM 적합은 보통 정적 ERGM보다 훨씬 오래 걸리는데, baseline 모형을
빠르게 확인하고 싶을 때도 매번 TERGM까지 기다려야 했습니다.

**추가**: [ERGM] 탭에 "분석 범위" 선택창을 추가했습니다.
- **정적+시간적 모형 모두(기본)** — 기존과 동일
- **정적 ERGM만(빠름)** — TERGM 생략, 빠른 반복 실험에 적합
- **시간적 TERGM만** — 이미 완료된 ERGM 결과에 시간 분석만 추가하고 싶을 때

선택값은 `analysisMode`로 `/api/models` → `triggerGithub()` → GitHub Actions의
`analysis_mode` 입력(workflow_dispatch) 또는 `client_payload.analysis_mode`
(repository_dispatch)로 그대로 전달됩니다. (이 파라미터 자체는 v17부터 워크플로에 이미
있었지만, Worker 쪽에서 한 번도 활용하지 않고 있었습니다.)

## 레버 2: 정적 ERGM과 시간적 TERGM을 병렬 실행

`.github/workflows/analyze.yml`을 재구성했습니다.

**이전**: `report → checkout → R설정 → 패키지설치 → 검증 → [ERGM 실행] → [TERGM 실행] → 기록 → 업로드`
하나의 job 안에서 전부 순서대로 실행 (총 시간 = ERGM 시간 + TERGM 시간 + 공통 설정 시간)

**이후**: 4개 job으로 분리
```
report-run (실행 ID 보고 + 설정 검증)
   ├─→ static-ergm   (체크아웃→R설정→패키지설치→ERGM 실행→업로드)   ┐ 병렬 실행
   └─→ temporal-tergm(체크아웃→R설정→패키지설치→TERGM 실행→업로드)  ┘
         └─→ manifest (실행 기록 저장, 두 job이 끝나면 성공/스킵 여부와 무관하게 실행)
```

`static-ergm`과 `temporal-tergm`은 서로 의존하지 않고 `report-run`에만 의존하므로 **GitHub
Actions가 동시에 실행**합니다. "정적+시간적 모두" 모드의 총 소요시간이 대략
`ERGM 시간 + TERGM 시간`에서 `max(ERGM 시간, TERGM 시간)`로 줄어듭니다. "정적 ERGM만"이나
"시간적 TERGM만"을 선택하면 해당하지 않는 job은 `if:` 조건에 걸려 자동으로 스킵됩니다
(레버 1과 자연스럽게 맞물림 — 둘 다 켜져 있을 때만 진짜 "병렬"의 이득이 있고, 하나만 켜면
애초에 그 job만 실행되어 더 빠릅니다).

패키지 설치 목록은 두 job에 동일하게(전체) 유지했습니다. `run_tergm.R`이 명시적으로
`library()`하지 않는 `sna`/`coda`/`texreg`/`igraph` 등이 실제로는 `ergm`/`tergm`
내부에서 네임스페이스 호출로 쓰일 수 있어서, 섣불리 줄였다가 조용히 깨지는 것보단
안전하게 그대로 뒀습니다. 캐시(`cache-version: 14`)가 적중하면 어차피 두 job 모두 설치
자체는 빠릅니다.

### 부가 수정: 단계별 진행률 표시(v21)가 여러 job을 반영하도록 업데이트
v21에서 만든 "GitHub 진행 상황" 체크리스트는 원래 **job이 1개**라는 전제로
`jobs[0]`만 읽고 있었습니다. 이번에 job이 4개로 늘었으니 그대로 뒀다면 `report-run`
(몇 초짜리 job)의 스텝만 보이고 정작 중요한 ERGM/TERGM 진행 상황은 안 보이는 회귀
버그가 생길 뻔했습니다. `githubRunProgress()`가 **모든 job의 스텝을 job별로 모아서**
반환하도록 고쳤고, 화면에서도 job 이름별로 그룹지어 표시합니다(예: "정적 ERGM (병렬)",
"시간적 TERGM (병렬)").

## 검증

```
npm run check
# tests 15, pass 15, fail 0
```
`.github/workflows/analyze.yml`은 PyYAML로 파싱해 4개 job과 각 job의 `needs`/`if`/스텝
구성이 의도대로 생성됐는지 확인했습니다. 다만 **실제 GitHub Actions 러너에서 동시 실행이
정상적으로 되는지는 이 환경에서 직접 실행해볼 수 없어, 배포 후 실제 실행으로 확인이
필요합니다.**

## 더 빠르게 하고 싶다면 (이번엔 적용 안 함, 참고용)

**R 환경을 미리 빌드된 Docker 컨테이너로 교체**하면 "R 패키지 설치" 단계 자체가 거의
사라집니다(이미지에 statnet 생태계가 다 설치돼 있으므로). 다만 이건:
- Dockerfile을 만들고 GitHub Container Registry(ghcr.io)에 이미지를 미리 빌드·게시해둬야
  하고, 패키지 버전이 바뀔 때마다 이미지도 다시 빌드해야 하는 유지보수 부담이 생깁니다.
- 지금 파이프라인이 이미 정상 동작 중인데 컨테이너 이미지가 없는 상태로 무작정 바꾸면
  배포가 깨지므로, 이번엔 적용하지 않았습니다.

원하시면 Dockerfile과 이미지 빌드용 워크플로를 별도로 만들어서, 이미지를 먼저 검증한 뒤
`analyze.yml`에서 `container:`로 전환하는 걸 다음 단계로 진행해드릴 수 있습니다.
