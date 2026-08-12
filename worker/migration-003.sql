-- npx wrangler d1 execute smartexpense-db --remote --file=./migration-003.sql

ALTER TABLE receipts ADD COLUMN user_id INTEGER REFERENCES users(id);

-- איפוס נתוני הוצאות ישנים (לפי בקשתך) - כל מה שנכנס מעכשיו ישויך למשתמש הנכון
DELETE FROM receipts;
DELETE FROM payment_cycles;
