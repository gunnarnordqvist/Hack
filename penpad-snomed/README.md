# PEN&PAD smart forms with SNOMED CT

A prototype for the **PEN&PAD Nordic Hackathon 2026 online bonus track**. Type or dictate what the patient has.
The system proposes a SNOMED CT finding, asks **only the follow-up questions that are valid for it**, and confirms the
result as a plain sentence, a post-coordinated SNOMED CT expression, an openEHR COMPOSITION and a FHIR `Condition`.

> Demo, not clinical decision support. No real patient data. The code was written by an AI agent (Claude) under
> Gunnar Nordqvist's direction and reviewed by running it; clinical content has had no clinical review.

## The idea, in the track's three steps

| Step | What happens here |
|---|---|
| **Target** | Free text (Swedish or English) is read for side, duration, severity and so on; the rest is matched to a finding. Or **point at the body**: a front and back figure with close-ups of hand, foot and head (as on the demo's Topics tab) lists the findings for the chosen site, and the side you click becomes the patient's side. |
| **Refine** | Options per question come from the terminology server as **ECL value sets**. Side is offered only for body structures in the SNOMED CT reference set *lateralizable body structure*. A short list of quick choices has a visible **"more…"** cue. |
| **Validate** | A sentence generator writes the choices back ("Is this what you meant?"). Every code is checked against the server. |

**The terminology decides, the model only suggests.** A local embedding model may re-order the candidates the server
returned. No component can invent a code, and nothing here creates or changes SNOMED CT concepts.

## Try it

First create the snapshot (needs the network once; it is a copy of SNOMED CT content and therefore **not committed**,
check your licence before sharing it):

```sh
python backend/build_snapshot.py                 # writes web/data/snapshot.json (about 3 minutes cold, seconds from cache)
```

**Static demo** (no backend; lexical ranking, model re-ranking only for the sample phrases):

```sh
python3 -m http.server 8766 --directory web      # open http://127.0.0.1:8766/
```

**Live** (embedding re-rank with a local model, codes validated against the server while you click):

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install sentence-transformers
python backend/server.py --port 8765             # first start downloads the model (about 1.1 GB) and indexes the terms
```

## What was checked

All of this was run, see `tests/` and `docs/`.

- **Config verified against the server.** Every code in `backend/topics.json` is an active concept and a member of its slot's
  ECL set (30 checks; the build fails otherwise). Server: HL7 Nordics `tx-nordics.fhir.org`, SNOMED CT International
  20260801, Swedish module 20260531.
- **Swedish terms are real SNOMED CT** (Swedish module via `displayLanguage=sv`), not translations of ours. Where the module
  has no term (e.g. *Rapid onset*) the English term is shown and the UI says so.
- **Tests:** 23 JavaScript (`node --test tests/*.test.mjs`), 13 Python (`python -m unittest tests/test_backend.py`),
  26 browser checks in static and in live mode (`node tests/e2e.cjs <url> <dir>`, needs Playwright).
- **Candidate finder, own check on 14 phrases** (`docs/eval-candidates.json`, **our own labels, not a benchmark**; the
  confidence threshold was tuned after looking at one of these phrases):

| | hit@1 | hit@3 |
|---|---|---|
| Baseline: server text filter + fuzzy matching | 10 / 14 | 13 / 14 |
| + BioLORD-2023-M re-rank | 14 / 14 | 14 / 14 |

The server's own text filter finds Swedish only through the Swedish module and matches loosely; the model helps with
colloquial and compound words ("ont i tummen", "ryggont"). It fails on some ("magont" is only a low-confidence guess), and
the UI then says **low confidence** and offers a manual search.

## The body map

The figure and the close-ups are **our own drawing** (nothing from the Clinergy demo). Which findings belong to a region is
decided by SNOMED CT, not by the drawing: a finding is listed for a region when its **finding site** is that structure or one of
its descendants (is-a), e.g. *Pain in thumb* is listed for thumb, hand and upper limb. The chosen finding is highlighted on the
body (amber), with the side taken from the laterality answer; pointing at the body (teal) and clicking a finding in the list sets
laterality from the clicked side, and that explicit side wins over a side that was only in the typed text.
27 regions are defined in `backend/topics.json` (`bodymap`); every region code is verified against the server, which already
caught one inactive concept. Of the 1,314 findings that have a finding site, 748 fall into at least one drawn region; the rest
have a non-regional site (skin, muscle, nerve ...) and are reached by text or the search box.

## Outputs

- **Sentence**, Swedish and English, for clinician and for patient (patient wording adds a plain explanation).
- **SNOMED CT expression**, e.g. `300955002 |Pain in thumb| : { 363698007 |Finding site| = (76505004 |Thumb structure| : 272741003 |Laterality| = 7771000 |Left|) }, ...`.
  The expression itself is not validated by a server.
- **openEHR COMPOSITION** (canonical JSON). Structure and at-codes follow Erik Sundvall's
  [clinergy-extractor](https://github.com/erik-sundvalls-bots/clinergy-extractor) (Apache-2.0), which cites the published CKM
  archetypes (`COMPOSITION.encounter.v1`, `OBSERVATION.story.v1`, `CLUSTER.symptom_sign.v2`, `CLUSTER.anatomical_location.v1`).
  Values are SNOMED CT. Progress, pattern and consistency are **not mapped** (the verified template has no element for them)
  and are listed in the output. Not uploaded to or validated by an openEHR server.
- **FHIR R4 `Condition`**: code, severity and body site as SNOMED CT; laterality as a second `bodySite` (a modelling choice to
  confirm); the other answers in extensions under a placeholder URL (no published profile yet).

## Where this comes from

- *SNOMED CT Expo 2021*, Karlsson and Sundvall: ECL + FHIR terminology service + openEHR, with lateralizable body structures.
  **This project reproduces that pattern**, then adds free-text reading, Swedish SNOMED terms, an embedding re-rank, a patient
  mode and a confirmation sentence.
- *Alan Rector interview part 4*: query SNOMED rather than create concepts; start from what the user says; always show that more
  options exist; "Is this what you meant?"; generate language for patients as well as clinicians.

## Limits

- Two topics (pain, swelling), one language pair, a schematic body map (no body-system icon row), no speech, no saving. The confirmation can be edited by changing
  any answer; whether it should be final is an open question.
- Clinical choices (which options are "quick", the Swedish synonym lists, the patient wording) are ours and unreviewed.
- The snapshot is a copy of SNOMED CT content; follow your SNOMED CT licence terms if you reuse it. BioLORD-2023-M has its
  own licence (`ihtsdo-and-nlm-licences`). No Clinergy content is included.
- No official SNOMED International position on building a local embedding index was found; keep any index small and demo-only.
- The demo server (`tx-nordics.fhir.org`) is a public service; cache and fall back when it is slow.

## Layout

```
backend/   tx.py (FHIR client, disk cache)  rank.py (candidates)  verify_topics.py  build_snapshot.py  server.py  topics.json
web/       index.html  app.js  extract.js (free text -> slots)  generators.js  lexrank.js  bodymap.js  data/snapshot.json
tests/     *.test.mjs  test_backend.py  e2e.cjs
docs/      eval-candidates.json
```

Made by Gunnar Nordqvist with Claude. https://books.geon.se
Contact: TODO add the GitHub and LinkedIn links before submitting; no email address is published.
