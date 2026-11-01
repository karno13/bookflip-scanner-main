-- One marketplace offer may represent a manually curated bundle of editions.
CREATE TABLE offer_sets (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE offer_set_editions (
  offer_id TEXT NOT NULL REFERENCES offer_sets(offer_id) ON UPDATE CASCADE ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (offer_id, edition_id)
) STRICT;

CREATE INDEX idx_offer_set_editions_edition ON offer_set_editions(edition_id);
