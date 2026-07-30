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

# httr2 simplifyVector=FALSE returns a list of row objects. Convert it safely,
# preserving missing fields as NA instead of letting as.data.frame recycle columns.
records_to_df <- function(x) {
  if (is.null(x) || length(x) == 0L) return(data.frame())
  if (is.data.frame(x)) return(x)
  if (!is.list(x)) stop("API records are not a list")
  if (!is.null(names(x)) && all(nzchar(names(x))) && !all(vapply(x, is.list, logical(1)))) x <- list(x)
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
write_validation <- function(validation) {
  write_json(validation, "artifacts/data-validation.json", pretty = TRUE, auto_unbox = TRUE, null = "null")
}
failure_callback <- function(message, diagnostics = list(), validation = list()) {
  payload <- list(run_id = as.integer(run_id), status = "failed", converged = FALSE,
                  result = list(error = message, validation = validation), diagnostics = diagnostics)
  try(api_post("/api/model-results", payload), silent = TRUE)
  write_json(payload, "artifacts/model-result.json", pretty = TRUE, auto_unbox = TRUE, null = "null")
  writeLines(c("ERGM ANALYSIS FAILED", paste0("Run ID: ", run_id), paste0("Reason: ", message)), "artifacts/model-summary.txt")
}

validation <- list()
tryCatch({
  dat <- api_get(paste0("/api/model-input?run_id=", URLencode(run_id)))
  validation <- dat$validation %||% list()
  write_validation(validation)
  if (identical(validation$ok, FALSE)) stop(paste(c("Server preflight failed", unlist(validation$errors)), collapse = ": "))

  teams <- records_to_df(dat$teams)
  matches <- records_to_df(dat$matches)
  rankings <- records_to_df(dat$rankings)
  run_df <- records_to_df(dat$run)
  if (!nrow(run_df)) stop("Model run metadata is missing")
  run <- as.list(run_df[1, , drop = FALSE])

  required_team <- c("id", "confederation")
  required_match <- c("home_team_id", "away_team_id", "home_score", "away_score")
  missing_team <- setdiff(required_team, names(teams))
  missing_match <- setdiff(required_match, names(matches))
  if (length(missing_team)) stop(paste("Missing team columns:", paste(missing_team, collapse = ", ")))
  if (length(missing_match)) stop(paste("Missing match columns:", paste(missing_match, collapse = ", ")))
  if (nrow(teams) < 2L) stop(sprintf("Too few teams: %d", nrow(teams)))
  if (nrow(matches) < 1L) stop("No match records were returned")

  vids <- as.character(teams$id)
  directed <- identical(as.character(run$network_type), "win")
  edges <- vector("list", nrow(matches))
  edge_count <- 0L
  for (i in seq_len(nrow(matches))) {
    h <- as.character(matches$home_team_id[i]); a <- as.character(matches$away_team_id[i])
    if (is.na(h) || is.na(a) || !h %in% vids || !a %in% vids || h == a) next
    if (directed) {
      hs <- safe_numeric(matches$home_score[i]); as_ <- safe_numeric(matches$away_score[i])
      if (!is.finite(hs) || !is.finite(as_) || hs == as_) next
      edge_count <- edge_count + 1L
      edges[[edge_count]] <- if (hs > as_) c(h, a) else c(a, h)
    } else {
      edge_count <- edge_count + 1L
      edges[[edge_count]] <- c(h, a)
    }
  }
  if (!edge_count) stop("No usable edges were generated for the selected network type")
  edges <- edges[seq_len(edge_count)]
  em <- unique(do.call(rbind, edges))
  if (is.null(dim(em))) em <- matrix(em, ncol = 2, byrow = TRUE)
  idx <- setNames(seq_along(vids), vids)
  em_num <- cbind(unname(idx[em[, 1]]), unname(idx[em[, 2]]))
  em_num <- em_num[complete.cases(em_num), , drop = FALSE]
  if (!nrow(em_num)) stop("All generated edges referenced unknown teams")

  net <- network(em_num, vertex.attr = list(vertex.names = vids), directed = directed, loops = FALSE, multiple = FALSE)
  conf <- as.character(teams$confederation[match(network.vertex.names(net), vids)])
  conf[is.na(conf) | !nzchar(conf)] <- "UNK"
  set.vertex.attribute(net, "confederation", conf)
  latest_points <- setNames(rep(0, length(vids)), vids)
  if (nrow(rankings) && all(c("team_id", "points") %in% names(rankings))) {
    rp <- safe_numeric(rankings$points)
    ok <- is.finite(rp) & as.character(rankings$team_id) %in% vids
    latest_points[as.character(rankings$team_id[ok])] <- rp[ok]
  }
  set.vertex.attribute(net, "ranking_points", unname(latest_points[network.vertex.names(net)]))

  rhs <- sub("^\\s*network\\s*~", "", as.character(run$formula))
  if (!directed) rhs <- gsub("(^|\\+)\\s*mutual\\s*(?=\\+|$)", "\\1", rhs, perl = TRUE)
  rhs <- gsub("\\+\\s*\\+", "+", rhs)
  rhs <- gsub("^\\s*\\+|\\+\\s*$", "", rhs)
  if (!nzchar(trimws(rhs))) rhs <- "edges"
  f <- as.formula(paste("net ~", rhs))

  requested_formula <- paste(deparse(f), collapse = "")
  candidate_rhs <- unique(c(
    rhs,
    trimws(gsub("\\+?\\s*gwesp\\([^)]*\\)", "", rhs, perl = TRUE)),
    trimws(gsub("\\+?\\s*mutual", "", gsub("\\+?\\s*gwesp\\([^)]*\\)", "", rhs, perl = TRUE), perl = TRUE)),
    "edges"
  ))
  candidate_rhs <- vapply(candidate_rhs, function(z) {
    z <- gsub("\\+\\s*\\+", "+", z)
    z <- gsub("^\\s*\\+|\\+\\s*$", "", z)
    if (!nzchar(trimws(z))) "edges" else trimws(z)
  }, character(1))
  attempts <- list(); fit <- NULL; effective_formula <- NULL
  for (candidate in candidate_rhs) {
    candidate_f <- as.formula(paste("net ~", candidate))
    attempt <- tryCatch({
      candidate_fit <- ergm(candidate_f, control = control.ergm(MCMLE.maxit = 20,
        MCMC.burnin = 10000, MCMC.interval = 1000, seed = 20260728))
      list(ok = TRUE, fit = candidate_fit)
    }, error = function(err) list(ok = FALSE, error = conditionMessage(err)))
    attempts[[length(attempts)+1L]] <- list(formula = paste(deparse(candidate_f), collapse = ""), ok = attempt$ok,
      error = if (attempt$ok) NULL else attempt$error)
    if (attempt$ok) { fit <- attempt$fit; effective_formula <- candidate_f; break }
    message("ERGM candidate failed: ", candidate, " -> ", attempt$error)
  }
  if (is.null(fit)) stop(paste("All ERGM candidate models failed:", paste(vapply(attempts, function(x) paste0(x$formula, ": ", x$error), character(1)), collapse = " | ")))
  f <- effective_formula
  coef_summary <- coef(summary(fit))
  if (is.null(dim(coef_summary))) coef_summary <- matrix(coef_summary, nrow = 1)
  col_names <- colnames(coef_summary)
  find_col <- function(pattern, fallback = NA_integer_) {
    hit <- grep(pattern, col_names, ignore.case = TRUE)
    if (length(hit)) hit[[1]] else fallback
  }
  estimate_i <- find_col("estimate", 1L)
  se_i <- find_col("std.*error|standard.*error", if (ncol(coef_summary) >= 2) 2L else NA_integer_)
  z_i <- find_col("z.*value|mcmc.*%", if (ncol(coef_summary) >= 3) 3L else NA_integer_)
  p_i <- find_col("pr\\(|p.*value", if (ncol(coef_summary) >= 4) ncol(coef_summary) else NA_integer_)
  val <- function(i) if (is.na(i)) rep(NA_real_, nrow(coef_summary)) else safe_numeric(coef_summary[, i])
  coef_mat <- data.frame(term = rownames(coef_summary), estimate = val(estimate_i),
                         std_error = val(se_i), z_value = val(z_i), p_value = val(p_i),
                         stringsAsFactors = FALSE)
  coef_mat$odds_ratio <- exp(coef_mat$estimate)
  write.csv(coef_mat, "artifacts/coefficients.csv", row.names = FALSE)

  mcmc_diag_ok <- TRUE
  mcmc_diag_note <- NULL
  tryCatch({
    png("artifacts/mcmc-diagnostics.png", width = 1400, height = 900, res = 150)
    mcmc.diagnostics(fit)
    dev.off()
  }, error = function(err) {
    if (!is.null(dev.list())) dev.off()
    mcmc_diag_ok <<- FALSE
    mcmc_diag_note <<- conditionMessage(err)
    message("MCMC diagnostics skipped (likely a dyad-independent MPLE-only fit with no MCMC sample): ", mcmc_diag_note)
  })

  gof_note <- NULL
  gof_obj <- tryCatch({
    g <- gof(fit)
    png("artifacts/gof.png", width = 1400, height = 900, res = 150)
    plot(g)
    dev.off()
    g
  }, error = function(err) {
    if (!is.null(dev.list())) dev.off()
    gof_note <<- conditionMessage(err)
    message("GOF plot skipped: ", gof_note)
    NULL
  })

  converged <- all(is.finite(coef_mat$estimate))
  coefficient_rows <- lapply(seq_len(nrow(coef_mat)), function(i) as.list(coef_mat[i, , drop = FALSE]))
  result <- list(run_id = as.integer(run_id), status = "completed", converged = converged,
                 formula = paste(deparse(f), collapse = ""), requested_formula = requested_formula, fallback_used = !identical(requested_formula, paste(deparse(f), collapse = "")), model_attempts = attempts, network_type = as.character(run$network_type),
                 node_count = network.size(net), edge_count = network.edgecount(net),
                 input_counts = list(teams = nrow(teams), matches = nrow(matches), rankings = nrow(rankings)),
                 aic = unname(AIC(fit)), bic = unname(BIC(fit)), coefficients = coefficient_rows,
                 mcmc_used = mcmc_diag_ok, gof_available = !is.null(gof_obj),
                 validation = validation)
  diagnostics <- list(seed = 20260728, session = capture.output(sessionInfo()),
                      gof = if (!is.null(gof_obj)) capture.output(print(gof_obj)) else list(skipped = TRUE, reason = gof_note),
                      mcmc_diagnostics = if (mcmc_diag_ok) "ok" else list(skipped = TRUE, reason = mcmc_diag_note, note = "dyad-independent formulas (e.g. plain edges) are estimated by MPLE only; no MCMC sample is produced, so diagnostics are not applicable."),
                      coefficient_columns = col_names, model_attempts = attempts)
  write_json(list(result = result, diagnostics = diagnostics), "artifacts/model-result.json",
             pretty = TRUE, auto_unbox = TRUE, null = "null")
  writeLines(c(sprintf("Input: teams=%d matches=%d rankings=%d", nrow(teams), nrow(matches), nrow(rankings)),
               capture.output(summary(fit))), "artifacts/model-summary.txt")
  api_post("/api/model-results", list(run_id = as.integer(run_id), status = "completed",
           converged = converged, aic = unname(AIC(fit)), bic = unname(BIC(fit)),
           result = result, diagnostics = diagnostics))
}, error = function(e) {
  failure_callback(conditionMessage(e), list(session = capture.output(sessionInfo())), validation)
  stop(e)
})
