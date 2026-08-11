-- מערכת ניהול קבלות למוסד - סכמת בסיס נתונים (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tax_id TEXT,                -- ח.פ / עוסק מורשה
  bank_account TEXT,
  bank_code TEXT,
  branch_number TEXT,
  email TEXT,
  default_category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drive_file_id TEXT,           -- מזהה קובץ בדרייב (אחרי אישור)
  drive_file_link TEXT,
  extracted_tax_id TEXT,
  extracted_supplier_name TEXT,
  extracted_amount REAL,
  extracted_vat REAL,
  extracted_date TEXT,
  status TEXT NOT NULL DEFAULT 'unverified',
      -- unverified | verified_unmatched | matched | ignored
  source TEXT,                  -- email | mobile_camera | mobile_gallery | web_upload
  month_key TEXT,                -- לדוגמה '2026-01'
  raw_file_ref TEXT,             -- הפניה זמנית לקובץ עד לאישור (לפני שהוא עובר לדרייב)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_date TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  amount REAL NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'no_receipt',
      -- no_receipt | pending_match | completed
  receipt_id INTEGER REFERENCES receipts(id),
  submission_status TEXT NOT NULL DEFAULT 'open',
      -- open | submitted
  cycle_id INTEGER REFERENCES submission_cycles(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS submission_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_key TEXT NOT NULL,       -- '2026-01'
  generated_date TEXT NOT NULL DEFAULT (datetime('now')),
  total_amount REAL,
  doc_link TEXT,                 -- קישור לדוח Google Doc שהופק
  status TEXT NOT NULL DEFAULT 'open' -- open | closed
);

CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_receipts_month ON receipts(month_key);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
