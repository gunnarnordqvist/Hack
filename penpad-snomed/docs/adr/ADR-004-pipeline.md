# ADR-004: Pipeline on main, site on gh-pages, actions pinned to commits
Status: accepted by the owner's request; first run with pinned SHAs not yet verified (see build record).
**Context.** The `github-pages` environment only accepts deployments from main.
**Decision.** Workflow on main: test → build (no snapshot) → update gh-pages → deploy-pages. Actions pinned to 40-character commits listed in `dependency-policy.yaml` and checked by `tools/check_dependencies.py`. Pages source: GitHub Actions.
**Consequences.** Pushing to main publishes. The assistant pushed to main under a waiver (W1 in docs/mandate.yaml). The pinned SHAs came from `git ls-remote` tags and are unverified until a run succeeds. No branch protection or required review exists.
