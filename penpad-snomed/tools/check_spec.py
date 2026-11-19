"""Check docs/specification.yaml: every rule has an id, rule, example, error_case and tests, and every named test exists.

  python tools/check_spec.py     # exit 1 on a problem; prints a WARNING when there are more than 8 rules
"""
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"


def known_tests() -> set:
    names = set()
    for f in TESTS.glob("*.test.mjs"):
        names |= set(re.findall(r'^test\("([^"]+)"', f.read_text(encoding="utf8"), re.M))
    for f in TESTS.glob("test_*.py"):
        names |= set(re.findall(r"^\s+def (test_\w+)", f.read_text(encoding="utf8"), re.M))
    for e2e in (TESTS / "e2e.cjs", TESTS / "e2e-ml.cjs"):
        if e2e.exists():
            names |= set(re.findall(r'check\("([^"]+)"', e2e.read_text(encoding="utf8")))
    return names


def main() -> int:
    spec = yaml.safe_load((ROOT / "docs" / "specification.yaml").read_text(encoding="utf8"))
    names, problems, seen = known_tests(), [], set()
    for r in spec.get("rules", []):
        rid = r.get("id", "?")
        if rid in seen:
            problems.append(f"{rid}: duplicate id")
        seen.add(rid)
        for key in ("rule", "example", "error_case", "tests"):
            if not r.get(key):
                problems.append(f"{rid}: missing '{key}'")
        for t in r.get("tests") or []:
            if t not in names:
                problems.append(f"{rid}: test not found: {t!r}")
    if not spec.get("never_do"):
        problems.append("never_do is empty")
    if len(spec.get("rules", [])) > 8:
        print(f"WARNING: {len(spec['rules'])} rules; the book advises at most 8 per specification")
    for p in problems:
        print("PROBLEM:", p)
    print(f"{len(spec.get('rules', []))} rules, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
