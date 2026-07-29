args <- commandArgs(trailingOnly = TRUE)
run_id <- if (length(args)) args[[1]] else stop("run_id is required")
base_url <- Sys.getenv("API_BASE_URL")
token <- Sys.getenv("ANALYSIS_API_TOKEN")
dir.create("artifacts", showWarnings = FALSE, recursive = TRUE)
set.seed(20260728)

library(jsonlite)
library(httr2)
library(network)
library(ergm)

api_get <- function(path) {
  request(paste0(sub("/$", "", base_url), path)) |>
    req_headers(Authorization = paste("Bearer", token)) |>
    req_retry(max_tries = 3) |>
    req_perform() |>
    resp_body_json(simplifyVector = FALSE)
}
api_post <- function(path, body) {
  request(paste0(sub("/$", "", base_url), path)) |>
    req_headers(Authorization = paste("Bearer", token)) |>
    req_body_json(body, auto_unbox = TRUE) |>
    req_retry(max_tries = 3) |>
    req_perform()
}

failure_callback <- function(message, diagnostics = list()) {
  payload <- list(run_id = as.integer(run_id), status = "failed", converged = FALSE,
                  result = list(error = message), diagnostics = diagnostics)
  try(api_post("/api/model-results", payload), silent = TRUE)
  write_json(payload, "artifacts/model-result.json", pretty = TRUE, auto_unbox = TRUE)
}

tryCatch({
  dat <- api_get(paste0("/api/model-input?run_id=", URLencode(run_id)))
  teams <- as.data.frame(dat$teams, stringsAsFactors = FALSE)
  matches <- as.data.frame(dat$matches, stringsAsFactors = FALSE)
  rankings <- as.data.frame(dat$rankings, stringsAsFactors = FALSE)
  run <- dat$run
  if (nrow(teams) < 2 || nrow(matches) < 1) stop("분석 가능한 국가 또는 경기 데이터가 부족합니다.")

  vids <- as.character(teams$id)
  directed <- identical(run$network_type, "win")
  edges <- list()
  for (i in seq_len(nrow(matches))) {
    h <- as.character(matches$home_team_id[i]); a <- as.character(matches$away_team_id[i])
    if (!h %in% vids || !a %in% vids || h == a) next
    if (directed) {
      hs <- as.numeric(matches$home_score[i]); as_ <- as.numeric(matches$away_score[i])
      if (is.na(hs) || is.na(as_) || hs == as_) next
      edges[[length(edges)+1]] <- if (hs > as_) c(h,a) else c(a,h)
    } else edges[[length(edges)+1]] <- c(h,a)
  }
  if (!length(edges)) stop("선택한 네트워크 유형에서 생성된 엣지가 없습니다.")
  em <- unique(do.call(rbind, edges))
  idx <- setNames(seq_along(vids), vids)
  em_num <- cbind(unname(idx[em[,1]]), unname(idx[em[,2]]))
  net <- network(em_num, vertex.attr = list(vertex.names = vids), directed = directed, loops = FALSE, multiple = FALSE)
  set.vertex.attribute(net, "confederation", teams$confederation[match(network.vertex.names(net), vids)])
  latest_points <- setNames(rep(0, length(vids)), vids)
  if (nrow(rankings)) latest_points[as.character(rankings$team_id)] <- as.numeric(rankings$points)
  latest_points[!is.finite(latest_points)] <- 0
  set.vertex.attribute(net, "ranking_points", unname(latest_points[network.vertex.names(net)]))

  rhs <- sub("^\\s*network\\s*~", "", run$formula)
  if (!directed) rhs <- gsub("(^|\\+)\\s*mutual\\s*(?=\\+|$)", "\\1", rhs, perl=TRUE)
  rhs <- gsub("\\+\\s*\\+", "+", rhs)
  rhs <- gsub("^\\s*\\+|\\+\\s*$", "", rhs)
  if (!nzchar(trimws(rhs))) rhs <- "edges"
  f <- as.formula(paste("net ~", rhs))

  fit <- ergm(f, control = control.ergm(MCMLE.maxit = 20, MCMC.burnin = 10000, MCMC.interval = 1000, seed = 20260728))
  sm <- summary(fit)
  raw_coef <- as.data.frame(sm$coefficients, check.names = FALSE)
  coef_mat <- data.frame(
    term = rownames(raw_coef),
    estimate = as.numeric(raw_coef[[1]]),
    std_error = as.numeric(raw_coef[[2]]),
    mcmc_percent = if (ncol(raw_coef) >= 3) as.numeric(raw_coef[[3]]) else NA_real_,
    z_value = if (ncol(raw_coef) >= 4) as.numeric(raw_coef[[4]]) else NA_real_,
    p_value = if (ncol(raw_coef) >= 5) as.numeric(raw_coef[[5]]) else NA_real_,
    stringsAsFactors = FALSE
  )
  coef_mat$odds_ratio <- exp(coef_mat$estimate)
  write.csv(coef_mat, "artifacts/coefficients.csv", row.names = FALSE)

  png("artifacts/mcmc-diagnostics.png", width=1400, height=900, res=150)
  mcmc.diagnostics(fit)
  dev.off()
  gof_obj <- gof(fit)
  png("artifacts/gof.png", width=1400, height=900, res=150)
  plot(gof_obj)
  dev.off()

  converged <- all(is.finite(coef_mat$estimate))
  result <- list(
    run_id = as.integer(run_id), status = "completed", converged = converged,
    formula = paste(deparse(f), collapse=""), network_type = run$network_type,
    node_count = network.size(net), edge_count = network.edgecount(net),
    aic = AIC(fit), bic = BIC(fit), coefficients = unname(split(coef_mat, seq_len(nrow(coef_mat))))
  )
  diagnostics <- list(seed=20260728, session=capture.output(sessionInfo()), gof=capture.output(print(gof_obj)))
  write_json(list(result=result, diagnostics=diagnostics), "artifacts/model-result.json", pretty=TRUE, auto_unbox=TRUE, null="null")
  writeLines(capture.output(summary(fit)), "artifacts/model-summary.txt")
  api_post("/api/model-results", list(run_id=as.integer(run_id), status="completed", converged=converged,
            aic=unname(AIC(fit)), bic=unname(BIC(fit)), result=result, diagnostics=diagnostics))
}, error = function(e) {
  failure_callback(conditionMessage(e), list(session=capture.output(sessionInfo())))
  stop(e)
})
