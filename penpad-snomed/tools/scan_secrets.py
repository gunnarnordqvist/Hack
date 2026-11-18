"""Scan every tracked file for things that look like secrets. Prints file:line and the kind, never the value.

  python tools/scan_secrets.py          # exit 1 if anything is found
  python tools/scan_secrets.py --staged # only files staged for commit (use as a pre-commit hook)

Deliberately simple and blunt. It complements, not replaces, a managed scanner. A secret that was ever committed must be
revoked at its issuer first; do not try to clean the history first.
"""
import re
import subprocess
import sys
from pathlib import Path

PATTERNS = [
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("AWS access key id", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("GitHub token", re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}")),
    ("GitHub fine-grained token", re.compile(r"github_pat_[A-Za-z0-9_]{22,}")),
    ("Slack token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("API-style secret assigned to a literal", re.compile(r"(?i)(api[_-]?key|secret|passwd|password|token)\s*[:=]\s*['\"][^'\"\s]{12,}['\"]")),
    ("URL with embedded credentials", re.compile(r"https?://[^/\s:@$]+:(?!\$)[^/\s@]+@")),
    ("bearer token", re.compile(r"(?i)bearer\s+[A-Za-z0-9._-]{20,}")),
]


def scan_text(text: str):
    """[(line number, kind)] for the lines of `text` that match a pattern."""
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        for kind, rx in PATTERNS:
            if rx.search(line):
                out.append((i, kind))
    return out


def repo_root() -> Path:
    return Path(subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip())


def files(staged: bool):
    root = repo_root()
    cmd = ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"] if staged else ["git", "ls-files"]
    names = subprocess.run(cmd, cwd=root, capture_output=True, text=True, check=True).stdout.splitlines()
    return root, names


def main(argv):
    root, names = files("--staged" in argv)
    found = 0
    for n in names:
        p = root / n
        try:
            text = p.read_text(encoding="utf8")
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue  # binary or removed
        for line, kind in scan_text(text):
            print(f"{n}:{line}: possible secret ({kind})")
            found += 1
    print(f"scanned {len(names)} files, {found} finding(s)")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
