-- npx wrangler d1 execute smartexpense-db --remote --file=./migration-005.sql
ALTER TABLE users ADD COLUMN institution_name TEXT;
ALTER TABLE users ADD COLUMN requester_name TEXT;
