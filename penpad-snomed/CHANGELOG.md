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
- Close-ups for leg, back and a head-and-neck cross-section (drawn for this project); regions tongue, teeth, larynx.
- Aspect of a site (anterior, posterior, medial, lateral, proximal, distal), the body's counterpart of a tooth surface.
- A list of several findings with outputs for the whole list (expressions, one COMPOSITION, a FHIR Bundle) and marks on the body.
- Several findings from one sentence, each with its own body part and values and checked to lie inside that body part.
- English check (tests/audit-en.cjs, tests/i18n.test.mjs); whole arm and leg as body parts; "last week/month" as time words.
- General symptoms (fever, fatigue, nausea, vomiting, dizziness, cough, rash, dyspnoea, itching, diarrhoea, constipation, loss of appetite) and a Whole body button; later sentence parts without a body word are tried as findings of their own.
### Fixed
- Findings about the opposite side are no longer listed; English UI no longer shows Swedish suggestions.
- English search: filler words dropped, synonyms and the server's order used in ranking; everyday pain words (hurts, ont) find the pain concept.
- English: "stomach ache" gave a quadrant pain, "right leg" found nothing, "since last week" gave no time, and a side was written with a capital letter mid-sentence; a right-sided finding can no longer be offered "left" findings.
- Site build omitted a new module; the build now copies all web files and is tested.
