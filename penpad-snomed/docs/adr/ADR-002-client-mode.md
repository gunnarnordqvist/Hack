# ADR-002: Client mode, no SNOMED CT content in the repository
Status: accepted by the owner's brief; not independently reviewed.
**Context.** The repository is public; SNOMED CT content has licence conditions.
**Decision.** The public site queries the HL7 Nordics terminology server from the browser. Snapshots are gitignored and the build fails if one is present. The page auto-detects snapshot, client or live backend.
**Consequences.** Typed search words go to a third-party server (a personal-data guard blocks obvious identifiers). Availability depends on that server. Two early commits contained SNOMED-term files; with the owner's approval they were removed from history on 2026-11-18 (force-push). Clones or GitHub caches made before may still hold them.
