"""Bundle the web app into one HTML fragment (inline CSS + one inline module) plus data/snapshot.json.

  python tools/make_artifact.py OUTDIR

Writes OUTDIR/index.html (a fragment: no doctype/html/head/body, as the Artifact publisher wants),
OUTDIR/_test.html (the same wrapped in a normal document, for a local browser test) and OUTDIR/data/snapshot.json.
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
out = Path(sys.argv[1])
(out / "data").mkdir(parents=True, exist_ok=True)

def strip_modules(src: str) -> str:
    src = re.sub(r'^import\s+[^;]*?from\s+"[^"]+";\s*$', "", src, flags=re.M)
    src = re.sub(r"^export\s+(async\s+)?(function|const|let)\b", r"\1\2", src, flags=re.M)
    return src

js = "\n".join(strip_modules((WEB / f).read_text(encoding="utf8")) for f in ["extract.js", "generators.js", "lexrank.js", "app.js"])
css = (WEB / "style.css").read_text(encoding="utf8")
body = """<main class="app">
  <header id="hdr"></header>
  <section id="input" class="card"></section>
  <section id="cands" class="card"></section>
  <div class="two">
    <section id="form" class="card"></section>
    <section id="confirm" class="card"></section>
  </div>
  <section id="outputs" class="card"></section>
  <footer><p id="foot"></p></footer>
</main>"""
head = """<title>PEN&amp;PAD Smart Forms</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap">
<style>
""" + css + "\n</style>\n"
frag = head + body + '\n<script type="module">\n' + js + "\n</script>\n"
(out / "index.html").write_text(frag, encoding="utf8")
(out / "_test.html").write_text('<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
                                + frag.replace("</style>\n<main", "</style>\n</head><body><main", 1).replace("</script>\n", "</script></body></html>\n") , encoding="utf8")
shutil.copy(WEB / "data" / "snapshot.json", out / "data" / "snapshot.json")
print("wrote", out / "index.html", f"({len(frag)/1024:.0f} KB)")
