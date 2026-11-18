"""Build the public static site into OUTDIR (for GitHub Pages).

  python tools/build_site.py OUTDIR

The site contains NO SNOMED CT content: no snapshot, no labels. data/config.json is only our configuration (concept ids,
ECL, synonym lists). At run time the visitor's browser asks the terminology server directly (web/txclient.js).
"""
import datetime
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
(out / "data").mkdir(exist_ok=True)
(out / "vendor").mkdir(exist_ok=True)

# every top-level web file (index.html, style.css and all .js modules): a hand-written list once missed a new module
for f in sorted((ROOT / "web").iterdir()):
    if f.is_file():
        shutil.copy(f, out / f.name)
shutil.copy(ROOT / "web" / "vendor" / "bodypaths.js", out / "vendor" / "bodypaths.js")
shutil.copy(ROOT / "backend" / "topics.json", out / "data" / "config.json")
shutil.copy(ROOT / "THIRD_PARTY_NOTICES.md", out / "THIRD_PARTY_NOTICES.md")
(out / ".nojekyll").write_text("", encoding="utf8")  # serve files as they are

# which version is online: commit of the source and build time
try:
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
except Exception:
    commit = "unknown"
(out / "version.json").write_text(json.dumps({"commit": commit, "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}), encoding="utf8")

snap = out / "data" / "snapshot.json"
assert not snap.exists(), "a snapshot must never be part of the public site"
print("site written to", out, "->", sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file()))
