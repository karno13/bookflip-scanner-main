CREATE TABLE scan_profiles (
 name TEXT PRIMARY KEY CHECK(length(trim(name)) BETWEEN 1 AND 60),
 queries_json TEXT NOT NULL CHECK(json_valid(queries_json)),
 sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
 updated_at TEXT NOT NULL
) STRICT;
