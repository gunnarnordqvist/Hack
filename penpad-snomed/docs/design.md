# Design (one page)

**Purpose.** Show that terminology can decide the options in a structured-input flow: the user types free text or clicks a body map, the app proposes SNOMED CT findings, asks only for slots the finding allows (e.g. side only if lateralizable) and emits the same selection as a sentence, a SNOMED expression, an openEHR COMPOSITION and a FHIR Condition.

**Parts.**
- `web/` — plain ES modules. `extract.js` (slot extraction), `lexrank.js` (token-overlap ordering), `generators.js` (outputs), `bodymap.js` + `vendor/bodypaths.js` (map), `txclient.js` (browser→FHIR server), `guard.js` (personal-data check), `app.js` (UI, data-source abstraction).
- `backend/` — optional local server with BioLORD embedding re-rank, snapshot builder, topic verification.
- `tools/` — site build, publish, scans and checks.
- `.github/workflows/pages.yml` — test → build → gh-pages + Pages deploy.

**Data flow (public site).** Browser → `tx-nordics.fhir.org` (`$expand` with ECL, `$lookup`, `$validate-code`). No own server, no stored SNOMED content. Typed search words are sent to that third-party server, except text the guard classifies as personal data.

**Modes.** snapshot (local file, gitignored), client (public), live backend (local, model re-rank).

**Decisions:** ADR-001 terminology decides, model suggests · ADR-002 client mode, no content in repo · ADR-003 MIT body figure with unverified origin · ADR-004 pipeline on main, gh-pages, pinned actions.

**Known limits.** Guard is a heuristic (misses names, free-text identifiers). Terminology server availability is outside our control. Eval set is 14 phrases written by the assistant. Dental charting is not implemented.
