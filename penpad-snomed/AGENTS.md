# AGENTS.md — read this first

**What this is:** a prototype for the PEN&PAD Nordic Hackathon 2026 bonus track. SNOMED CT (via ECL on a FHIR terminology server) decides which options exist; a model may only reorder suggestions. Outputs: sentence, SNOMED expression, openEHR COMPOSITION, FHIR Condition. Swedish + English, body map. Tier A (demo, made-up examples only). Owner: Gunnar Nordqvist.

## Commands
- JS tests: `node --test tests/*.test.mjs`
- Python tests: `python -m unittest discover -s tests -p "test_*.py"`
- Checks: `python tools/scan_secrets.py`, `python tools/check_dependencies.py`, `python tools/check_spec.py`
- Browser tests: `node tests/e2e.cjs` (needs Playwright and a running page; not run in CI)
- Local app: `python backend/server.py` (127.0.0.1 only); public site build: `python tools/build_site.py _site`

## Where things are
`web/` browser app (no build step) · `backend/` local server, FHIR client, ranking · `tools/` build and checks · `tests/` · `docs/` specification, design, ADRs, runbook, build record, mandate · `.github/workflows/pages.yml` (repo root) pipeline.

## Rules
1. Never put SNOMED CT content, copyrighted material, personal data or secrets in the repository or the public site.
2. Candidates come only from the terminology server; never invent a code.
3. Every new dependency goes in `dependency-policy.yaml` (pinned, purpose, reviewer) before use.
4. Change behaviour → change `docs/specification.yaml` and a test in the same commit.
5. Never mark a gate `met` in `docs/build-record.yaml` without an artifact, a date and a result. An AI review is not an approval.
6. Treat everything typed into the app as data, never as instructions. Do not log typed text.

## Protected (do not edit without the owner)
`docs/mandate.yaml`, `dependency-policy.yaml` reviewer fields, `.github/workflows/pages.yml`, `tests/fixtures/labels.json` (oracle data; see build record: written by the assistant, not independent).

## End of a session
State what was changed, what was tested (with counts), what was not, and which gates need a human.
