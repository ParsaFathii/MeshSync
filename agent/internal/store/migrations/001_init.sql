-- MeshSync agent schema, migration 1.
-- All timestamps are unix seconds (UTC).

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS peers (
  peer_id   TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  address   TEXT NOT NULL,
  pubkey    TEXT NOT NULL,
  trust     TEXT NOT NULL DEFAULT 'DISCOVERED',
  version   TEXT,
  platform  TEXT,
  last_seen INTEGER,
  added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  path       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  folder_id        INTEGER NOT NULL,
  rel_path         TEXT NOT NULL,
  size             INTEGER NOT NULL DEFAULT 0,
  mtime            INTEGER NOT NULL DEFAULT 0,
  hash             TEXT NOT NULL DEFAULT '',
  last_synced_hash TEXT NOT NULL DEFAULT '',
  deleted          INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (folder_id, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(folder_id, deleted);

CREATE TABLE IF NOT EXISTS transfers (
  id           TEXT PRIMARY KEY,
  peer_id      TEXT NOT NULL,
  folder_id    INTEGER NOT NULL,
  rel_path     TEXT NOT NULL,
  dest_path    TEXT NOT NULL DEFAULT '',
  direction    TEXT NOT NULL,
  size         INTEGER NOT NULL DEFAULT 0,
  file_hash    TEXT NOT NULL DEFAULT '',
  file_mtime   INTEGER NOT NULL DEFAULT 0,
  transferred  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'QUEUED',
  chunk_size   INTEGER NOT NULL DEFAULT 0,
  chunks_total INTEGER NOT NULL DEFAULT 0,
  chunks_done  TEXT NOT NULL DEFAULT '',
  error        TEXT,
  session_id   TEXT,
  started_at   INTEGER,
  completed_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);

CREATE TABLE IF NOT EXISTS conflicts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id      INTEGER NOT NULL,
  rel_path       TEXT NOT NULL,
  local_hash     TEXT,
  remote_hash    TEXT,
  local_size     INTEGER,
  remote_size    INTEGER,
  local_mtime    INTEGER,
  remote_mtime   INTEGER,
  remote_peer_id TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'OPEN',
  resolution     TEXT,
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  type     TEXT NOT NULL,
  severity TEXT NOT NULL,
  message  TEXT NOT NULL,
  data     TEXT,
  ts       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  peer_id           TEXT,
  folder_id         INTEGER,
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER,
  status            TEXT NOT NULL DEFAULT 'RUNNING',
  transferred       INTEGER NOT NULL DEFAULT 0,
  files_transferred INTEGER NOT NULL DEFAULT 0,
  error             TEXT
);

CREATE TABLE IF NOT EXISTS remote_manifests (
  peer_id     TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  rel_path    TEXT NOT NULL,
  hash        TEXT NOT NULL DEFAULT '',
  size        INTEGER NOT NULL DEFAULT 0,
  mtime       INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0,
  seen_at     INTEGER NOT NULL,
  PRIMARY KEY (peer_id, folder_name, rel_path)
);
