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
library(tergm)
`%||%` <- function(x, y) if (is.null(x)) y else x

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
records_to_df <- function(x) {
  if (is.null(x) || length(x) == 0L) return(data.frame())
  if (is.data.frame(x)) return(x)
  rows <- lapply(x, function(row) {
    if (is.null(row)) return(list())
    if (!is.list(row)) return(list(value = row))
    lapply(row, function(value) {
      if (is.null(value) || length(value) == 0L) return(NA)
      if (length(value) == 1L && !is.list(value)) return(value)
      toJSON(value, auto_unbox = TRUE, null = "null")
    })
  })
  fields <- unique(unlist(lapply(rows, names), use.names = FALSE))
  if (!length(fields)) return(data.frame())
  normalized <- lapply(rows, function(row) {
    out <- setNames(vector("list", length(fields)), fields)
    for (field in fields) out[[field]] <- if (field %in% names(row)) row[[field]] else NA
    as.data.frame(out, stringsAsFactors = FALSE, check.names = FALSE)
  })
  result <- do.call(rbind, normalized)
  rownames(result) <- NULL
  result
}
safe_numeric <- function(x) suppressWarnings(as.numeric(as.character(x)))
post_failure <- function(message, diagnostics = list()) {
  payload <- list(run_id = as.integer(run_id), status = "failed", converged = FALSE,
                  result = list(error = message), diagnostics = diagnostics)
  try(api_post("/api/temporal-results", payload), silent = TRUE)
  write_json(payload, "artifacts/temporal-result.json", pretty = TRUE, auto_unbox = TRUE, null = "null")
  writeLines(c("TERGM ANALYSIS FAILED", paste0("Run ID: ", run_id), paste0("Reason: ", message)),
             "artifacts/temporal-summary.txt")
}

