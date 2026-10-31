# Changelog

BookFlip uses small pull requests and GitHub Actions on Ubuntu/Windows to track changes.

## 2026-10-31 — SQLite-first catalogue

- SQLite became the default store for offers, prices, manual catalogue actions and ISBN identification (PR #36).
- Added background identification polling and retry after restart (PR #37).
- Added offline end-to-end scanner and HTTP persistence regressions (PR #38 and #40).
- Prevented overlapping local scans and tightened book-product filtering (PR #41).
- Fixed literal catalogue searches, retry handling and migration documentation (PR #41–42).
- Replaced the 10,000-record startup limit with incremental loading (PR #43).
- Added cross-platform syntax checks and editor defaults (PR #44).
- Extended SQLite-backed global searching and bounded large-list DOM rendering (PR #45–46).

**Compatibility:** `BOOKFLIP_STORAGE=json` remains available for old data. Fresh installations use SQLite. No automatic data deletion or import is performed.

**Known limitations:** marketplace parsers still need sanitized, confirmed real-world page fixtures; legacy JSON compatibility code remains until dependency audit; page filters and sorting beyond the server-side text query need complete backend pagination coverage.
