"""Small labelled check of the candidate finder (our own labels, 14 phrases, NOT a benchmark).

Compares the baseline (server text filter + fuzzy) with embedding re-ranking on the same phrases.
Gold codes are SNOMED CT concepts judged correct by the author; several phrases accept more than one.
Writes docs/eval-candidates.json and prints a table.
"""
import json
import sys
from pathlib import Path

from rank import Ranker
from tx import Tx

GOLD = [
    ("smärta i tumme", {"300955002"}),
    ("ont i tummen", {"300955002"}),
    ("my thumb hurts", {"300955002"}),
    ("svullen tumme", {"314916002"}),
    ("buksmärta", {"21522001"}),
    ("magont", {"271681002"}),
    ("huvudvärk", {"25064002"}),
    ("headache", {"25064002"}),
    ("ont i halsen", {"267102003", "162397003"}),
    ("ryggont", {"161891005"}),
    ("knäsmärta", {"1003722009", "1003721002"}),
    ("swollen ankle", {"267039000", "299414004"}),
    ("bröstsmärta", {"29857009"}),
    ("svullnad i vänster fot", {"762916009", "10678471000119104"}),
]


def main():
    cfg = json.load(open(Path(__file__).with_name("topics.json")))
    r = Ranker(Tx(), cfg, embeddings=True)
    rows = []
    for q, gold in GOLD:
        row = {"query": q, "gold": sorted(gold)}
        for mode in ("text", "rerank"):
            d = r.candidates(q, mode, 5)
            codes = [i["code"] for i in d["items"]]
            rank = next((i + 1 for i, c in enumerate(codes) if c in gold), None)
            row[mode] = {"rank": rank, "low_confidence": d["low_confidence"],
                         "top": [(i["code"], i["sv"] or i["en"], i["score"]) for i in d["items"][:3]]}
        rows.append(row)
    n = len(rows)
    summary = {}
    for mode in ("text", "rerank"):
        h1 = sum(1 for x in rows if x[mode]["rank"] == 1)
        h3 = sum(1 for x in rows if x[mode]["rank"] and x[mode]["rank"] <= 3)
        h5 = sum(1 for x in rows if x[mode]["rank"])
        summary[mode] = {"hit@1": h1, "hit@3": h3, "hit@5": h5, "n": n}
    print(f"{'query':28} {'text':>6} {'rerank':>7}  rerank top-1")
    for x in rows:
        t = x["text"]["rank"] or "-"
        rr = x["rerank"]["rank"] or "-"
        top = x["rerank"]["top"][0]
        print(f"{x['query']:28} {t!s:>6} {rr!s:>7}  {top[1]} [{top[0]}] {top[2]}{' LOW' if x['rerank']['low_confidence'] else ''}")
    print(json.dumps(summary))
    out = Path(__file__).resolve().parent.parent / "docs" / "eval-candidates.json"
    out.write_text(json.dumps({"note": "own labels, 14 phrases, not a benchmark", "model": r.model_name,
                               "summary": summary, "rows": rows}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    sys.exit(main())
