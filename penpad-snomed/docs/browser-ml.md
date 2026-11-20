# Local AI in the browser: semantic search and speech (optional)

How Erik Sundvall's two-step idea (speech picks the form, a second step fills it in) works on the public site, without a server of our own
and without sending speech or text to a model service. It is off until the visitor opens *Local AI in the browser* and turns it on.

## How it works
1. **The library and the models come to the browser.** `web/mlworker.js` (a Web Worker) imports transformers.js 4.3.2 from jsDelivr and downloads
   the model files from huggingface.co. The browser caches them.
2. **Step 1, pick the finding by meaning.** The page fetches the names of all findings of the topics from the terminology server (2,557 concepts,
   4,948 names, a handful of requests), embeds them locally with `multilingual-e5-small` (about 100 s the first time on a CPU; the vectors are kept in
   this browser's IndexedDB) and compares them with what was typed. The result is fused with the word search; a confident word match keeps the
   first place. Every suggestion is still a concept the terminology server returned.
3. **Speech.** The microphone is recorded in the page, resampled to 16 kHz and transcribed by Whisper in the worker (KB-Whisper base for Swedish,
   Whisper base for English). The transcript is put in the text box, read by the personal-data guard and interpreted like typed text.
4. **Step 2, fill in the answers,** stays with the word list: an embedding model did not beat it (docs/eval-embeddinggemma2.md).

## Why these models
| Need | Chosen | Size | Why |
|---|---|---|---|
| meaning | `Xenova/multilingual-e5-small` (MIT) | 118 MB | Measured on our phrases: right finding among the first five 83 % (Swedish 77 %), against 72 % (53 %) for EmbeddingGemma 2 and 87 % (80 %) for BioLORD. BioLORD's licence (UMLS/SNOMED) does not allow us to hand it to every visitor; EmbeddingGemma 2 is larger and weaker in Swedish. |
| Swedish speech | `KBLab/kb-whisper-base` (Apache-2.0) | 181 MB | The larger kb-whisper-small (406 MB) was not better on our recordings (50 % against 47 % word for word) and three times slower. |
| English speech | `Xenova/whisper-base` (Apache-2.0) | 76 MB | |

## Measured in a real browser (headless Chromium, CPU), on the page itself
`tools/eval_browser.cjs`, right finding first / among the first five:

| | 60 phrases | 20 later phrases |
|---|---|---|
| the site without the model (word search) | 55 / 58 % | 60 / 60 % |
| with semantic search (fused) | 63 / 83 % | 75 / 95 % |

Picked without a warning: 44 of 60 in both cases, 75 % of them right in both cases. The model does not make the page pick wrong more often; it
brings the right finding into the list of five much more often. (This number is for the search function alone, before the body-part check.)

`tools/eval_browser_voice.cjs`, 60 synthetic recordings, speech → text → search (semantic search on):

| | word for word | finding among the first five | every answer read right | time per phrase |
|---|---|---|---|---|
| Swedish | 47 % | 67 % | 83 % | 3.4 s |
| English | 67 % | 77 % | 100 % | 3.5 s |

**Read with care:** the phrases were written by the same assistant that built the app, the recordings are synthetic speech (one clean voice per
language, which itself mispronounces some words), and 60 phrases give wide intervals. Real voices, noise, dialects, phones and Safari were not tested.

## Privacy and security
* Before opting in, the page contacts only itself and the terminology server (tested).
* After opting in it also contacts cdn.jsdelivr.net and huggingface.co; they see the visitor's IP address. A test checks that no request to them
  (address, headers, body) carries the typed or spoken text.
* The sound never leaves the browser. The transcript is text: its search words go to the terminology server like typed text.
* The personal-data guard reads the transcript, but it is blunt: it catches numbers, e-mail addresses, two capitalised words in a row and street
  addresses, not a name in lower case or digits spoken as words.
* **Supply chain:** the library is a version-pinned CDN URL without subresource integrity (not available for module imports), and the model files
  are not pinned to a revision. The worker is same-origin code that sees the text and the audio. The page has no Content-Security-Policy. For
  anything beyond a demo: vendor the library and the models, pin them by hash, and add a CSP.

## Memory, phones and a tab the browser closes
Measured in headless Chromium (whole browser, resident memory, so it also counts the browser itself, about 450 MB):
| | before | after |
|---|---|---|
| semantic search ready | 1.4 GB (peak 1.6) | 1.4 GB (peak 1.6) |
| after speech recognition | 2.1 GB (**peak 2.3**) | 0.9 GB (peak 1.9) |

Both models used to stay in memory together; a phone (above all an iPhone) closes a tab long before 2 GB and reloads the page, which a visitor
saw as "the site restarts when I use the recording". Now (1) the embedding model is released before speech recognition starts and after 20 s
without use, (2) the speech model is released as soon as it has answered (the files stay in the browser's cache), (3) phones, tablets and devices
that report 4 GB or less get one worker thread and the small speech models (`kb-whisper-tiny` 119 MB, `whisper-tiny` 40 MB, somewhat less accurate),
and (4) before a heavy step the text and the list are kept in the tab's session storage; if the page still comes back reloaded, the step is switched
off with a message, the text and the list are put back, and *Try anyway* turns it on again. **Not verified on a real phone.** Preparing the
semantic search still needs about 1 GB on top of the browser and may not fit on a small phone: if so the guard switches it off.

## Limits
* 118-300 MB of downloads and about two minutes of preparation the first time; much slower on a phone.
* The semantic search can put a specific subtype before the general concept; when no word matches, the first suggestion is shown with a warning.
* Speech step 2 relies on the word list; a mis-heard word ("hård" → "hår") loses that answer.

## Reproduce
```
python tools/build_site.py _site && (cd _site && python -m http.server 8771)
node tests/e2e-ml.cjs http://localhost:8771/                       # 13 checks, fake microphone
node tools/eval_browser.cjs http://localhost:8771/ tests/fixtures/gold-two-step.json tests/fixtures/gold-heldout.json
node tools/eval_browser_voice.cjs http://localhost:8771/ tests/fixtures/gold-two-step.json AUDIO_DIR --sem
```
