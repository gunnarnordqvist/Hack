"""Step 1 from voice: does the spoken phrase find the right finding when the SOUND is embedded directly (EmbeddingGemma 2 audio encoder),
compared with the same phrase as text, and with a transcript from a speech recogniser (optional)?

  python backend/eval_voice.py AUDIO_DIR [--out results.json] [--transcripts transcripts.json]

AUDIO_DIR holds NN.wav (16 kHz mono) in the order of tests/fixtures/gold-two-step.json. The recordings used so far are synthetic speech
(Piper), clean, one voice per language: an optimistic test. Real voices, noise and dialects are not covered.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eval_two_step import BIOLORD, CACHE, EG2, ROOT, SLOTS, encode, hits, lexicon_extract, load, rank_codes, summarize  # noqa: E402


def load_multimodal():
    import torch
    from sentence_transformers import SentenceTransformer
    # text and audio encoders; no image encoder. float32: float16 gives NaN
    return SentenceTransformer(EG2, model_kwargs={"torch_dtype": torch.float32}, config_kwargs={"vision_config": None})


def embed_audio(model, wavs: list[Path]) -> np.ndarray:
    import hashlib
    key = hashlib.sha1(b"".join(p.read_bytes() for p in wavs)).hexdigest()[:16]  # the content, not just names and sizes
    f = CACHE / f"eval-audio-{key}.npy"
    if f.exists():
        return np.load(f)
    vecs = []
    for p in wavs:
        v = model.encode({"audio": str(p)}, normalize_embeddings=True)  # audio goes in without a prompt prefix
        vecs.append(np.asarray(v, dtype=np.float32).reshape(-1))
    arr = np.stack(vecs)
    if np.isnan(arr).any():
        raise SystemExit("NaN in the audio embeddings")
    np.save(f, arr)
    return arr


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio_dir")
    ap.add_argument("--out", default=None)
    ap.add_argument("--transcripts", default=None, help="JSON list of transcripts, same order (from a speech recogniser)")
    a = ap.parse_args()
    snap = json.loads((ROOT / "web/data/snapshot.json").read_text(encoding="utf8"))
    gold = json.loads((ROOT / "tests/fixtures/gold-two-step.json").read_text(encoding="utf8"))["items"]
    wavs = [Path(a.audio_dir) / f"{i:02d}.wav" for i in range(len(gold))]
    missing = [p.name for p in wavs if not p.exists()]
    if missing:
        raise SystemExit(f"missing recordings: {missing[:5]} ...")
    names, codes = [], []
    for code, en, sv, _t in snap["universe"]:
        for t in (en, sv):
            if t:
                names.append(t)
                codes.append(code)
    t0 = time.time()
    m = load_multimodal()
    dn = encode(m, EG2, names, "document")
    av = embed_audio(m, wavs)
    full = [g["text"] for g in gold]
    ext = lexicon_extract(full)
    ok = [all(e["values"].get(s) == g["slots"].get(s) for s in SLOTS) for e, g in zip(ext, gold)]
    # the text queries are given both with the task prompt and without (the audio goes in without a prompt: the fair comparison is "plain")
    q = {"the same phrase as text (with the task prompt)": encode(m, EG2, full, "query"), "the same phrase as text (no prompt, like the audio)": encode(m, EG2, full, "plain")}
    rows: dict[str, list] = {"voice (the sound itself)": [], **{k: [] for k in q}}
    vecs = {"voice (the sound itself)": av, **q}
    texts_all = names
    if a.transcripts:
        tr = json.loads(Path(a.transcripts).read_text(encoding="utf8"))
        rest_tr = [e["rest"] for e in lexicon_extract(tr)]  # what the app would search for after reading the slot words
        bio = load(BIOLORD)
        bn = encode(bio, BIOLORD, names, "document")
        for qkind, qs in (("full transcript", tr), ("transcript, text left after the word list", rest_tr)):
            vecs[f"{qkind} -> EmbeddingGemma 2"] = encode(m, EG2, qs, "query")
            vecs[f"{qkind} -> BioLORD-2023-M"] = encode(bio, BIOLORD, qs, "query")
            rows[f"{qkind} -> EmbeddingGemma 2"] = []
            rows[f"{qkind} -> BioLORD-2023-M"] = []
        norm = lambda t: re.sub(r"[^\w\s]", "", t.lower()).split()
        exact = sum(norm(g["text"]) == norm(t) for g, t in zip(gold, tr))
    for i, g in enumerate(gold):
        base = {"lang": g["lang"], "ok": ok[i]}
        for k, v in vecs.items():
            docs = bn if "BioLORD" in k else dn
            rows[k].append({**base, "r": hits(rank_codes(v[i] @ docs.T, codes, texts_all), g["finding"])})
    res = rows
    out = {"seconds": round(time.time() - t0, 1), "n_phrases": len(gold), "transcripts_word_for_word": (exact if a.transcripts else None), "methods": {k: summarize(v) for k, v in res.items()}}
    text = json.dumps(out, indent=1, ensure_ascii=False)
    if a.out:
        Path(a.out).write_text(text, encoding="utf8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
