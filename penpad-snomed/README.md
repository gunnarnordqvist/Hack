# PEN&PAD smart forms with SNOMED CT

A prototype for the **PEN&PAD Nordic Hackathon 2026 online bonus track**. Type or dictate what the patient has, or point at
a body map. The system proposes a SNOMED CT finding, asks **only the follow-up questions that are valid for it**, and confirms
the result as a plain sentence, a post-coordinated SNOMED CT expression, an openEHR COMPOSITION and a FHIR `Condition`.

> Demo, not clinical decision support. No real patient data. The code was written by an AI agent (Claude) under
> Gunnar Nordqvist's direction and checked by running it; the clinical content has had no clinical review.

## The idea, in the track's three steps

| Step | What happens here |
|---|---|
| **Target** | Free text (Swedish or English) is read for side, duration, severity and so on; the rest is matched to a finding. Or **point at the body**: a front and back figure (plus a hand close-up, as on the original demo's Topics tab) lists the findings for the chosen site, and the side you click becomes the patient's side. |
| **Refine** | Options per question come from the terminology server as **ECL value sets**. Side is offered only for body structures in the SNOMED CT reference set *lateralizable body structure*. A short list of quick choices has a visible **"more…"** cue. |
| **Validate** | A sentence generator writes the choices back ("Is this what you meant?"). Every code is checked against the server. |

**The terminology decides, the model only suggests.** An optional local embedding model may re-order the candidates the
server returned. No component can invent a code, and nothing here creates or changes SNOMED CT concepts.

## Three ways to run it

**1. The public site (client mode).** `tools/build_site.py` builds a static site that contains **no SNOMED CT content**. The
visitor's browser asks the HL7 Nordics terminology server directly (it allows cross-origin requests) for candidates, labels,
body-region findings, finding sites and validation. Suggestions come from the server's text filter (English and Swedish); there
is no model in the browser.

```sh
python tools/build_site.py out/ && python3 -m http.server 8768 --directory out/
```

**2. Snapshot mode** (offline demo, local only; the snapshot is a copy of SNOMED CT content and is **not committed**, check your
licence before sharing it):

```sh
python backend/build_snapshot.py                 # writes web/data/snapshot.json (about 3 minutes cold, seconds from cache)
python3 -m http.server 8766 --directory web      # open http://127.0.0.1:8766/
```

**3. Live with a local model** (embedding re-rank, codes validated while you click):

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install sentence-transformers
python backend/server.py --port 8765             # first start downloads the model (about 1.1 GB) and indexes the terms
```

The page picks the mode itself: a snapshot if there is one, otherwise client mode; a backend if `/api/health` answers.

## What was checked

All of this was run, see `tests/`.

- **Config verified against the server.** Every code in `backend/topics.json` (slots, units, attributes, 27 body regions) is an
  active concept and a member of its set (60 checks; the build fails otherwise). It has already caught one inactive concept.
  Server: HL7 Nordics `tx-nordics.fhir.org`, SNOMED CT International 20260801, Swedish module 20260531.
- **Swedish terms are real SNOMED CT** (Swedish module via `displayLanguage=sv`), not translations of ours. Where the module has
  no term (e.g. *Rapid onset*) the English term is shown and the UI says so.
- **Tests:** 25 JavaScript (`node --test tests/*.test.mjs`), 13 Python (`python -m unittest tests/test_backend.py`), and 26
  browser checks run in **each of the three modes** (`node tests/e2e.cjs <url> <dir>`, needs Playwright; set `HTTPS_PROXY` if
  outbound HTTPS needs a proxy). The unit tests use neutral fixture labels in our own words, not SNOMED terms.
- **Candidate finder, own check on 14 phrases** (`backend/eval_candidates.py`, **our own labels, not a benchmark**; the
  confidence threshold was tuned after looking at one of these phrases):

| | hit@1 | hit@3 |
|---|---|---|
| Baseline: server text filter + fuzzy matching (what client mode uses) | 10 / 14 | 13 / 14 |
| + BioLORD-2023-M re-rank (local model only) | 14 / 14 | 14 / 14 |

The server's own text filter finds Swedish only through the Swedish module and matches loosely; the model helps with
colloquial and compound words ("ont i tummen", "ryggont"). It fails on some ("magont" is only a low-confidence guess), and
the UI then says **low confidence** and offers a manual search.

## The body map

The figure is **not our drawing**: it is MIT-licensed path data from `react-body-map` (see `THIRD_PARTY_NOTICES.md`, including
what could **not** be verified about its original artwork). Nothing is from the Clinergy demo. Region ids, sides and the
SNOMED CT meaning of each region are ours, and which findings belong to a region is decided by SNOMED CT, not by the drawing: a
finding is listed for a region when its **finding site** is that structure or a descendant (is-a), e.g. *Pain in thumb* is
listed for thumb, hand and upper limb (client mode asks the server with an ECL attribute search).
The chosen finding is highlighted on the body (amber), with the side taken from the laterality answer; pointing at the body
(teal) and clicking a finding in the list sets laterality from the clicked side, and that explicit side wins over a side that
was only in the typed text. Parts that are not drawn (eye, ear, nose, mouth, throat, elbow, wrist, toes) are reached by
sub-area buttons. Hand close-up: palm, thumb and four fingers from the same figure; the geometry decides which path is the thumb.
27 regions are defined in `backend/topics.json` (`bodymap`). Findings with a non-regional site (skin, muscle, nerve ...) are
reached by text or the search box.

## Outputs

- **Sentence**, Swedish and English, for clinician and for patient (patient wording adds a plain explanation).
- **SNOMED CT expression**, with finding site, laterality, severity and clinical course. The expression itself is not
  validated by a server.
- **openEHR COMPOSITION** (canonical JSON). Structure and at-codes follow Erik Sundvall's
  [clinergy-extractor](https://github.com/erik-sundvalls-bots/clinergy-extractor) (Apache-2.0), which cites the published CKM
  archetypes (`COMPOSITION.encounter.v1`, `OBSERVATION.story.v1`, `CLUSTER.symptom_sign.v2`, `CLUSTER.anatomical_location.v1`).
  Values are SNOMED CT. Progress, pattern and consistency are **not mapped** (the verified template has no element for them)
  and are listed in the output. Not uploaded to or validated by an openEHR server.
- **FHIR R4 `Condition`**: code, severity and body site as SNOMED CT; laterality as a second `bodySite` (a modelling choice to
  confirm); the other answers in extensions under a placeholder URL (no published profile yet).

## Where this comes from

- *SNOMED CT Expo 2021*, Karlsson and Sundvall: ECL + FHIR terminology service + openEHR, with lateralizable body structures.
  **This project reproduces that pattern**, then adds free-text reading, Swedish SNOMED terms, a body map, an optional embedding
  re-rank, a patient mode and a confirmation sentence.
- *Alan Rector interview part 4*: query SNOMED rather than create concepts; start from what the user says; always show that more
  options exist; "Is this what you meant?"; generate language for patients as well as clinicians.

## Limits

- Two topics (pain, swelling), one language pair, no speech, no saving. The confirmation can be edited by changing any answer;
  whether it should be final is an open question.
- Client mode depends on a public terminology server being reachable and fast; there is no model, so recall is lower.
- Clinical choices (which options are "quick", the Swedish synonym lists, the patient wording) are ours and unreviewed.
- The body figure shows muscle groups, which is not how every clinician thinks about sites; region membership still follows SNOMED CT.
- SNOMED CT content is not in this repository. Follow your SNOMED CT licence terms when you reuse what the server returns.
  BioLORD-2023-M (local mode only) has its own licence. No Clinergy content is included.
  No official SNOMED International position on building a local embedding index was found; keep any index small and demo-only.

## Layout

```
backend/   tx.py (FHIR client + disk cache)  rank.py  verify_topics.py  build_snapshot.py  server.py  eval_candidates.py  topics.json
web/       index.html  app.js  extract.js (free text -> slots)  generators.js  lexrank.js  txclient.js (browser FHIR client)
           bodymap.js  vendor/bodypaths.js (generated, MIT)  data/snapshot.json (generated, not committed)
tests/     *.test.mjs  test_backend.py  e2e.cjs  fixtures/labels.json (neutral labels)
tools/     build_site.py  build_body_paths.py  make_artifact.py  make_test_labels.py  write_notices.py  bbox_parts.cjs
THIRD_PARTY_NOTICES.md
```

Made by Gunnar Nordqvist with Claude. https://books.geon.se
Contact: TODO add the GitHub and LinkedIn links before submitting; no email address is published.
