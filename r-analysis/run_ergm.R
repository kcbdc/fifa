args <- commandArgs(trailingOnly=TRUE)
dir.create('artifacts', showWarnings=FALSE)
packages <- c('jsonlite')
for (p in packages) if (!requireNamespace(p, quietly=TRUE)) install.packages(p, repos='https://cloud.r-project.org')
# Production path: fetch frozen nodes/edges, construct network::network, estimate ergm::ergm,
# save coefficients, MCMC diagnostics, GOF plots and sessionInfo. This scaffold remains runnable
# even before private API credentials are configured.
result <- list(status='scaffold-complete', run_id=ifelse(length(args),args[1],'manual'), seed=20260728,
               note='Configure API_EXPORT_URL and install network/ergm to execute a real model.',
               session=capture.output(sessionInfo()))
jsonlite::write_json(result,'artifacts/model-result.json',pretty=TRUE,auto_unbox=TRUE)
