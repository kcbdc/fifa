-- v14 temporal model result storage
CREATE TABLE IF NOT EXISTS temporal_model_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_run_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  model_class TEXT DEFAULT 'TERGM-CMLE',
  panel_count INTEGER,
  start_year INTEGER,
  end_year INTEGER,
  aic REAL,
  bic REAL,
  converged INTEGER DEFAULT 0,
  result_json TEXT,
  diagnostics_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  FOREIGN KEY(model_run_id) REFERENCES model_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_temporal_results_status ON temporal_model_results(status);
CREATE INDEX IF NOT EXISTS idx_temporal_results_run ON temporal_model_results(model_run_id);
