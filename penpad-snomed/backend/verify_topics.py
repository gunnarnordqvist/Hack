"""Verify topics.json against the terminology server.

For every slot: each code must be an active SNOMED CT concept and a member of the slot's ECL value set.
Prints a report and exits non-zero on any problem. Importable: verify(tx, cfg) -> (report_lines, problems, labels).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from tx import Tx

CFG = Path(__file__).with_name("topics.json")


def all_codes(cfg: dict) -> set[str]:
    codes: set[str] = set()
    for s in cfg["slots"].values():
        codes.update(s.get("quick", []))
        codes.update(s.get("more", []))
    codes.update(u["code"] for u in cfg["units"])
    codes.update(cfg["meta"]["attributes"].values())
    codes.update(t["focus"] for t in cfg["topics"])
    codes.add(cfg["meta"]["refsets"]["lateralizable"])
    return codes


def labels_for(tx: Tx, codes) -> dict[str, dict[str, str | None]]:
    out = {}
    for c in sorted(codes):
        en = tx.lookup(c, "en")
        sv = tx.lookup(c, "sv")
        out[c] = {"en": en.get("display"), "sv": sv.get("display"), "inactive": bool(en.get("inactive"))}
    return out


def verify(tx: Tx, cfg: dict):
    report, problems = [], []
    labels = labels_for(tx, all_codes(cfg))
    for c, l in labels.items():
        if not l["en"]:
            problems.append(f"{c}: unknown concept")
        if l["inactive"]:
            problems.append(f"{c} {l['en']}: concept is inactive")
    for name, s in cfg["slots"].items():
        if s.get("kind") == "duration":
            continue
        for c in s.get("quick", []) + s.get("more", []):
            r = tx.validate(c, s["ecl"])
            ok = r["ok"]
            report.append(f"{'ok ' if ok else 'BAD'} slot {name:12} {c:>11} {labels[c]['en']!s:28} sv={labels[c]['sv']!s:22} in [{s['ecl']}]")
            if not ok:
                problems.append(f"slot {name}: {c} ({labels[c]['en']}) not in ECL '{s['ecl']}'")
    for t in cfg["topics"]:
        n = len(tx.expand_all(t["ecl"]))
        report.append(f"ok  topic {t['id']:9} focus {t['focus']} {labels[t['focus']]['en']} -> {n} concepts in [{t['ecl']}]")
        if n == 0:
            problems.append(f"topic {t['id']}: empty ECL")
        for sname in t["slots"]:
            if sname not in cfg["slots"]:
                problems.append(f"topic {t['id']}: unknown slot {sname}")
    for u in cfg["units"]:
        report.append(f"ok  unit {u['key']:7} {u['code']:>11} {labels[u['code']]['en']}")
    return report, problems, labels


if __name__ == "__main__":
    cfg = json.loads(CFG.read_text())
    rep, probs, _ = verify(Tx(), cfg)
    print("\n".join(rep))
    if probs:
        print("\nPROBLEMS:")
        print("\n".join(" - " + p for p in probs))
        sys.exit(1)
    print("\nall checks passed")
