# Changelog
Format: Keep a Changelog. No release has been tagged; tagging v0.1.0 is left to the owner.

## [Unreleased] — 2026-11-18
### Added
- Free-text slot extraction, sentence/SNOMED/openEHR/FHIR outputs, Swedish and English.
- Body map with front/back and hand close-up; side-aware finding lists.
- Client mode: public site queries the terminology server; no SNOMED CT content in the repository.
- Personal-data guard, secret scan, dependency policy and checker, specification checker.
- Pipeline: test → build → gh-pages → Pages deploy, actions pinned to commits.
- Governance documents: AGENTS.md, mandate (draft), specification, design, ADRs, runbook, build record.
### Fixed
- Findings about the opposite side are no longer listed; English UI no longer shows Swedish suggestions.
- Site build omitted a new module; the build now copies all web files and is tested.
