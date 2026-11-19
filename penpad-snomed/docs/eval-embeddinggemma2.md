# EmbeddingGemma 2 in two steps: a first measurement

Erik Sundvall suggested two steps with EmbeddingGemma 2: one that listens to speech and picks the right form, and a second that fills it in
(about 700 alternatives per question set). This page says what was built, what was measured, and what the numbers do and do not show.
Everything here is an experiment in the local backend; **the public site is unchanged** and does not use any model.

## What EmbeddingGemma 2 is (from its model card)
`google/embeddinggemma-2`: Apache 2.0, not gated, 740 M parameters (270 M text, 300 M audio encoder, 170 M image encoder), 768-dimensional vectors in one
shared space for text, images, video and audio, 8,192-token context, 25 audio tokens per second, 16 kHz mono audio. It must run in float32 or bfloat16
(float16 gives NaN). It runs on this machine's CPU: about 1.3 s for a 3 s recording, about 90 s to embed our ~4,900 term names.

## What we have
| Step | Our setting | Size |
|---|---|---|
| 1. pick the form | the finding, among all findings of the three topics | 2,557 concepts, 4,948 names (English and Swedish) |
| 2. fill it in | the answers: side, severity, character, onset, pattern, progress, consistency | 57 options in the quick lists (124 in all the snapshot offers); no question has more than 49 in SNOMED CT |

So "about 700 alternatives" matters for step 1, where 2,557 concepts is more than that; the questions of step 2 are far smaller.

## How it was measured
`backend/eval_two_step.py` and `backend/eval_voice.py` on 60 phrases of our own (30 Swedish, 30 English; `tests/fixtures/gold-two-step.json`, codes only).
**They were written by the same assistant that built the word list**, 25 of them accept two concepts, and the groups are small, so read the numbers as a
first look. After an independent review of the first version the harness was corrected: ties are broken by the shorter name, hit@k is shown both
lenient (any accepted concept) and strict (the first one only), the splits are measured, 95% intervals come from resampling the phrases, and the
settings of step 2 are chosen on one half of the phrases and scored on the other. Voice uses **synthetic speech** (Piper, one clean voice per
language), so it is an optimistic test.

## Step 1: pick the finding (hit in the first 1 / first 5 suggestions, %)
Query = what is left of the phrase after the app's word list has taken out side, duration and so on (as in the app). 95% intervals on the first-place rate are wide (about ±12).

| Method | all | Swedish | English |
|---|---|---|---|
| word overlap only (no server) | 55 / 68 | 53 / 63 | 57 / 73 |
| EmbeddingGemma 2 | 50 / 72 | 33 / 53 | 67 / 90 |
| BioLORD-2023-M (what the local server uses) | **65 / 87** | **60 / 80** | 70 / 93 |
| fusion BioLORD + EmbeddingGemma 2 | 63 / 83 | 50 / 77 | 77 / 90 |

* In English the two models are about equal. In Swedish EmbeddingGemma 2 is clearly weaker than BioLORD on these phrases.
* Fusing the two did not beat BioLORD alone.
* Strict hit@5 (the first accepted concept only): BioLORD 87, EmbeddingGemma 2 70, word overlap 67.

## Step 2: fill in the answers (precision / recall / F1, %, all 60 phrases)
| Method | precision | recall | F1 (95% interval) |
|---|---|---|---|
| the app's word list | 100 | 76 | 86 (79-92) |
| EmbeddingGemma 2 alone (settings chosen on one half, scored on the other) | 93 | 63 | 75 (64-84) |
| word list first, EmbeddingGemma 2 fills what is left | 94 | 77 | 85 (77-92) |

* EmbeddingGemma 2 matching every 1-3 word span against the options did **not** beat the word list, and adding it to the word list gave no measurable gain overall.
* On the 15 phrases where the word list is not exactly right: recall 32 → 36 with EmbeddingGemma 2 filling in, F1 48 → 50, at a small cost in precision. Within the noise.
* The similarity between unrelated short strings is about 0.83 and real matches are 0.94-1.00, so the threshold has to be high (0.92-0.96); a first sweep at 0.55-0.80 gave identical numbers for every setting because it never cut anything.
* The model does not link every everyday wording to the SNOMED CT answer: "kraftig" did not find "svår" (severe) among the top five.

## Voice (60 synthetic recordings; hit in the first 1 / first 5)
| Route | all | 95% interval, first place |
|---|---|---|
| the sound embedded directly (EmbeddingGemma 2 audio), compared with the finding names | 13 / 38 | 5-22 |
| the same phrase as text, no prompt (the fair comparison) | 28 / 50 | 18-40 |
| speech recogniser (Whisper small) → text left after the word list → BioLORD | 42 / 60 | 30-53 |
| the same phrases typed (for reference) → BioLORD | 65 / 87 | 53-77 |

* Embedding the sound directly is clearly worse than text, and worse than transcribing first, on these recordings.
* The transcript route loses about 20 points against typed text: Whisper small got 28 of 60 phrases word for word and made typical Swedish errors ("tommer" for *tumme*, "huvudverk"). A larger or Swedish-tuned recogniser was not tried.
* Step 2 from voice was not measured (it would need the transcript).

## What this suggests (not a decision)
1. For step 1 the existing local model (BioLORD) is at least as good as EmbeddingGemma 2 on our phrases, clearly better in Swedish. EmbeddingGemma 2 is a fair choice for English or if one model for text, speech and images is wanted.
2. For step 2 the word list is already strong when the wording is known; an embedding model adds little on these phrases. A better use of the effort is to extend the word list with the paraphrases that failed.
3. For voice, transcribe first (with a good Swedish recogniser) and keep the text path, rather than embedding the sound directly. A voice route in the browser would also send audio to whoever runs the recogniser; the personal-data guard only reads text.
4. Needed before any of this is believed: phrases written and labelled by someone who has not seen the code, real voices and noise, and a decision on which recogniser.

## After the measurement: the word list was extended
The recommendation was to improve the word list rather than add a model, so general synonyms were added in `backend/topics.json` (severe: *outhärdlig, hemsk, terrible, unbearable*; constant: *hela tiden, all the time*; better: *lugnat sig, avtagit, eased, subsided*; worse: *tilltagande, increasing*; gradual: *smyga sig på, crept up*; burning: *brinner, burns* and a few more), with a test that no word stands for two answers. Answers read correctly (F1, `tools/compare_wordlists.mjs`):

| Phrases | before | after |
|---|---|---|
| the 60 phrases (`gold-two-step.json`) | 86 | 98 |
| 20 new phrases (`gold-heldout.json`) | 49 | 98 |

**Read this with care.** The words were added after the 60 phrases had been seen, and the 20 new phrases were written afterwards by the same assistant with the new words in mind. The table shows that the added words work, not that the list now generalises. A person who has not seen the list should write the next test set.

## Faults found along the way
* The app treated the plain Swedish word *värk* (pain) as the character *värkande* and removed it from the search. Fixed in `backend/topics.json` and `web/lexrank.js`, with tests.
* The first version of the harness gave misleading numbers (threshold sweep that never cut, ties broken by list order, tuning on the test phrases, hand-set "known" flags). Corrected as described above.

## Reproduce
```
pip install -r requirements-optional.txt     # torch and torchvision from the CPU index
python backend/build_snapshot.py             # local snapshot (not committed)
python backend/eval_two_step.py --out results.json
python backend/eval_voice.py AUDIO_DIR --transcripts transcripts.json --out voice.json
```
The recordings (Piper, voices sv_SE-nst-medium and en_US-lessac-medium) and the transcripts (faster-whisper small) were made outside the repository and are not committed.
