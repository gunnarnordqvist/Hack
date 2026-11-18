# PEN&PAD terminology-driven input (SNOMED CT, openEHR, FHIR)

**Author:** Gunnar Nordqvist · [GitHub](https://github.com/gunnarnordqvist) · [LinkedIn](https://www.linkedin.com/in/gunnarnordqvist) · [books.geon.se](https://books.geon.se)
**Live demo:** https://gunnarnordqvist.github.io/Hack/ · **Source:** https://github.com/gunnarnordqvist/Hack/tree/main/penpad-snomed

## Idea
The terminology decides, the model only suggests. The user types or dictates free text, or clicks a body map. Candidate findings come from SNOMED CT ECL sets on a FHIR terminology server (HL7 Nordics `tx-nordics.fhir.org`); the app asks only for the details a finding allows (for example side only when the body site is lateralizable). No code is ever invented by a model.

## Outputs from one selection
A sentence (Swedish/English, clinician/patient wording), a SNOMED CT expression, an openEHR COMPOSITION (following the mapping in the clinergy-extractor) and a FHIR Condition.

## Notes
- Runs entirely in the browser; the public site holds no SNOMED CT content. Search words typed by a visitor go to the terminology server; a guard blocks text that looks like identity numbers, phone numbers or e-mail addresses.
- Body map from an MIT-licensed figure (origin of the original artwork not verified, see THIRD_PARTY_NOTICES.md).
- Prototype for made-up examples only, tier A; never enter real patient data. Tests: 36 JS, 28 Python, 34 browser checks. Honest status of quality gates in `docs/build-record.yaml`.
- Limitations: small self-written evaluation set (14 phrases), guard is heuristic, no dental chart yet.

## Entry for challenge/readme.md
`- [PEN&PAD terminology-driven input](penpad-snomed/readme.md) — Gunnar Nordqvist: SNOMED CT via ECL decides the options, outputs sentence, SNOMED expression, openEHR and FHIR; Swedish/English; body map. [Demo](https://gunnarnordqvist.github.io/Hack/)`
