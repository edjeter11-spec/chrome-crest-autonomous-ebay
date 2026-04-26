-- Per-rule Discord webhook integration for the Sniper.
-- Adds an optional Discord webhook URL to each user_snipe_rules row, plus an
-- enable flag so users can toggle Discord delivery without losing the URL.
ALTER TABLE user_snipe_rules ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;
ALTER TABLE user_snipe_rules ADD COLUMN IF NOT EXISTS discord_enabled BOOLEAN DEFAULT FALSE;