tryCatch({
  dat <- api_get(paste0("/api/model-input?run_id=", URLencode(run_id)))
  teams <- records_to_df(dat$teams)
  matches <- records_to_df(dat$matches)
  run_df <- records_to_df(dat$run)
  if (!nrow(run_df)) stop("Model run metadata is missing")
  run <- as.list(run_df[1, , drop = FALSE])
  required <- c("match_date", "home_team_id", "away_team_id", "home_score", "away_score")
  missing <- setdiff(required, names(matches))
  if (length(missing)) stop(paste("Missing match columns:", paste(missing, collapse = ", ")))
  if (!all(c("id", "confederation") %in% names(teams))) stop("Team id/confederation columns are missing")

  match_year <- suppressWarnings(as.integer(substr(as.character(matches$match_date), 1, 4)))
  years <- sort(unique(match_year[is.finite(match_year)]))
  if (length(years) < 3L) stop(sprintf("TERGM requires at least 3 annual panels; found %d", length(years)))

  vids <- as.character(teams$id)
  directed <- identical(as.character(run$network_type), "win")
  conf <- as.character(teams$confederation)
  conf[is.na(conf) | !nzchar(conf)] <- "UNK"
  nets <- list()
  panel_stats <- list()

  for (yr in years) {
    subset_rows <- matches[match_year == yr, , drop = FALSE]
    edges <- list(); edge_count <- 0L
    for (i in seq_len(nrow(subset_rows))) {
      h <- as.character(subset_rows$home_team_id[i]); a <- as.character(subset_rows$away_team_id[i])
      if (is.na(h) || is.na(a) || !h %in% vids || !a %in% vids || h == a) next
      if (directed) {
        hs <- safe_numeric(subset_rows$home_score[i]); as_ <- safe_numeric(subset_rows$away_score[i])
        if (!is.finite(hs) || !is.finite(as_) || hs == as_) next
        edge_count <- edge_count + 1L
        edges[[edge_count]] <- if (hs > as_) c(h, a) else c(a, h)
      } else {
        edge_count <- edge_count + 1L
        edges[[edge_count]] <- c(h, a)
      }
    }
    net <- network.initialize(length(vids), directed = directed, loops = FALSE)
    network.vertex.names(net) <- vids
    set.vertex.attribute(net, "confederation", conf)
    if (edge_count > 0L) {
      em <- unique(do.call(rbind, edges[seq_len(edge_count)]))
      if (is.null(dim(em))) em <- matrix(em, ncol = 2, byrow = TRUE)
      idx <- setNames(seq_along(vids), vids)
      em_num <- cbind(unname(idx[em[,1]]), unname(idx[em[,2]]))
      em_num <- em_num[complete.cases(em_num), , drop = FALSE]
      if (nrow(em_num)) add.edges(net, tail = em_num[,1], head = em_num[,2])
    }
    nets[[as.character(yr)]] <- net
    panel_stats[[length(panel_stats)+1L]] <- data.frame(
      year = yr, nodes = network.size(net), edges = network.edgecount(net),
      density = network.edgecount(net) / max(1, network.dyadcount(net)), stringsAsFactors = FALSE)
  }

  panel_df <- do.call(rbind, panel_stats)
  write.csv(panel_df, "artifacts/temporal-panels.csv", row.names = FALSE)

  # A list of identically dimensioned networks is accepted by tergm CMLE.
  candidates <- if (directed) list(
    list(name = "formation-persistence-mutual", formula = nets ~ Form(~edges + mutual) + Persist(~edges)),
    list(name = "formation-persistence", formula = nets ~ Form(~edges) + Persist(~edges))
  ) else list(
    list(name = "formation-persistence", formula = nets ~ Form(~edges) + Persist(~edges))
  )

  attempts <- list(); fit <- NULL; selected <- NULL
  for (candidate in candidates) {
    attempt <- tryCatch({
      candidate_fit <- tergm(candidate$formula, estimate = "CMLE",
        control = control.tergm(CMLE.ergm = control.ergm(MCMLE.maxit = 20,
          MCMC.burnin = 10000, MCMC.interval = 1000, seed = 20260728)))
      list(ok = TRUE, fit = candidate_fit)
    }, error = function(err) list(ok = FALSE, error = conditionMessage(err)))
    attempts[[length(attempts)+1L]] <- list(name = candidate$name, ok = attempt$ok,
      error = if (attempt$ok) NULL else attempt$error)
    if (attempt$ok) { fit <- attempt$fit; selected <- candidate$name; break }
  }
  if (is.null(fit)) stop(paste("All TERGM candidates failed:",
    paste(vapply(attempts, function(x) paste0(x$name, ": ", x$error), character(1)), collapse = " | ")))

  sm <- coef(summary(fit))
  if (is.null(dim(sm))) sm <- matrix(sm, nrow = 1)
  cn <- colnames(sm)
  pick <- function(pattern, fallback = NA_integer_) { x <- grep(pattern, cn, ignore.case=TRUE); if(length(x)) x[[1]] else fallback }
  val <- function(i) if(is.na(i)) rep(NA_real_,nrow(sm)) else safe_numeric(sm[,i])
  coef_df <- data.frame(term=rownames(sm), estimate=val(pick("estimate",1L)),
    std_error=val(pick("std.*error|standard.*error",if(ncol(sm)>=2)2L else NA_integer_)),
    z_value=val(pick("z.*value",if(ncol(sm)>=3)3L else NA_integer_)),
    p_value=val(pick("pr\\(|p.*value",if(ncol(sm)>=4)ncol(sm) else NA_integer_)),
    stringsAsFactors=FALSE)
  coef_df$odds_ratio <- exp(coef_df$estimate)
  write.csv(coef_df, "artifacts/temporal-coefficients.csv", row.names = FALSE)

  gof_text <- NULL
  try({
    gof_obj <- gof(fit)
    gof_text <- capture.output(print(gof_obj))
    png("artifacts/temporal-gof.png", width=1400, height=900, res=150)
    plot(gof_obj); dev.off()
  }, silent = TRUE)

  coefficient_rows <- lapply(seq_len(nrow(coef_df)), function(i) as.list(coef_df[i,,drop=FALSE]))
  aic <- tryCatch(unname(AIC(fit)), error=function(e) NA_real_)
  bic <- tryCatch(unname(BIC(fit)), error=function(e) NA_real_)
  result <- list(run_id=as.integer(run_id), status="completed", converged=all(is.finite(coef_df$estimate)),
    model_class="TERGM-CMLE", selected_model=selected, model_attempts=attempts,
    network_type=as.character(run$network_type), years=years,
    panel_count=length(nets), node_count=length(vids), panel_statistics=lapply(seq_len(nrow(panel_df)),function(i)as.list(panel_df[i,,drop=FALSE])),
    aic=aic, bic=bic, coefficients=coefficient_rows)
  diagnostics <- list(seed=20260728, session=capture.output(sessionInfo()), gof=gof_text, attempts=attempts)
  payload <- list(run_id=as.integer(run_id), status="completed", converged=result$converged,
                  aic=aic, bic=bic, result=result, diagnostics=diagnostics)
  write_json(payload, "artifacts/temporal-result.json", pretty=TRUE, auto_unbox=TRUE, null="null")
  writeLines(c(sprintf("TERGM panels: %s", paste(years, collapse=", ")),
               sprintf("Selected model: %s", selected), capture.output(summary(fit))),
             "artifacts/temporal-summary.txt")
  api_post("/api/temporal-results", payload)
}, error=function(e){
  post_failure(conditionMessage(e), list(session=capture.output(sessionInfo())))
  stop(e)
})
