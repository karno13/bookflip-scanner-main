# BookFlip 2.0 - frontend workspace report

## Audit

The previous frontend was a single-page vanilla HTML/CSS/JS interface. Scanner results, catalog, history and manual linking shared one long document and visibility was controlled by individual `hidden` flags. The local server already exposed streaming scan progress, JSON history, manual catalog creation/linking and SQLite health counters. It did not expose the SQLite catalog rows, identification queue evidence or per-offer price history.

## Component structure

- `AppShell`: fixed sidebar, compact top bar and scroll-contained workspace.
- `ScannerWorkspace`: query form, real adapter selection, progress, scan metrics and source task table.
- `ReviewWorkspace`: filtered master-detail review list using real JSON offers and the existing manual-link endpoint.
- `CatalogWorkspace`: compact catalog list, record detail and manual add dialog.
- `OffersWorkspace`: searchable, filterable and paginated offer table with a detail drawer.
- `SettingsWorkspace`: active source inventory, SQLite status, metadata configuration summary and safe local diagnostics.
- `AppState`: one module-owned state object keeps a running scan alive while views change.

## Existing APIs used

- `GET /api/sources`
- `GET /api/history`
- `GET /api/book?id=...`
- `GET /api/catalog/status`
- `POST /api/catalog`
- `POST /api/catalog/link`
- `POST /api/search?stream=1`

## Minimal API extensions still required

These are intentionally not simulated in the UI.

1. `GET /api/catalog/works?query=&author=&isbn=&language=&publisher=&status=&page=` returning work rows, edition counts and pagination from SQLite.
2. `GET /api/catalog/works/:id` returning work fields, editions, identifiers, external record links and provenance.
3. `GET /api/catalog/editions/:id` returning edition metadata, evidence, external records, offers and price history.
4. `GET /api/identification-jobs?status=&isbnStatus=&problem=&source=&sort=&page=` returning review rows plus evidence and resolver reasons.
5. `POST /api/identification-jobs/:id/decision` with an explicit action (`approve`, `reject`, `not_book`, `restore`) and optional `editionId`.
6. `POST /api/catalog/lookup-preview` accepting `{isbn}` and returning local, BN and Open Library candidates without writing.
7. `GET /api/offers/:id` returning one offer, price history, current match history and metadata evidence.

Manual catalog creation and manual offer-to-book linking remain active because the current backend already supports them. Actions requiring the contracts above are disabled and explained in the interface.

## Verification

- Five-view navigation passed in a real headless Edge session.
- Scanner is the default view.
- Query state remained unchanged after visiting all five views.
- Seven real source adapters loaded from `/api/sources`.
- No live scan was started.
- Screenshots were captured at 1366x768 for all views and at 1920x1080 for the scanner.
