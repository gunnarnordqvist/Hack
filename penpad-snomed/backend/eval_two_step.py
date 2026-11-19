"""Evaluation of the two steps Erik suggested, with embedding models, on our own phrases (tests/fixtures/gold-two-step.json).

  step 1  pick the form: a phrase -> the right finding among all findings of the topics (about 2,500 concepts)
  step 2  fill it in:    the answers to the questions (side, severity, character, onset, pattern, progress, consistency)

Step 1 compares word overlap only (no server), BioLORD-2023-M, EmbeddingGemma 2 (text) and fusions. Step 2 compares the word list used by the
app (web/extract.js), EmbeddingGemma 2 matching every 1-3 word span against the answer options, and the two together.

  python backend/eval_two_step.py [--out results.json] [--no-biolord]

Needs the optional environment (requirements-optional.txt) and a local snapshot (python backend/build_snapshot.py). Nothing here goes into the
public site. The phrases are our own, written by the same assistant that built the word list: the numbers are a first look, not a benchmark.
How the numbers are made less misleading (after an independent review of the first version):
  * ties in a ranking are broken by the shorter name, never by the order of the list; a name with score 0 is not ranked at all;
  * hit@k is reported two ways: any accepted concept ("lenient") and the first accepted concept only ("strict");
  * the splits "word list gets every answer right / misses something" are MEASURED, not hand-set;
  * 95% intervals come from resampling the phrases (bootstrap), and the settings of step 2 (threshold, margin) are chosen on one half of the
    phrases and scored on the other half (2-fold), so the headline number does not come from tuning on the test phrases;
  * the full grid of settings is still printed, labelled as optimistic.
Run in float32 on CPU: EmbeddingGemma 2 gives NaN in float16.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rank import lex_score  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
EG2 = "google/embeddinggemma-2"
BIOLORD = "FremyCompany/BioLORD-2023-M"
SLOTS = ["laterality", "severity", "character", "onset", "pattern", "progress", "consistency"]
STOP = set("i på av och en ett med om har jag min mitt mina det den är the in of a an my have has is and with on at to it that got been was am are all bit".split())


def load(name: str):
    import torch
    from sentence_transformers import SentenceTransformer
    if name == EG2:  # text only: the image and audio encoders are not needed for text; float32 because float16 gives NaN
        return SentenceTransformer(name, model_kwargs={"torch_dtype": torch.float32}, config_kwargs={"vision_config": None, "audio_config": None})
    return SentenceTransformer(name)


def encode(model, name: str, texts: list[str], role: str) -> np.ndarray:
    """role: query | document | sts | plain (no prompt). Cached on disk (cache/ is not committed)."""
    CACHE.mkdir(exist_ok=True)
    key = hashlib.sha1((name + role + "\n".join(texts)).encode()).hexdigest()[:16]
    f = CACHE / f"eval-{key}.npy"
    if f.exists():
        return np.load(f)
    kw = {"batch_size": 32, "normalize_embeddings": True}
    if name == EG2 and role != "plain":
        kw["prompt_name"] = {"query": "SearchQuery", "document": "Document", "sts": "SentenceSimilarity"}[role]
    v = np.asarray(model.encode(texts, **kw), dtype=np.float32)
    if np.isnan(v).any():
        raise SystemExit(f"{name}: NaN in the embeddings (wrong precision?)")
    np.save(f, v)
    return v


def lexicon_extract(texts: list[str]) -> list[dict]:
    p = subprocess.run(["node", str(ROOT / "web/tools/extract_cli.mjs"), str(CACHE / "labels-for-extract.json")],
                       input=json.dumps(texts), capture_output=True, text=True, check=True)
    return json.loads(p.stdout)


# ---------------------------------------------------------------- ranking and metrics
def hits(ranked: list[str], accept: list[str]) -> dict:
    """Lenient: any accepted concept within k. Strict: the first accepted concept (the primary one) within k."""
    acc = set(accept)
    return {"l1": int(any(c in acc for c in ranked[:1])), "l3": int(any(c in acc for c in ranked[:3])), "l5": int(any(c in acc for c in ranked[:5])),
            "s1": int(accept[0] in ranked[:1]), "s5": int(accept[0] in ranked[:5])}


def rank_codes(sims: np.ndarray, codes: list[str], texts: list[str] | None = None, positive_only: bool = False) -> list[str]:
    """Best score per concept; ties go to the shorter name, then to the code (never to the order of the list)."""
    best: dict[str, tuple[float, int]] = {}
    for i, (s, c) in enumerate(zip(sims, codes)):
        if positive_only and s <= 0:
            continue
        ln = len(texts[i]) if texts else 0
        cur = best.get(c)
        if cur is None or s > cur[0] or (s == cur[0] and ln < cur[1]):
            best[c] = (float(s), ln)
    return [c for c, _ in sorted(best.items(), key=lambda kv: (-kv[1][0], kv[1][1], kv[0]))]


def fuse(*rankings: list[str], depth: int = 50) -> list[str]:
    score: dict[str, float] = defaultdict(float)
    for ranked in rankings:
        for pos, c in enumerate(ranked[:depth]):
            score[c] += 1 / (60 + pos)
    return [c for c, _ in sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))]


def boot_ci(values: list[float], n: int = 1000, seed: int = 0) -> tuple[int, int]:
    rng = random.Random(seed)
    k = len(values)
    means = sorted(sum(values[rng.randrange(k)] for _ in range(k)) / k for _ in range(n))
    return round(100 * means[int(0.025 * n)]), round(100 * means[int(0.975 * n)])


def summarize(rows: list[dict]) -> dict:
    groups = {"all": lambda r: True, "sv": lambda r: r["lang"] == "sv", "en": lambda r: r["lang"] == "en",
              "word list gets every answer right": lambda r: r["ok"], "word list misses something": lambda r: not r["ok"]}
    out = {}
    for name, sel in groups.items():
        part = [r for r in rows if sel(r)]
        if not part:
            out[name] = {"n": 0}
            continue
        d = {"n": len(part)}
        for k in ("l1", "l3", "l5", "s1", "s5"):
            d[k] = round(100 * sum(r["r"][k] for r in part) / len(part))
        if name == "all":
            d["l1_ci"] = boot_ci([r["r"]["l1"] for r in part])
            d["l5_ci"] = boot_ci([r["r"]["l5"] for r in part])
        out[name] = d
    return out


def step1(gold: list[dict], universe: list[list], use_biolord: bool) -> dict:
    texts_names, codes_names = [], []
    for code, en, sv, _topic in universe:
        for t in (en, sv):
            if t:
                texts_names.append(t)
                codes_names.append(code)
    ext = lexicon_extract([g["text"] for g in gold])
    rest = [e["rest"] for e in ext]
    ok = [all(e["values"].get(s) == g["slots"].get(s) for s in SLOTS) for e, g in zip(ext, gold)]
    queries = {"full phrase": [g["text"] for g in gold], "text left after the word list": rest}
    sims: dict[tuple[str, str], np.ndarray] = {}
    timing = {}
    for label, name in [("EmbeddingGemma 2", EG2)] + ([("BioLORD-2023-M", BIOLORD)] if use_biolord else []):
        t0 = time.time()
        m = load(name)
        dn = encode(m, name, texts_names, "document")
        for qkind, qs in queries.items():
            sims[(label, qkind)] = encode(m, name, qs, "query") @ dn.T
        timing[label] = round(time.time() - t0, 1)
        del m
    results = defaultdict(list)
    for i, g in enumerate(gold):
        base = {"lang": g["lang"], "ok": ok[i]}
        rk = {}
        for qkind, qs in queries.items():
            rk[("word overlap only (no server)", qkind)] = rank_codes(np.array([lex_score(qs[i], t) for t in texts_names]), codes_names, texts_names, True)
        for (label, qkind), s in sims.items():
            rk[(label, qkind)] = rank_codes(s[i], codes_names, texts_names)
        for (label, qkind), r in rk.items():
            results[f"{label}, {qkind}"].append({**base, "r": hits(r, g["finding"])})
        q = "text left after the word list"
        results["fusion: word overlap + EmbeddingGemma 2, text left"].append({**base, "r": hits(fuse(rk[("word overlap only (no server)", q)], rk[("EmbeddingGemma 2", q)]), g["finding"])})
        if use_biolord:
            results["fusion: word overlap + BioLORD-2023-M, text left"].append({**base, "r": hits(fuse(rk[("word overlap only (no server)", q)], rk[("BioLORD-2023-M", q)]), g["finding"])})
            results["fusion: BioLORD-2023-M + EmbeddingGemma 2, text left"].append({**base, "r": hits(fuse(rk[("BioLORD-2023-M", q)], rk[("EmbeddingGemma 2", q)]), g["finding"])})
    return {"timing_s": timing, "n_names": len(texts_names), "accepts_two_concepts": sum(len(g["finding"]) > 1 for g in gold),
            "word_list_gets_every_answer_right": sum(ok), "methods": {k: summarize(v) for k, v in results.items()}}


# ---------------------------------------------------------------- step 2
def tokens(text: str) -> list[str]:
    return re.findall(r"[\wåäöÅÄÖ']+", text.lower())


def spans(text: str, nmax: int = 3) -> list[str]:
    """Every run of 1-3 words, except runs that start or end with a filler word."""
    ws = tokens(text)
    out = []
    for n in range(1, nmax + 1):
        for i in range(len(ws) - n + 1):
            part = ws[i:i + n]
            if part[0] in STOP or part[-1] in STOP:
                continue
            out.append(" ".join(part))
    return out


def option_strings(snap: dict, slots: list[str], full: bool) -> list[tuple[str, str, str]]:
    """[(slot, code, text)] for every answer option in the given slots (the quick ones, or all the snapshot offers)."""
    cfg, out = snap["cfg"], []
    for slot in slots:
        sl = cfg["slots"][slot]
        codes = [o["code"] for o in snap["options"][slot]] if full else list(sl["quick"]) + [c for c in sl.get("more", []) if c not in sl["quick"]]
        for c in codes:
            lab = snap["labels"][c]
            for t in (lab["en"], lab.get("sv")):
                if t:
                    out.append((slot, c, t))
                    short = re.sub(r"\b(pain|severity|onset|smärt\w*|debut\w*)\b", "", t, flags=re.I).strip()
                    if short and short != t:
                        out.append((slot, c, short))
    return out


def fill_by_embedding(model, texts: list[str], opts: list[tuple], tau: float, delta: float) -> list[dict]:
    ov = encode(model, EG2, [o[2] for o in opts], "sts")
    result = []
    for text in texts:
        sp = spans(text)
        if not sp:
            result.append({})
            continue
        sims = encode(model, EG2, sp, "sts") @ ov.T  # spans x options
        cand = []  # (score, slot, code, span)
        for slot in sorted({o[0] for o in opts}):
            idx = [j for j, o in enumerate(opts) if o[0] == slot]
            by_code: dict[str, np.ndarray] = {}
            for j in idx:
                by_code[opts[j][1]] = np.maximum(by_code.get(opts[j][1], -9), sims[:, j])
            codes = list(by_code)
            mat = np.stack([by_code[c] for c in codes], axis=1)  # spans x codes
            for si in range(len(sp)):
                order = np.argsort(-mat[si])
                top = mat[si][order[0]]
                second = mat[si][order[1]] if len(order) > 1 else -9
                if top >= tau and (top - second) >= delta:
                    cand.append((float(top), slot, codes[order[0]], sp[si]))
        cand.sort(reverse=True)
        taken, used, values = set(), set(), {}
        for score, slot, code, span in cand:
            ws = {w for w in span.split() if w not in STOP}  # filler words do not block a later span
            if slot in taken or ws & used:
                continue
            taken.add(slot)
            used |= ws
            values[slot] = code
        result.append(values)
    return result


def counts(gold: list[dict], preds: list[dict], idx: list[int]) -> tuple[int, int, int]:
    tp = fp = fn = 0
    for i in idx:
        g, p = gold[i]["slots"], preds[i]
        for slot in set(g) | set(p):
            want, got = g.get(slot), p.get(slot)
            if got is not None and got == want:
                tp += 1
            else:
                fp += got is not None
                fn += want is not None
    return tp, fp, fn


def prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "precision": round(100 * p), "recall": round(100 * r), "f1": round(100 * 2 * p * r / (p + r)) if p + r else 0}


def f1_ci(gold: list[dict], preds: list[dict], n: int = 1000, seed: int = 0) -> tuple[int, int]:
    rng = random.Random(seed)
    k = len(gold)
    vals = []
    for _ in range(n):
        idx = [rng.randrange(k) for _ in range(k)]
        vals.append(prf(*counts(gold, preds, idx))["f1"])
    vals.sort()
    return vals[int(0.025 * n)], vals[int(0.975 * n)]


def step2(gold: list[dict], snap: dict) -> dict:
    n = len(gold)
    everyone = list(range(n))
    folds = [[i for i in everyone if i % 2 == 0], [i for i in everyone if i % 2 == 1]]
    ext = lexicon_extract([g["text"] for g in gold])
    lex = [{k: v for k, v in e["values"].items() if k in SLOTS} for e in ext]
    wrong = [i for i in everyone if lex[i] != gold[i]["slots"]]
    m = load(EG2)
    texts = [g["text"] for g in gold]
    configs = {}  # name -> (embedding predictions, combined predictions)
    for full in (False, True):
        opts = option_strings(snap, SLOTS, full)
        for tau, delta in [(t, d) for t in (0.84, 0.88, 0.90, 0.92, 0.94, 0.96) for d in (0.02, 0.05)]:
            emb = fill_by_embedding(m, texts, opts, tau, delta)
            configs[f"{'all snapshot options' if full else 'the quick options'}, threshold {tau:.2f}, margin {delta:.2f}"] = (emb, [{**e, **l} for e, l in zip(emb, lex)])
    out = {"n_options_quick": len(option_strings(snap, SLOTS, False)), "n_options_all": len(option_strings(snap, SLOTS, True)),
           "phrases_where_the_word_list_is_not_exactly_right": len(wrong), "methods": {}}
    out["methods"]["word list (the app)"] = {"all": {**prf(*counts(gold, lex, everyone)), "f1_ci": f1_ci(gold, lex)},
                                              "word list misses something": prf(*counts(gold, lex, wrong))}
    # 2-fold: choose the settings on one half, score them on the other half; every phrase is scored by settings chosen without it
    for which, label in ((0, "EmbeddingGemma 2 alone"), (1, "word list first, then EmbeddingGemma 2")):
        tot = [0, 0, 0]
        tot_wrong = [0, 0, 0]
        chosen = []
        merged: list[dict] = [dict() for _ in range(n)]
        for a, b in ((0, 1), (1, 0)):
            best = max(configs, key=lambda c: prf(*counts(gold, configs[c][which], folds[a]))["f1"])
            chosen.append(best)
            for i in folds[b]:
                merged[i] = configs[best][which][i]
        tot = counts(gold, merged, everyone)
        tw = counts(gold, merged, wrong)
        out["methods"][f"{label}: settings chosen on one half, scored on the other"] = {"all": {**prf(*tot), "f1_ci": f1_ci(gold, merged)}, "word list misses something": prf(*tw), "chosen": chosen}
    for cname, (emb, comb) in configs.items():  # the whole grid, optimistic: chosen on the phrases it is scored on
        out["methods"][f"[optimistic] EmbeddingGemma 2 alone: {cname}"] = {"all": prf(*counts(gold, emb, everyone)), "word list misses something": prf(*counts(gold, emb, wrong))}
        out["methods"][f"[optimistic] word list first, then EmbeddingGemma 2: {cname}"] = {"all": prf(*counts(gold, comb, everyone)), "word list misses something": prf(*counts(gold, comb, wrong))}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    ap.add_argument("--no-biolord", action="store_true")
    a = ap.parse_args()
    snap = json.loads((ROOT / "web/data/snapshot.json").read_text(encoding="utf8"))
    gold = json.loads((ROOT / "tests/fixtures/gold-two-step.json").read_text(encoding="utf8"))["items"]
    res = {"n_phrases": len(gold), "step1": step1(gold, snap["universe"], not a.no_biolord), "step2": step2(gold, snap)}
    text = json.dumps(res, indent=1, ensure_ascii=False)
    if a.out:
        Path(a.out).write_text(text, encoding="utf8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
