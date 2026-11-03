CREATE TABLE offer_workspace (
 offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
 watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0,1)),
 purchase_status TEXT NOT NULL DEFAULT 'watching' CHECK (purchase_status IN ('watching','check','negotiating','bought','rejected')),
 target_price REAL CHECK (target_price IS NULL OR (target_price >= 0 AND target_price <= 100000000)),
 note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
 updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_offer_workspace_watched ON offer_workspace(watched,purchase_status);
