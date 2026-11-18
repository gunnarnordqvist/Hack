"""Build web/vendor/bodypaths.js from the MIT-licensed `react-body-map` npm package.

  npm pack react-body-map@1.1.0 && mkdir rbm && tar -xzf react-body-map-1.1.0.tgz -C rbm
  python tools/build_body_paths.py rbm web/vendor/bodypaths.js

The package files are read as TEXT (nothing from the package is executed). Bounding boxes are measured in a browser
(tools/bbox_parts.cjs, needs Playwright). Which side a part is on follows the slug and is checked against geometry.
Licence chain (see THIRD_PARTY_NOTICES.md): react-native-body-highlighter (MIT, ELABBASSI Hicham, 2022)
 -> react-body-highlighter (MIT, GV79, 2020) -> react-body-map (MIT per package.json).
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

pkg = Path(sys.argv[1]) / "package" / "dist"
out = Path(sys.argv[2])
HERE = Path(__file__).resolve().parent


def read_parts(file: Path):
    t = file.read_text(encoding="utf8")
    res = []
    for m in re.finditer(r'slug:\s*"([^"]+)".*?pathArray:\s*\[(.*?)\]\s*,?\s*\}', t, re.S):
        res.append({"slug": m.group(1), "paths": re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(2))})
    return res


parts = {"front": read_parts(pkg / "assets" / "bodyFront.js"), "back": read_parts(pkg / "assets" / "bodyBack.js")}
wrapper = (pkg / "components" / "SvgMaleWrapper.js").read_text(encoding="utf8")
outline = re.findall(r'd:\s*"([^"]+)"', wrapper)
assert len(outline) == 2, "expected a front and a back outline"

with tempfile.TemporaryDirectory() as tmp:
    pj, bj = Path(tmp) / "parts.json", Path(tmp) / "bbox.json"
    pj.write_text(json.dumps(parts))
    subprocess.run(["node", str(HERE / "bbox_parts.cjs"), str(pj), str(bj)], check=True)
    bbox = json.loads(bj.read_text())

# slug prefix -> our region id (our regions are SNOMED CT body structures, see backend/topics.json)
RULES = [
    ("head-", "head"), ("neck-", "neck"), ("chest-", "chest"), ("abs-", "abdomen"), ("obliques-", "abdomen"),
    ("deltoids-", "shoulder"), ("biceps-", "upperarm"), ("triceps-", "upperarm"), ("forearm-", "forearm"),
    ("hands-", "hand"), ("quadriceps-", "thigh"), ("adductors-", "thigh"), ("hamstring-", "thigh"),
    ("knees-", "knee"), ("tibialis-", "lowerleg"), ("calves-", "lowerleg"), ("ankles-", "ankle"), ("feet-", "foot"),
    ("upper-back-", "back"), ("lower-back-", "back"), ("hips-", "hip"), ("gluteal-", "buttock"),
]
SIDED = {"shoulder", "upperarm", "forearm", "hand", "thigh", "knee", "lowerleg", "ankle", "foot", "hip", "buttock"}


def region_of(slug: str, view: str):
    if slug.startswith("trapezius-"):
        return "neck" if view == "front" else "back"
    for pre, r in RULES:
        if slug.startswith(pre):
            return r
    raise SystemExit(f"no rule for {slug}")


def side_of(slug: str):
    return "left" if "-left" in slug or slug.endswith("left") else "right" if "-right" in slug or slug.endswith("right") else None


# check the naming against geometry: patient's left is on the viewer's right in front, on the viewer's left in back
centre = {"front": 362.0, "back": 1086.0}
for view in ("front", "back"):
    for slug, bbs in bbox[view].items():
        s = side_of(slug)
        if not s:
            continue
        cx = sum(b["x"] + b["w"] / 2 for b in bbs) / len(bbs)
        viewer_right = cx > centre[view]
        expected_right = (s == "left") if view == "front" else (s == "right")
        assert viewer_right == expected_right, f"{view}/{slug}: side name disagrees with geometry"
print("side names agree with geometry for all", sum(len(v) for v in bbox.values()), "parts")

groups = {"front": {}, "back": {}}
for view in ("front", "back"):
    for p in parts[view]:
        region = region_of(p["slug"], view)
        side = side_of(p["slug"]) if region in SIDED else None
        groups[view].setdefault((region, side), []).extend(p["paths"])


def pack(view):
    return [{"region": r, "side": s, "paths": ps} for (r, s), ps in groups[view].items()]


# hand close-up: palm = largest path; thumb = the other path farthest sideways from the palm; the rest are fingers
hand = {}
for s in ("left", "right"):
    slug = f"hands-{s}-front"
    bbs = bbox["front"][slug]
    ps = next(p["paths"] for p in parts["front"] if p["slug"] == slug)
    area = [b["w"] * b["h"] for b in bbs]
    palm = area.index(max(area))
    pcx = bbs[palm]["x"] + bbs[palm]["w"] / 2
    others = [i for i in range(len(ps)) if i != palm]
    thumb = max(others, key=lambda i: abs(bbs[i]["x"] + bbs[i]["w"] / 2 - pcx))
    fingers = [i for i in others if i != thumb]
    xs = [b["x"] for b in bbs]; ys = [b["y"] for b in bbs]
    xe = [b["x"] + b["w"] for b in bbs]; ye = [b["y"] + b["h"] for b in bbs]
    pad = 14
    def centre(idx):
        x0 = min(bbs[i]["x"] for i in idx); y0 = min(bbs[i]["y"] for i in idx)
        x1 = max(bbs[i]["x"] + bbs[i]["w"] for i in idx); y1 = max(bbs[i]["y"] + bbs[i]["h"] for i in idx)
        return [round((x0 + x1) / 2), round((y0 + y1) / 2)]

    hand[s] = {
        "anchors": {"hand": centre([palm]), "thumb": centre([thumb]), "fingers": centre(fingers)},
        "box": f"{min(xs) - pad:.0f} {min(ys) - pad:.0f} {max(xe) - min(xs) + 2 * pad:.0f} {max(ye) - min(ys) + 2 * pad:.0f}",
        "palm": [ps[palm]], "thumb": [ps[thumb]], "fingers": [ps[i] for i in fingers],
    }
    print(f"hand {s}: palm={palm} thumb={thumb} fingers={fingers}")

header = """// GENERATED by tools/build_body_paths.py from the MIT-licensed npm package react-body-map 1.1.0.
// The path data was not drawn by this project. Licence chain: react-native-body-highlighter (MIT, ELABBASSI Hicham, 2022)
// -> react-body-highlighter (MIT, GV79, 2020) -> react-body-map (MIT per its package.json). Full notices:
// THIRD_PARTY_NOTICES.md. Region ids and sides are ours (SNOMED CT body structures); the geometry is theirs.
"""
data = {
    "viewBox": {"front": "0 0 724 1448", "back": "724 0 724 1448"},
    "outline": {"front": outline[0], "back": outline[1]}, "front": pack("front"), "back": pack("back"), "hand": hand,
}
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(header + "export const BODY = " + json.dumps(data, separators=(",", ":")) + ";\n", encoding="utf8")
print("wrote", out, f"{out.stat().st_size/1024:.0f} KB;", {v: sorted({r for r, _ in groups[v]}) for v in groups})
