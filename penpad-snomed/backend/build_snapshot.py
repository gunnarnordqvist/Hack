"""Build web/data/snapshot.json: everything the static demo needs, taken from the terminology server.

  python build_snapshot.py            # needs network once; later runs use the disk cache
  PENPAD_OFFLINE=1 python build_snapshot.py   # rebuild from the cache only

Contents: verified config, labels (en + sv), slot options, the concept universe with finding site and
laterality, sample inputs with precomputed candidates (baseline and embedding re-rank).
The build FAILS if any configured code is inactive or outside its slot's ECL value set.
"""
from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from rank import Ranker
from tx import SWEDEN_MODULE, Tx, finding_site
from verify_topics import verify

ROOT = Path(__file__).resolve().parent.parent
CFG = ROOT / "backend" / "topics.json"
OUT = ROOT / "web" / "data" / "snapshot.json"

SAMPLES = [
    "smärta i vänster tumme sedan två dagar, bultande, måttlig, plötslig debut, sämre",
    "my thumb hurts, left, since yesterday",
    "svullen höger fot sedan en vecka, hård",
    "buksmärta sedan tre dagar, intermittent",
    "headache since two days, severe, throbbing",
    "ont i halsen sedan igår",
    "magont",
]


def slot_options(tx: Tx, cfg: dict, labels: dict) -> dict:
    """Quick options first, then up to `limit` more from the slot's ECL expansion (server order)."""
    out = {}
    for name, s in cfg["slots"].items():
        if s.get("kind") == "duration":
            continue
        codes = list(s["quick"]) + [c for c in s.get("more", []) if c not in s["quick"]]
        extra = []
        if s.get("limit"):
            en = {c["code"]: c["display"] for c in tx.expand_all(s["ecl"], lang="en")}
            sv = {c["code"]: c["display"] for c in tx.expand_all(s["ecl"], lang="sv")}
            for c in sorted(en, key=lambda k: en[k].lower()):
                if c not in codes and len(extra) < s["limit"]:
                    extra.append(c)
                    labels.setdefault(c, {"en": en[c], "sv": sv.get(c) if sv.get(c) != en[c] else None})
        out[name] = [{"code": c, "quick": c in s["quick"]} for c in codes + extra]
    return out


def universe_details(tx: Tx, cfg: dict, ranker: Ranker) -> dict:
    """finding site and laterality for every concept in the universe (parallel, cached)."""
    refset = cfg["meta"]["refsets"]["lateralizable"]
    site_cache: dict[str, dict] = {}

    def site(code: str, en_name: str):
        if code not in site_cache:
            e, s = tx.lookup(code, "en"), tx.lookup(code, "sv")
            site_cache[code] = {
                "code": code, "en": e.get("display") or en_name,
                "sv": s.get("display") if s.get("display") != e.get("display") else None,
                "lateralizable": tx.in_refset(code, refset),
            }
        return site_cache[code]

    def one(code: str):
        d = tx.lookup(code, "en")
        fs = finding_site(d.get("normalForm"))
        return code, fs, d.get("version")

    out, versions = {}, set()
    with ThreadPoolExecutor(8) as ex:
        rows = list(ex.map(one, ranker.universe.keys()))
    uniq = {fs[0]: fs[1] for _, fs, _ in rows if fs}
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda kv: site(kv[0], kv[1]), uniq.items()))
    for code, fs, ver in rows:
        out[code] = site_cache[fs[0]] if fs else None
        if ver:
            versions.add(ver)
    return out, sorted(versions)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-model", action="store_true", help="skip embedding re-rank for the samples")
    a = ap.parse_args()
    cfg = json.loads(CFG.read_text(encoding="utf8"))
    tx = Tx()

    report, problems, labels = verify(tx, cfg)
    if problems:
        print("\n".join(" - " + p for p in problems))
        sys.exit("config verification failed")
    print(f"config verified: {len(report)} checks")

    options = slot_options(tx, cfg, labels)
    ranker = Ranker(tx, cfg, embeddings=not a.no_model)
    print(f"universe: {len(ranker.universe)} concepts, model={ranker.has_model}")
    details, versions = universe_details(tx, cfg, ranker)
    with_site = sum(1 for v in details.values() if v)
    print(f"details: {with_site}/{len(details)} concepts have a finding site")

    # free-text reader runs in node so the samples go through the exact browser code
    lab_file = ROOT / "cache" / "labels-for-extract.json"
    lab_file.parent.mkdir(exist_ok=True)
    lab_file.write_text(json.dumps({c: {"en": l["en"], "sv": l["sv"] if l["sv"] != l["en"] else None} for c, l in labels.items()}))
    ex = json.loads(subprocess.run(["node", str(ROOT / "web/tools/extract_cli.mjs"), str(lab_file)],
                                   input=json.dumps(SAMPLES), capture_output=True, text=True, check=True).stdout)
    samples = []
    for text, e in zip(SAMPLES, ex):
        cand = {m: ranker.candidates(e["rest"] or text, m, 5) for m in (["text", "rerank"] if ranker.has_model else ["text"])}
        samples.append({"text": text, "extract": e, "candidates": cand})

    labels_out = {c: {"en": l["en"], "sv": l["sv"] if l["sv"] != l["en"] else None} for c, l in labels.items()}
    for code, u in ranker.universe.items():
        labels_out.setdefault(code, {"en": u["en"], "sv": u["sv"]})
    ev = ROOT / "docs" / "eval-candidates.json"
    snapshot = {
        "meta": {
            "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "server": tx.base, "swedenModule": SWEDEN_MODULE, "coreVersions": versions[:3],
            "model": ranker.model_name if ranker.has_model else None,
            "universe": len(ranker.universe), "note": "SNOMED CT content via a FHIR terminology server; see README for licence notes",
        },
        "cfg": cfg,
        "labels": labels_out,
        "options": options,
        "universe": [[u["code"], u["en"], u["sv"], u["topic"]] for u in ranker.universe.values()],
        "details": details,
        "samples": samples,
        "eval": json.loads(ev.read_text())["summary"] if ev.exists() else None,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB); tx calls={tx.calls} cache hits={tx.hits}")


if __name__ == "__main__":
    main()
