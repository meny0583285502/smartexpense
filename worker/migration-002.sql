-- npx wrangler d1 execute smartexpense-db --remote --file=./migration-002.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  drive_folder_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
