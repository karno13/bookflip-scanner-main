-- Operator's choice of universe for a work in the catalogue series view ("Logik der Forschung" is not
-- Warcraft just because a Warcraft scan found it). 'Poza seriami' takes the work out of every universe.
-- Display only; never identification evidence.
CREATE TABLE work_universe_overrides (
  work_id TEXT PRIMARY KEY REFERENCES works(id) ON UPDATE CASCADE ON DELETE CASCADE,
  universe TEXT NOT NULL CHECK (length(trim(universe)) BETWEEN 1 AND 80),
  updated_at TEXT NOT NULL
) STRICT;
