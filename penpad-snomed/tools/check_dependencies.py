"""Check the dependency policy (dependency-policy.yaml) against what the project really uses.

  python tools/check_dependencies.py        # exit 1 on a problem; prints a WARNING for every entry whose reviewer is still 'pending'

Fails if: a requirement is not pinned with ==; a requirement is missing from the policy (or the policy lists a package that is in
no requirements file, or the versions differ); a GitHub Action is not pinned to a 40-character commit or is not in the policy
with that commit; an entry lacks a purpose or a reviewer field.
"""
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent


def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def requirements(path: Path):
    out, problems = {}, []
    for n, line in enumerate(path.read_text(encoding="utf8").splitlines(), 1):
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        m = re.fullmatch(r"([A-Za-z0-9_.\-]+)==([A-Za-z0-9_.+\-]+)", line)
        if not m:
            problems.append(f"{path.name}:{n}: '{line}' is not pinned with ==")
            continue
        out[norm(m.group(1))] = m.group(2)
    return out, problems


def main() -> int:
    problems, warnings = [], []
    policy = yaml.safe_load((ROOT / "dependency-policy.yaml").read_text(encoding="utf8"))

    for req_file, key in (("requirements-optional.txt", "python"), ("requirements-dev.txt", "python_dev")):
        reqs, probs = requirements(ROOT / req_file)
        problems += probs
        listed = {norm(e["name"]): e for e in policy.get(key, [])}
        for name, ver in reqs.items():
            if name not in listed:
                problems.append(f"{req_file}: {name} is not in dependency-policy.yaml ({key})")
            elif str(listed[name]["version"]) != ver:
                problems.append(f"{req_file}: {name} is {ver} but the policy says {listed[name]['version']}")
        for name in listed:
            if name not in reqs:
                problems.append(f"dependency-policy.yaml ({key}): {name} is in no requirements file")

    uses = {}
    for wf in sorted((REPO / ".github" / "workflows").glob("*.yml")):
        for n, line in enumerate(wf.read_text(encoding="utf8").splitlines(), 1):
            m = re.match(r"\s*-?\s*(?:uses:)\s*([^@\s]+)@(\S+)", line)
            if m:
                name, ref = m.group(1), m.group(2)
                if not re.fullmatch(r"[0-9a-f]{40}", ref):
                    problems.append(f"{wf.name}:{n}: {name}@{ref} is not pinned to a commit")
                uses[name] = ref
    listed_actions = {e["name"]: e for e in policy.get("actions", [])}
    for name, ref in uses.items():
        if name not in listed_actions:
            problems.append(f"action {name} is not in dependency-policy.yaml")
        elif listed_actions[name]["sha"] != ref:
            problems.append(f"action {name}: workflow uses {ref[:10]} but the policy says {listed_actions[name]['sha'][:10]}")
    for name in listed_actions:
        if name not in uses:
            problems.append(f"dependency-policy.yaml lists action {name}, which no workflow uses")

    entries = []
    for key in ("python", "python_dev", "actions", "vendored", "services", "models"):
        entries += [(key, e) for e in policy.get(key, [])]
    entries += [("node.dev", e) for e in policy.get("node", {}).get("dev", [])]
    for key, e in entries:
        if "purpose" not in e or "reviewer" not in e:
            problems.append(f"policy entry {e.get('name')} ({key}) needs 'purpose' and 'reviewer'")
        elif str(e["reviewer"]).strip().lower() == "pending":
            warnings.append(f"{e.get('name')} ({key})")

    for p in problems:
        print("PROBLEM:", p)
    if warnings:
        print(f"WARNING: {len(warnings)} entries still have reviewer 'pending' (no human has reviewed them): " + ", ".join(warnings[:6]) + (" ..." if len(warnings) > 6 else ""))
    print(f"{len(entries)} policy entries, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
