CREATE TABLE IF NOT EXISTS remote_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  display_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  ack_revision INTEGER NOT NULL DEFAULT 0,
  ack_at TEXT
);

INSERT OR IGNORE INTO remote_state (id) VALUES (1);
