# Printful v2 fixtures

Recorded-shape responses replayed by the adapter contract tests (seam 2). Shapes follow the Printful API v2 (Open Beta) docs; the maintainer fixture-refresh script (ticket #25) re-records them from the live API. File name = URL path with `/` → `_`, minus the `/v2/` prefix; `*.error.json` files carry the HTTP status in `status`.
