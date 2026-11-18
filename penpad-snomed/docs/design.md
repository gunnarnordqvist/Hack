# Design (one page)

**Purpose.** Show that terminology can decide the options in a structured-input flow: the user types free text or clicks a body map, the app proposes SNOMED CT findings, asks only for slots the finding allows (e.g. side only if lateralizable) and emits the same selection as a sentence, a SNOMED expression, an openEHR COMPOSITION and a FHIR Condition.

**Parts.**
- `web/` — plain ES modules. `extract.js` (slot extraction), `multi.js` (several findings in one sentence: clauses, body words, aliases), `lexrank.js` (token-overlap ordering, symptom words), `generators.js` (outputs for one finding or a list), `bodymap.js` + `vendor/bodypaths.js` + `headsection.js` + `zoomboxes.js` (map and close-ups), `txclient.js` (browser→FHIR server), `guard.js` (personal-data check), `listio.js` (save/open the list), `i18n.js` (texts), `app.js` (UI, data-source abstraction, list, body-part check).
- `backend/` — optional local server with BioLORD embedding re-rank, snapshot builder, topic verification.
- `tools/` — site build, publish, scans and checks.
- `.github/workflows/pages.yml` — test → build → gh-pages + Pages deploy.

**Data flow (public site).** Browser → `tx-nordics.fhir.org` (`$expand` with ECL, `$lookup`, `$validate-code`). No own server, no stored SNOMED content. Typed search words are sent to that third-party server, except text the guard classifies as personal data.

**Body-part check.** A finding offered for a body part named in the text must have its finding site inside that body part: the server is asked with an ECL constraint on the finding site (`(topic ECL) : 363698007 = (<< region codes)`), not guessed from the first site shown.

**Modes.** snapshot (local file, gitignored), client (public), live backend (local, model re-rank).

**Decisions:** ADR-001 terminology decides, model suggests · ADR-002 client mode, no content in repo · ADR-003 MIT body figure with unverified origin · ADR-004 pipeline on main, gh-pages, pinned actions.

**Known limits.** The local snapshot has no synonyms. Body-word lists (`bodymap.words`, `compounds`, `aliases`) and symptom words are our own and unreviewed. Guard is a heuristic (it blocks two capitalised words as a name and street names with a number, but not a name typed in lower case or a free-text identifier). Terminology server availability is outside our control. Eval set is 14 phrases written by the assistant. Dental charting is not implemented.
