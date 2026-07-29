CREATE TABLE IF NOT EXISTS research_projects(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_name TEXT NOT NULL,
 research_question TEXT DEFAULT '',
 network_type TEXT DEFAULT 'win',
 analysis_start TEXT,
 analysis_end TEXT,
 status TEXT DEFAULT 'active',
 notes TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dataset_snapshots(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id INTEGER,
 snapshot_name TEXT NOT NULL,
 app_version TEXT NOT NULL,
 data_start TEXT,
 data_end TEXT,
 team_count INTEGER DEFAULT 0,
 match_count INTEGER DEFAULT 0,
 ranking_count INTEGER DEFAULT 0,
 source_json TEXT,
 checksum_sha256 TEXT NOT NULL,
 status TEXT DEFAULT 'frozen',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(project_id) REFERENCES research_projects(id)
);
ALTER TABLE model_runs ADD COLUMN created_at TEXT;
UPDATE model_runs SET created_at=COALESCE(started_at,CURRENT_TIMESTAMP) WHERE created_at IS NULL;
ALTER TABLE model_runs ADD COLUMN project_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_snapshots_project ON dataset_snapshots(project_id,created_at);
CREATE INDEX IF NOT EXISTS idx_model_runs_project ON model_runs(project_id,created_at);
