-- Run this in Supabase SQL editor (or psql) before deploying user_id-aware routers.
ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE wishlist ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);

-- Note: existing rows have user_id=NULL. They will appear "global" / orphaned.
-- Decide whether to: (a) hard-delete, (b) assign to your user_id, (c) leave nullable forever.
--
-- Example (c): assign all existing rows to a specific Supabase user
-- UPDATE portfolio SET user_id = '<your-supabase-uuid>' WHERE user_id IS NULL;
-- UPDATE wishlist  SET user_id = '<your-supabase-uuid>' WHERE user_id IS NULL;
-- UPDATE alerts    SET user_id = '<your-supabase-uuid>' WHERE user_id IS NULL;
