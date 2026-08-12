-- הרצה בטוחה על בסיס נתונים קיים (לא מוחקת כלום) - להריץ עם:
-- npx wrangler d1 execute smartexpense-db --remote --file=./migration-001.sql

ALTER TABLE receipts ADD COLUMN category TEXT;         -- סעיף תקציבי (אוכל / תחזוקה / קופה קטנה וכו')
ALTER TABLE receipts ADD COLUMN extra_amount REAL;     -- סכום נוסף (כמו בטופס - יש שורה עם סכום סופי + סכום נפרד)
ALTER TABLE receipts ADD COLUMN notes TEXT;             -- הערות חופשיות (לדוגמה "אותו ח.פ, חשבון אחר")
ALTER TABLE receipts ADD COLUMN bank_details TEXT;      -- חשבון בנק ספציפי לקבלה הזו (עוקף את חשבון ברירת המחדל של הספק)

ALTER TABLE suppliers ADD COLUMN category TEXT;         -- סעיף תקציבי ברירת מחדל לספק
