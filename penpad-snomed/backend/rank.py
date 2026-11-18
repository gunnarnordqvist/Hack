"""Candidate finder: free text -> SNOMED CT findings, three layers.

1. baseline   server text filter (English core + Swedish module) and fuzzy token matching on the
              terms of the topic value sets. Deterministic, needs no model.
2. re-rank    optional local embedding model (BioLORD-2023-M by default) orders the same candidates.
3. (not here) a generative model is never used: no component of this project can invent a code.

Every code returned comes from the terminology server (an ECL expansion), never from a model.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path

from tx import Tx, finding_site

ROOT = Path(__file__).resolve().parent
MODEL = os.environ.get("PENPAD_MODEL", "FremyCompany/BioLORD-2023-M")
LOW_CONFIDENCE = float(os.environ.get("PENPAD_LOW_CONF", "0.62"))

STOP = {
    "i", "på", "av", "och", "en", "ett", "med", "om", "har", "jag", "min", "mitt", "mina", "det", "den", "är",
    "the", "in", "of", "a", "an", "my", "i", "have", "has", "is", "and", "with", "on", "at", "to",
}


def norm(t: str) -> str:
    t = unicodedata.normalize("NFC", t.lower())
    return re.sub(r"[^\w\s]", " ", t)


def stems(t: str) -> list[str]:
    out = []
    for w in norm(t).split():
        if w in STOP or len(w) < 2:
            continue
        out.append(w[:5])
    return out


def lex_score(q: str, name: str) -> float:
    qs, ns = stems(q), stems(name)
    if not qs or not ns:
        return 0.0
    qset, nset = set(qs), set(ns)
    inter = qset & nset
    if not inter:
        return 0.0
    recall = len(inter) / len(qset)
    precision = len(inter) / len(nset)
    return 2 * recall * precision / (recall + precision)


class Ranker:
    def __init__(self, tx: Tx, cfg: dict, embeddings: bool = True, model: str = MODEL):
        self.tx, self.cfg = tx, cfg
        self.universe: dict[str, dict] = {}
        for t in cfg["topics"]:
            en = {c["code"]: c["display"] for c in tx.expand_all(t["ecl"], lang="en")}
            sv = {c["code"]: c["display"] for c in tx.expand_all(t["ecl"], lang="sv")}
            for code in set(en) | set(sv):
                e = en.get(code) or sv.get(code)
                s = sv.get(code)
                self.universe[code] = {"code": code, "en": e, "sv": s if s and s != e else None, "topic": t["id"]}
        self.names: list[tuple[str, str]] = []  # (code, text)
        for c in self.universe.values():
            self.names.append((c["code"], c["en"]))
            if c["sv"]:
                self.names.append((c["code"], c["sv"]))
        self.model_name = model
        self.model = None
        self.emb = None
        if embeddings:
            self._load_model()

    # -- embeddings --------------------------------------------------------------------------
    def _load_model(self):
        try:
            import numpy as np
            from sentence_transformers import SentenceTransformer
        except Exception as e:  # sentence-transformers missing: baseline only
            print(f"[rank] embeddings unavailable: {e}")
            return
        self.np = np
        self.model = SentenceTransformer(self.model_name, device="cpu")
        key = hashlib.sha1((self.model_name + "|".join(t for _, t in self.names)).encode()).hexdigest()[:16]
        f = ROOT / f"embeddings-{key}.npy"
        if f.exists():
            self.emb = np.load(f)
        else:
            self.emb = self.model.encode([t for _, t in self.names], batch_size=64, normalize_embeddings=True)
            np.save(f, self.emb)

    @property
    def has_model(self) -> bool:
        return self.model is not None

    # -- ranking -----------------------------------------------------------------------------
    def server_hits(self, q: str) -> set[str]:
        hits: set[str] = set()
        for t in self.cfg["topics"]:
            for lang in ("en", "sv"):
                try:
                    d = self.tx.expand(t["ecl"], filter=q, lang=lang, count=30)
                except Exception:
                    continue
                hits.update(c["code"] for c in d.get("expansion", {}).get("contains", []))
        return hits

    def candidates(self, q: str, mode: str = "rerank", k: int = 5) -> dict:
        q = (q or "").strip()
        if not q:
            return {"query": q, "mode": mode, "items": [], "low_confidence": True, "model": None}
        use_emb = mode == "rerank" and self.has_model
        hits = self.server_hits(q)
        best: dict[str, dict] = {}
        lex_by_code: dict[str, float] = {}
        for (code, text) in self.names:
            s = lex_score(q, text)
            if s > lex_by_code.get(code, 0):
                lex_by_code[code] = s
        emb_by_code: dict[str, float] = {}
        if use_emb:
            qe = self.model.encode([q], normalize_embeddings=True)[0]
            sims = self.emb @ qe
            for i, (code, _) in enumerate(self.names):
                v = float(sims[i])
                if v > emb_by_code.get(code, -1):
                    emb_by_code[code] = v
        for code, c in self.universe.items():
            lex = lex_by_code.get(code, 0.0)
            emb = emb_by_code.get(code)
            hit = code in hits
            # A server filter that matches few concepts is strong evidence; one that matches hundreds is not.
            boost = min(0.3, 0.3 / max(1, len(hits))) if hit else 0.0
            if use_emb:
                score = max(0.0, emb) + 0.08 * lex + boost
            else:
                score = lex + (0.25 if hit else 0.0) + boost
            if score <= 0:
                continue
            best[code] = {**c, "score": round(score, 4), "confidence": round(min(1.0, score), 3),
                          "scores": {"filter": hit, "lex": round(lex, 3),
                                     "emb": None if emb is None else round(emb, 3)}}
        items = sorted(best.values(), key=lambda x: -x["score"])[:k]
        for r, it in enumerate(items, 1):
            it["rank"] = r
        thr = LOW_CONFIDENCE if use_emb else 0.45
        low = not items or items[0]["score"] < thr
        return {"query": q, "mode": "rerank" if use_emb else "text", "items": items, "low_confidence": low,
                "threshold": thr, "model": self.model_name if use_emb else None}

    # -- detail for a chosen concept -----------------------------------------------------------
    def detail(self, code: str) -> dict:
        en = self.tx.lookup(code, "en")
        sv = self.tx.lookup(code, "sv")
        base = self.universe.get(code, {})
        site = finding_site(en.get("normalForm"))
        site_d = None
        if site:
            s_en = self.tx.lookup(site[0], "en")
            s_sv = self.tx.lookup(site[0], "sv")
            site_d = {
                "code": site[0],
                "en": s_en.get("display") or site[1],
                "sv": s_sv.get("display") if s_sv.get("display") != s_en.get("display") else None,
                "lateralizable": self.tx.in_refset(site[0], self.cfg["meta"]["refsets"]["lateralizable"]),
            }
        return {
            "code": code, "en": en.get("display"), "sv": sv.get("display") if sv.get("display") != en.get("display") else None,
            "topic": base.get("topic"), "site": site_d, "normalForm": en.get("normalForm"),
            "version": en.get("version"),
        }
