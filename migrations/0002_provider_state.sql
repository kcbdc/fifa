CREATE TABLE IF NOT EXISTS collection_state(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_started ON collection_jobs(started_at);
