"""Write tests/fixtures/labels.json: NEUTRAL test labels in our own words, keyed by the real SNOMED CT ids.

The unit tests need some display strings for the ids in backend/topics.json. They must not be copies of SNOMED CT terms,
so these are our own paraphrases ("abrupt start", not SNOMED's wording). The e2e tests use real data at run time.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
cfg = json.loads((ROOT / "backend" / "topics.json").read_text(encoding="utf8"))

L = {  # code: (en, sv or None)
    "7771000": ("left", "vänster"), "24028007": ("right", "höger"), "51440002": ("both", "båda"),
    "255604002": ("mild", "lindrig"), "6736007": ("moderate", "måttlig"), "24484000": ("severe", "svår"),
    "385315009": ("abrupt start", "abrupt start"), "61751001": ("slow start", "långsam start"), "1384228004": ("fast start", None),
    "7087005": ("on and off", "av och till"), "255238004": ("constant", "konstant"), "229803000": ("one episode", "en episod"),
    "3442003": ("improving", "bättre"), "260388006": ("unchanged", "oförändrad"), "231877006": ("worsening", "förvärras"),
    "27635008": ("achy", "värkande"), "83644001": ("dull ache", "molande värk"), "29695002": ("pounding", "bultande"), "36349006": ("burning", "brännande"),
    "37378003": ("soft", "mjuk"), "20583004": ("firm", "fast"), "72505002": ("hard", "hård"),
}
codes = set()
for s in cfg["slots"].values():
    codes.update(s.get("quick", []) + s.get("more", []))
codes.update(u["code"] for u in cfg["units"])
codes.update(cfg["meta"]["attributes"].values())
out = {}
for c in sorted(codes):
    en, sv = L.get(c, (f"test concept {c}", None))
    out[c] = {"en": en, "sv": sv}
(ROOT / "tests" / "fixtures" / "labels.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf8")
print(len(out), "neutral labels;", sum(1 for c in out if c not in L), "unnamed ids get 'test concept <id>'")
