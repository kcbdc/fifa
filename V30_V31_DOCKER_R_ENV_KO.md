# v30/v31 — R 패키지 설치를 없애는 Docker 이미지 방식 (검증 후 적용 필요)

이전에 "이번엔 적용 안 함"이라고 남겨뒀던 부분입니다. 요청하신 대로 만들었지만,
**제 환경에는 Docker 데몬도 없고 CRAN/GHCR 접근도 막혀 있어 실제로 빌드해서 검증할 방법이
없습니다.** 그래서 지금 잘 동작 중인 `analyze.yml`은 전혀 건드리지 않고, **완전히 별도의
파일들로만** 추가했습니다. 검증 전까지는 기존 파이프라인에 어떤 영향도 주지 않습니다.

## v31 업데이트: 자동 재빌드 트리거 추가

처음 버전(v30)은 수동 실행(`workflow_dispatch`)만 지원해서, "패키지를 고쳤는데 재빌드를
깜빡함" / "몇 달째 오래된 패키지 버전으로 분석 중" 같은 상황이 생길 수 있었습니다.
`build-r-image.yml`에 트리거를 2개 더 추가했습니다.

- **`Dockerfile.r-env`가 바뀌어 main에 push될 때 자동 실행** — 패키지 목록을 고치고
  재빌드를 깜빡하는 걸 원천적으로 방지합니다.
- **매주 월요일 03:00(KST) 자동 실행(schedule)** — Dockerfile을 안 건드려도 CRAN 쪽에서
  ergm/tergm 등의 새 버전이나 보안 패치가 나오면 정기적으로 반영합니다.

즉 이제 "가끔 재빌드 버튼을 눌러야 하는 숙제"는 사실상 없어졌습니다 — Dockerfile을 고칠
때와 매주 한 번은 알아서 최신화됩니다. (그래도 원치 않으면 `build-r-image.yml`의
`schedule:`/`push:` 블록을 지우면 언제든 수동 전용으로 되돌릴 수 있습니다.)

## 추가된 파일 (기존 파일은 무엇도 수정하지 않음)

1. **`Dockerfile.r-env`** — R + ERGM/TERGM에 필요한 패키지 12개를 전부 미리 설치한 이미지
   정의. `rocker/r-ver:4` 베이스를 사용하는데, 이 베이스 이미지는 amd64에서 기본 CRAN
   미러로 Posit Package Manager(RSPM)를 이미 설정해두므로 `install.packages()`가
   자동으로 컴파일된 바이너리를 받아옵니다(analyze.yml이 지금 쓰는 방식과 동일한 원리).
   빌드 마지막 단계에서 모든 패키지가 실제로 `library()`되는지 검증하는 스텝을 넣어서,
   설치가 조용히 실패하는 경우 이미지 빌드 자체가 실패하도록 했습니다.

2. **`.github/workflows/build-r-image.yml`** — 위 Dockerfile을 빌드해서
   `ghcr.io/{저장소소유자}/fifa-r-env:latest`로 게시하는 워크플로. **수동 실행 전용**
   (`workflow_dispatch`)이라 아무것도 자동으로 트리거되지 않습니다.

