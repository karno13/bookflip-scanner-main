-- Automatic buyback checks (on by default): the server quotes new and stale catalogue ISBNs in the
-- background at the slow skupksiazek.pl pace. Single-row settings table.
CREATE TABLE buyback_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auto INTEGER NOT NULL CHECK (auto IN (0,1)),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO buyback_settings (id, auto, updated_at) VALUES (1, 1, '2026-11-07T00:00:00.000Z');
