# ADR-002: Client mode, no SNOMED CT content in the repository
Status: accepted by the owner's brief; not independently reviewed.
**Context.** The repository is public; SNOMED CT content has licence conditions.
**Decision.** The public site queries the HL7 Nordics terminology server from the browser. Snapshots are gitignored and the build fails if one is present. The page auto-detects snapshot, client or live backend.
**Consequences.** Typed search words go to a third-party server (a personal-data guard blocks obvious identifiers). Availability depends on that server. Two early commits (18b5abf) contain SNOMED-term files; history is not rewritten until the owner decides.
