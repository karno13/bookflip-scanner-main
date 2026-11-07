-- Preliminary wholesale buyback quotes (skupksiazek.pl) per ISBN: the floor price a book can always be
-- sold for. One row per source + ISBN, refreshed on demand or by the slow background check.
-- status: priced (price_pln set) | manual (the buyer prices it by hand) | not_bought | error.
CREATE TABLE buyback_quotes (
  source TEXT NOT NULL CHECK (source IN ('skupksiazek')),
  isbn13 TEXT NOT NULL CHECK (length(isbn13) = 13),
  status TEXT NOT NULL CHECK (status IN ('priced','manual','not_bought','error')),
  price_pln REAL CHECK (price_pln IS NULL OR price_pln >= 0),
  title TEXT,
  message TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (source, isbn13)
) STRICT;
