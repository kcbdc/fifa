# v22 — "edges만 있는" 모형에서 MCMC 진단 크래시 수정

## 원인

```
Error in mcmc.diagnostics.ergm(fit) :
  MCMC was not run or MCMC sample was not stored.
```

`edges`만 선택한 모형(구조효과에서 mutual/gwesp를 안 넣은 가장 단순한 모형)은 통계적으로
**dyad-independent**입니다. 이런 모형은 `ergm()`이 MCMC를 아예 돌리지 않고 MPLE
(최대유사우도추정)만으로 바로 정확한 결과를 냅니다 — MPLE와 MLE가 일치하기 때문입니다.
그런데 `r-analysis/run_ergm.R`은 항상 `mcmc.diagnostics(fit)`를 무조건 호출하고 있었고,
MCMC 샘플이 아예 없는 이런 모형에서는 이 호출 자체가 에러를 던져서 **스크립트 전체가
죽고, 이미 정상적으로 계산된 계수·AIC·BIC까지 전부 유실**되고 있었습니다.

## 수정

`mcmc.diagnostics(fit)`와 `gof(fit)` 호출을 각각 `tryCatch`로 감싸서, 실패해도 전체
분석이 죽지 않고 계속 진행되도록 했습니다.

- MCMC 진단이 실패하면(=애초에 MCMC가 필요 없던 dyad-independent 모형이면) 진단 PNG는
  건너뛰고, 결과 JSON의 `mcmc_used: false`와 `diagnostics.mcmc_diagnostics`에 그 이유를
  기록합니다.
- GOF(`gof(fit)`)도 같은 방식으로 방어적으로 처리해, 혹시 실패하더라도 `gof_available: false`로
  표시될 뿐 나머지 결과는 정상 저장됩니다.
- **계수·AIC·BIC·수렴 여부는 이제 항상 저장됩니다.** MCMC 진단/GOF 플롯은 "있으면 좋은
  부가 정보"로 격하시켰습니다.

## 이게 왜 정상적인 상황인가

`edges`만 있는 모형은 "국가 간 경기가 있을 확률은 모든 쌍에서 동일하다"는 가장 기본적인
기준선(baseline) 모형입니다. 이런 모형에서 MCMC 진단이 없는 건 **버그가 아니라 통계적으로
당연한 결과**입니다. `mutual`이나 `gwesp`처럼 dyad-dependent 항이 들어간 모형부터는 실제로
MCMC가 돌고 진단 플롯도 정상적으로 생성됩니다.

## 적용 방법

이 파일은 Cloudflare Worker가 아니라 **GitHub 저장소(`kcbdc/fifa`)의 R 스크립트**이므로,
`r-analysis/run_ergm.R`을 이번 버전으로 교체해서 **저장소에 push**해야 다음 실행부터
반영됩니다(Worker 배포와는 무관).

```bash
git add r-analysis/run_ergm.R
git commit -m "fix: don't crash on MCMC diagnostics for dyad-independent (MPLE-only) ERGM fits"
git push
```

push 후 [ERGM] 탭에서 "모형 실행"을 다시 눌러보시면, v21에서 추가된 단계별 진행률 체크리스트로
"Run static ERGM" 단계가 이번엔 ❌ 없이 끝까지 통과하는 걸 볼 수 있을 겁니다.
