# required_packages.R
# ERGM/TERGM 분석에 필요한 R 패키지 전체 목록과, 하나씩 개별적으로 설치·검증하는 스크립트.
# Dockerfile.r-env의 이미지 빌드 단계에서 사용됩니다.
#
# 개별 설치 + 개별 로드 검증 방식을 쓰는 이유: install.packages(c(...))처럼 한 번에
# 여러 개를 넘기면, 하나가 실패해도 R이 경고만 띄우고 넘어가는 경우가 많아서 나중에
# library() 단계에서야(그것도 뭉뚱그려서) 실패가 드러납니다. 여기서는 각 패키지를
# 따로 설치하고 따로 확인해서, 실패한 패키지의 이름과 이유를 정확히 로그에 남깁니다.

pkgs <- c(
  "jsonlite", "httr2", "network", "ergm", "sna", "tergm",
  "networkDynamic", "tsna", "btergm", "coda", "texreg", "igraph"
)

cat("==> 설치 대상 패키지:", paste(pkgs, collapse = ", "), "\n\n")

install_failures <- character(0)
for (p in pkgs) {
  cat(sprintf("--- installing %s ---\n", p))
  ok <- tryCatch({
    install.packages(p, dependencies = TRUE, Ncpus = max(1, parallel::detectCores()))
    TRUE
  }, error = function(e) {
    cat(sprintf("!! install error for %s: %s\n", p, conditionMessage(e)))
    FALSE
  }, warning = function(w) {
    # install.packages는 실패해도 종종 warning만 내고 넘어가므로, 실제 설치 여부는
    # 아래에서 installed.packages()로 다시 확인합니다. 여기서는 로그만 남깁니다.
    cat(sprintf("!! install warning for %s: %s\n", p, conditionMessage(w)))
    TRUE
  })
  if (!(p %in% rownames(installed.packages()))) {
    install_failures <- c(install_failures, p)
  }
}

cat("\n==> 설치 후 library() 로드 검증\n")
load_failures <- character(0)
for (p in pkgs) {
  ok <- tryCatch({
    suppressPackageStartupMessages(library(p, character.only = TRUE))
    TRUE
  }, error = function(e) {
    cat(sprintf("!! library() failed for %s: %s\n", p, conditionMessage(e)))
    FALSE
  })
  if (!ok) load_failures <- c(load_failures, p)
}

all_failures <- unique(c(install_failures, load_failures))

if (length(all_failures) > 0) {
  cat("\n============================================\n")
  cat("FAILED PACKAGES:", paste(all_failures, collapse = ", "), "\n")
  cat("============================================\n")
  cat("위 패키지들의 설치/로드가 실패했습니다. 흔한 원인:\n")
  cat("  - CRAN/RSPM에 이 R 버전용 바이너리가 없어 소스 컴파일이 필요한데,\n")
  cat("    관련 시스템 라이브러리(apt 패키지)가 이미지에 빠져 있음\n")
  cat("  - 일시적인 네트워크/미러 오류(재시도하면 해결될 수 있음)\n")
  quit(status = 1)
} else {
  cat("\nOK: 모든 패키지 설치 및 로드 성공 (", length(pkgs), "개)\n")
}