3. **`.github/workflows/analyze-fast.yml`** — `analyze.yml`과 구조는 동일하지만
   `static-ergm`/`temporal-tergm` job에서 "Setup R"과 "Install and cache R
   dependencies" 두 스텝이 통째로 빠져 있습니다. 대신 job이 `container:
   ghcr.io/.../fifa-r-env:latest` 위에서 실행되어, R과 패키지가 이미 다 준비된 상태로
   시작합니다.

## 검증 없이는 절대 자동 적용되지 않습니다

- `analyze-fast.yml`이 저장소에 있어도, Cloudflare Worker의 `GITHUB_WORKFLOW_FILE`
  값이 여전히 `analyze.yml`을 가리키는 한 이 파일은 트리거되지 않습니다.
- `build-r-image.yml`도 수동 실행 전에는 아무 일도 하지 않습니다.

## 적용 순서 (반드시 이 순서로)

**1단계 — 이미지 빌드**
GitHub 저장소 → Actions 탭 → "Build R environment image" → **Run workflow** 클릭.
5~15분 정도 걸릴 수 있습니다(패키지 컴파일이 아니라 바이너리 다운로드라 비교적 빠를
것으로 예상하지만, ergm/tergm 계열 일부 패키지는 RSPM에 바이너리가 없을 수도 있어
실제로는 더 걸리거나 실패할 수도 있습니다 — 이 부분이 제가 검증 못 한 지점입니다).
**빌드가 성공했는지 로그를 꼭 확인하세요.**

**2단계 — 패키지 공개 설정 확인 (필요시)**
저장소 → Settings → Packages → `fifa-r-env` → Package settings에서 가시성을 확인하십시오.
같은 저장소의 워크플로가 `secrets.GITHUB_TOKEN`으로 pull하도록 만들어뒀지만, 조직 정책에
따라 권한을 조정해야 할 수 있습니다.

**3단계 — 딱 한 번, 소규모로 테스트**
Worker 환경변수 `GITHUB_WORKFLOW_FILE`을 **임시로** `analyze-fast.yml`로 바꾸고 재배포한
뒤, [ERGM] 탭에서 "정적 ERGM만(빠름)"으로 가장 간단한 baseline(`edges`만) 모형을 하나
실행해보십시오. v21에서 만든 단계별 진행률 화면에서 "Setup R"/"패키지 설치" 단계가 아예
안 뜨고 바로 "ERGM 적합"으로 넘어가는지 확인하시면 됩니다.

**4단계 — 정상 확인되면 "both" 모드까지 테스트**
정적 모형이 잘 되면 "정적+시간적 모형 모두"로도 한 번 더 확인하십시오.

**5단계 — 문제 없으면 계속 사용, 문제 있으면 즉시 되돌리기**
`GITHUB_WORKFLOW_FILE`을 다시 `analyze.yml`로 바꾸면 즉시 기존 방식으로 복귀합니다.
기존 `analyze.yml`은 전혀 수정되지 않았으므로 언제든 안전하게 되돌릴 수 있습니다.

## 성공하면 얻는 것

"Setup R"(수십 초)과 "R 패키지 설치"(캐시 미스 시 수 분, 캐시 적중 시에도 수십 초) 두
단계가 **완전히 사라지고**, checkout 직후 바로 R 스크립트가 실행됩니다. 지금까지 화면에서
가장 오래 걸리는 단계로 보였던 부분이 이걸로 없어질 가능성이 큽니다.

## 실패하면 (자주 있을 수 있는 원인들)

- **바이너리 없는 패키지가 있어 이미지 빌드 자체가 실패** — `btergm`, `tsna`처럼 상대적으로
  덜 쓰이는 패키지는 RSPM에 최신 바이너리가 없을 수 있습니다. 이 경우 빌드 로그에서 실패한
  패키지를 확인하고, `Dockerfile.r-env`에 해당 패키지의 시스템 의존 라이브러리를
  `apt-get install`로 추가해야 할 수 있습니다.
- **GHCR pull 권한 문제** — `analyze-fast.yml`의 job이 이미지를 못 받아오면 즉시 실패
  로그에 명확히 나타납니다. 2단계의 패키지 가시성 설정을 확인하십시오.
- **RSPM 바이너리와 GitHub Actions 러너의 OS 버전 불일치** — 둘 다 Ubuntu 계열이라 보통
  문제없지만, 만약 어긋나면 소스 컴파일로 자동 전환되어 오히려 더 느려질 수 있습니다.

이 부분은 제가 실제로 실행해보고 만든 게 아니라 **문서화된 표준 패턴을 최대한 정확히
따라 작성한 것**이라는 점을 다시 한번 분명히 말씀드립니다. 1~2단계를 진행해보시고 결과
(성공/실패 로그)를 공유해주시면, 실패한 부분을 정확히 진단해서 고쳐드리겠습니다.
