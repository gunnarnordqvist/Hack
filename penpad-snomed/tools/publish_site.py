"""Build the public site and commit it to the `gh-pages` branch of the repository this folder lives in.

  python tools/publish_site.py [--message "..."] [--no-push]

Then publish it: GitHub -> Actions -> "Deploy site" -> Run workflow. The workflow lives on `main` because the
`github-pages` environment only accepts deployments from the default branch; it checks out `gh-pages`.
(If you set Pages to "Deploy from a branch: gh-pages" instead, no workflow is needed.)

Uses a temporary git worktree, so your working tree and current branch are not touched. The site contains no SNOMED CT content.
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent


def git(*args, cwd=REPO, check=True):
    return subprocess.run(["git", *args], cwd=cwd, check=check)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--message", default="Update the site (tools/publish_site.py)")
    ap.add_argument("--no-push", action="store_true")
    a = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        site, wt = Path(tmp) / "site", Path(tmp) / "wt"
        subprocess.run([sys.executable, str(ROOT / "tools" / "build_site.py"), str(site)], check=True)
        git("fetch", "origin", "gh-pages")
        git("worktree", "add", "--detach", str(wt), "origin/gh-pages")
        try:
            for p in wt.iterdir():
                if p.name != ".git":
                    shutil.rmtree(p) if p.is_dir() else p.unlink()
            shutil.copytree(site, wt, dirs_exist_ok=True)
            git("add", "-A", cwd=wt)
            if git("diff", "--cached", "--quiet", cwd=wt, check=False).returncode == 0:
                print("site unchanged, nothing to publish")
                return
            git("commit", "-q", "-m", a.message, cwd=wt)
            if a.no_push:
                print("committed in a temporary worktree only (--no-push); nothing was pushed")
                return
            git("push", "origin", "HEAD:gh-pages", cwd=wt)
            print("pushed to gh-pages. Now run the 'Deploy site' workflow (Actions tab) to publish it.")
        finally:
            git("worktree", "remove", "--force", str(wt), check=False)


if __name__ == "__main__":
    main()
