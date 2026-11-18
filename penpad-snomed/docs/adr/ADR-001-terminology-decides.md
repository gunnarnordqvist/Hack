# ADR-001: Terminology decides, the model only suggests
Status: accepted by the owner's brief (2026-11-18); not independently reviewed.
**Context.** A language model could pick codes directly, but it can invent or mis-rank them.
**Decision.** Candidates and slot options come only from ECL result sets on the terminology server; a lexical score (and optionally BioLORD embeddings, local only) reorders them. A low-confidence warning is shown, with manual search.
**Consequences.** No hallucinated codes; quality depends on server and ranking; eval set is small (14 phrases written by the assistant; 10/14 baseline, 14/14 re-rank, threshold tuned after seeing a miss — not a benchmark).
