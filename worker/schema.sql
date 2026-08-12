-- מערכת ניהול קבלות למוסד - סכמת בסיס נתונים (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  tax_id TEXT,                -- ח.פ / עוסק מורשה
  phone TEXT,
  bank_account TEXT,
  bank_code TEXT,
  branch_number TEXT,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_key TEXT NOT NULL,       -- '2026-08' - החודש שבו בוצע הייצוא
  export_date TEXT NOT NULL DEFAULT (datetime('now')),
  total_amount REAL,
  doc_link TEXT,
  xlsx_generated INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drive_file_id TEXT,
  drive_file_link TEXT,
  supplier_id INTEGER REFERENCES suppliers(id),
  amount REAL,
  tax_id TEXT,
  receipt_date TEXT,
  status TEXT NOT NULL DEFAULT 'unverified',
      -- unverified | unpaid | paid
  source TEXT,                  -- email | mobile_camera | mobile_gallery | web_upload
  paid_cycle_id INTEGER REFERENCES payment_cycles(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipts_supplier ON receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(receipt_date);

