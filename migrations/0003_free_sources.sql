CREATE TABLE IF NOT EXISTS team_aliases(
  alias TEXT PRIMARY KEY,
  team_id INTEGER NOT NULL,
  source TEXT DEFAULT 'manual',
  FOREIGN KEY(team_id) REFERENCES teams(id)
);
CREATE TABLE IF NOT EXISTS source_snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
  status INTEGER NOT NULL,
  row_count INTEGER DEFAULT 0,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_alias_team ON team_aliases(team_id);
