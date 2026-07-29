# FIFA Network Lab v14 — TERGM Workflow Integration

## 추가 기능

- GitHub Actions에서 `ergm`, `tergm`, `networkDynamic`, `tsna`, `btergm`, `coda`, `texreg`, `igraph` 자동 설치 및 캐시
- 수동 실행 시 분석 모드 선택: `ergm`, `tergm`, `both`
- 홈페이지 실행은 기본적으로 정적 ERGM과 TERGM을 모두 요청
- 연도별 네트워크 패널 자동 생성
- CMLE 방식의 TERGM 추정
- 방향 네트워크: `Form(~edges + mutual) + Persist(~edges)` 우선 실행
- 퇴화·수렴 오류 시 `Form(~edges) + Persist(~edges)`로 자동 재시도
- 정적 ERGM과 시간 ERGM 산출물을 동일 Artifact에 저장
- TERGM 결과를 D1 `temporal_model_results` 테이블에 저장

## 적용 순서

1. 기존 운영 `wrangler.jsonc`의 실제 D1 database ID를 유지합니다.
2. GitHub 저장소 파일을 v14 파일로 교체합니다.
3. D1 Console에서 `migrations/0007_temporal_models.sql`을 실행합니다.
4. GitHub Secrets `API_BASE_URL`, `ANALYSIS_API_TOKEN`이 등록되어 있는지 확인합니다.
5. GitHub Actions → **ERGM and TERGM Analysis** → Run workflow에서 `run_id`와 분석 모드를 선택합니다.
6. 홈페이지에서 모형 실행 시에는 `both` 모드가 자동으로 전달됩니다.

## 산출물

- `coefficients.csv`
- `model-result.json`
- `model-summary.txt`
- `mcmc-diagnostics.png`
- `gof.png`
- `temporal-panels.csv`
- `temporal-coefficients.csv`
- `temporal-result.json`
- `temporal-summary.txt`
- `temporal-gof.png`(생성 가능한 경우)
- `workflow-manifest.json`

## 분석 원칙

연도별 패널은 같은 211개 FIFA 회원국 노드 집합을 사용합니다. 각 연도에 한 번 이상 발생한 경기관계 또는 승리관계를 이진 엣지로 구성합니다. 방향 승리 네트워크에서 무승부는 제외됩니다.

`Persist(~edges)`의 양(+) 계수는 전년도 관계가 다음 연도에도 유지될 가능성이 높다는 뜻입니다. `Form(~mutual)`이 포함된 경우 상호적 승리관계가 새로 형성되는 경향을 나타냅니다.

TERGM 단계는 `continue-on-error`로 분리되어 있으므로 시간 패널이 부족하거나 시간모형이 실패해도 성공한 정적 ERGM 산출물은 보존됩니다.
