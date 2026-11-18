"""Build the public static site into OUTDIR (for GitHub Pages).

  python tools/build_site.py OUTDIR

The site contains NO SNOMED CT content: no snapshot, no labels. data/config.json is only our configuration (concept ids,
ECL, synonym lists). At run time the visitor's browser asks the terminology server directly (web/txclient.js).
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
(out / "data").mkdir(exist_ok=True)
(out / "vendor").mkdir(exist_ok=True)

for f in ["index.html", "style.css", "app.js", "extract.js", "generators.js", "lexrank.js", "bodymap.js", "txclient.js"]:
    shutil.copy(ROOT / "web" / f, out / f)
shutil.copy(ROOT / "web" / "vendor" / "bodypaths.js", out / "vendor" / "bodypaths.js")
shutil.copy(ROOT / "backend" / "topics.json", out / "data" / "config.json")
shutil.copy(ROOT / "THIRD_PARTY_NOTICES.md", out / "THIRD_PARTY_NOTICES.md")
(out / ".nojekyll").write_text("", encoding="utf8")  # serve files as they are

snap = out / "data" / "snapshot.json"
assert not snap.exists(), "a snapshot must never be part of the public site"
print("site written to", out, "->", sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file()))
