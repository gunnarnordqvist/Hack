# PEN&PAD smart forms with SNOMED CT

A prototype for the **PEN&PAD Nordic Hackathon 2026 online bonus track**. Type or dictate what the patient has, or point at
a body map. The system proposes a SNOMED CT finding, asks **only the follow-up questions that are valid for it**, and confirms
the result as a plain sentence, a post-coordinated SNOMED CT expression, an openEHR COMPOSITION and a FHIR `Condition`.

> Demo, not clinical decision support. No real patient data. The code was written by an AI agent (Claude) under
> Gunnar Nordqvist's direction and checked by running it; the clinical content has had no clinical review.

**Try it online:** https://gunnarnordqvist.github.io/Hack/ (client mode, see below; it needs a network connection to the terminology server).

## The idea, in the track's three steps

| Step | What happens here |
|---|---|
| **Target** | Free text (Swedish or English) is read for side, duration, severity and so on; the rest is matched to a finding. Or **point at the body**: a front and back figure with close-ups (hand, leg, back, and a cross-section of the head and neck, in the spirit of the original demo's Topics tab) lists the findings for the chosen site, and the side you click becomes the patient's side. |
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

## Publishing the site

The public site is the `gh-pages` branch (built by `tools/build_site.py`, no SNOMED CT content, no snapshot).

```sh
python tools/publish_site.py     # builds, commits to gh-pages in a temporary worktree, pushes
```

Then GitHub → **Actions → "Deploy site" → Run workflow**. The workflow is on `main` because the `github-pages` environment only
accepts deployments from the default branch (a workflow on `gh-pages` was tried and refused). Alternatively set Pages to
"Deploy from a branch: gh-pages"; then no workflow is needed. After publishing, `node tests/e2e.cjs https://gunnarnordqvist.github.io/Hack/ out/`
runs the browser checks against the live site.

## What was checked

All of this was run, see `tests/`.

- **Config verified against the server.** Every code in `backend/topics.json` (slots, units, attributes, 27 body regions) is an
  active concept and a member of its set (60 checks; the build fails otherwise). It has already caught one inactive concept.
  Server: HL7 Nordics `tx-nordics.fhir.org`, SNOMED CT International 20260801, Swedish module 20260531.
- **Swedish terms are real SNOMED CT** (Swedish module via `displayLanguage=sv`), not translations of ours. Where the module has
  no term the English term is shown and the UI says so.
- **English check:** `node tests/audit-en.cjs <url>` drives the whole app in English (examples, every region and close-up, aspect, list, several findings, warnings) and reports any visible line with Swedish text; `AUDIT_SELFTEST=1` shows that it does find Swedish on the Swedish page. `tests/i18n.test.mjs` checks that both languages have the same text keys. The local snapshot mode has no synonyms, so three English phrases that need them are only checked against the live terminology server.
- **Tests:** 71 JavaScript (`node --test tests/*.test.mjs`), 30 Python (`python -m unittest discover -s tests -p "test_*.py"`), and 65
  browser checks run in **each of the modes** (`node tests/e2e.cjs <url> <dir>`, needs Playwright; set `HTTPS_PROXY` if
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
was only in the typed text. Parts that are not drawn (eye, ear, elbow, wrist, toes) are reached by
sub-area buttons. Clicking a hand, a part of a leg, the head or neck, or the back/buttock opens a close-up: hand (palm, thumb and four
fingers from the same figure; the geometry decides which path is the thumb), leg (thigh, knee, lower leg, ankle, foot, per side),
back, and a **cross-section of the head and neck** (nose, mouth, teeth, tongue, throat, larynx) that is **drawn for this project
from scratch** (`web/headsection.js`, simple shapes, not traced from anything). The leg and back boxes are measured by
`tools/build_zoom_boxes.py`. Chest, abdomen and arms have no close-up.

**Several findings (e.g. after a fall: arm, hand and head).** *Add to the list* keeps the finding and clears the form for the next one; the listed findings can be edited or removed, and are marked in blue on the body figure. The outputs have a switch *This finding / The whole list*: one SNOMED expression per finding, one openEHR COMPOSITION with one OBSERVATION per finding, and a FHIR Bundle (collection) of Conditions. **Several findings from one sentence** ("ont i armen, handen och huvudet", "pain in the right arm and swollen left foot"): the text is cut into parts and every part gets its **own body part and its own values**: a side, severity or character said about one part is never given to another; only time words said once ("since yesterday") are shared. Each part is looked up *inside its own body part*: the finding's site must lie within it (SNOMED is-a on the finding site, an ECL constraint asked of the server), so "hand" can never give a finding about the foot. The parts are shown for review (*Add to the list*, *Review*, *Add all*); nothing is added without a click. The same check applies to one typed finding that names a body part: suggestions inside it come first, the others are marked *other body part*. Body words (Swedish incl. definite forms, English) and a few everyday phrases ("ont i huvudet" = headache) are our own unreviewed lists in `backend/topics.json` (`bodymap.words`, `compounds`, `aliases`). Limits: "arm" and "leg" stand for the whole upper and lower limb (SNOMED CT *Upper/Lower limb structure*); some ready-made findings (e.g. *Pain in left arm*) have the site "left half of the body" first and the arm second, so the form may show that site; names of body parts that are not in the list are not recognised.

**General symptoms ("whole body").** Findings that have no body part are a third topic, *general*: fever, fatigue, nausea, vomiting, dizziness, cough, rash, dyspnoea, itching, diarrhoea, constipation and loss of appetite (SNOMED CT concepts and their subtypes, verified against the server). They are reached by typing ("fever and cough for three days") or by the *Whole body* button next to the map, which lists the twelve main symptoms. A later part of a sentence that has no body word but words of its own is tried as a finding of its own; if nothing matches it goes back to the finding before it. If a body part is named and nothing matches inside it ("rash on both arms"), the app says so instead of offering an unrelated finding.

**Save and open the list.** *Save the list* writes a small JSON file with codes and answers only (no names, no SNOMED text); *Open a saved list* reads it back, checks every entry (codes, topics, slots, durations; at most 50 entries, 200 kB) and fetches the names again from the terminology server. The page itself stores nothing. The FHIR output for a list is a Bundle with a demo Patient and a demo Encounter that the Conditions refer to.

**Aspect of a site (the body's counterpart of a tooth surface).** In dentistry a finding is placed on a tooth *and* a surface (mesial, distal ...). The same method is used for the whole body: after the site (and side), the **aspect** can be chosen: anterior, posterior, medial, lateral, proximal, distal (SNOMED CT qualifier values, checked against the server; superior and inferior under *more*). It is chosen next to the map or in the form, or read from typed text ("lateral", "medialt"). It appears in the sentence and as a FHIR extension. In the SNOMED expression it is kept as a comment, because the SNOMED CT model has no attribute to attach it to, and the openEHR mapping we follow has no node for it, so it is listed as unmapped. Some body parts also have ready-made aspect concepts (e.g. *Anterior aspect of knee*, *Medial aspect of ankle*): when one exists under the finding's site it is shown as information (a comment in the expression, an extra FHIR body site, a row in the code table), but the finding's own site is never replaced.
30 regions are defined in `backend/topics.json` (`bodymap`). Findings with a non-regional site (skin, muscle, nerve ...) are
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
tests/     *.test.mjs  test_*.py  e2e.cjs  fixtures/labels.json (neutral labels)
tools/     build_site.py  publish_site.py  build_body_paths.py  build_zoom_boxes.py  make_test_labels.py  write_notices.py  bbox_parts.cjs
THIRD_PARTY_NOTICES.md
```

Made by Gunnar Nordqvist with Claude. https://books.geon.se
## Governance

Built under the practices of the book *Vibe to Dev* (vibetodev.geon.se). Tier A: a demo with made-up examples; **never enter real patient data**.
`AGENTS.md` (rules for the AI assistant), `docs/mandate.yaml` (draft), `docs/specification.yaml` (checked by `tools/check_spec.py`),
`docs/design.md`, `docs/adr/`, `docs/runbook.md`, `docs/build-record.yaml` (honest gate statuses: no gate needing a second person is met),
`dependency-policy.yaml`, `CHANGELOG.md`. Checks: `tools/scan_secrets.py`, `tools/check_dependencies.py`, `tools/check_spec.py`.
Optional environment variables for the local server: `PENPAD_TX` (terminology server), `PENPAD_CACHE`, `PENPAD_OFFLINE`, `PENPAD_MODEL`.

Contact: Gunnar Nordqvist · [GitHub](https://github.com/gunnarnordqvist) · [LinkedIn](https://www.linkedin.com/in/gunnarnordqvist) · [books.geon.se](https://books.geon.se). No email address is published.
