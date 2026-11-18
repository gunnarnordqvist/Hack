// Lexical candidate ranking in the browser: same rule as backend/rank.py lex_score (token overlap on 5-letter stems,
// F1 of recall and precision). Used when no backend with the embedding model is running (static demo).

const STOP = new Set(["i", "på", "av", "och", "en", "ett", "med", "om", "har", "jag", "min", "mitt", "mina", "det", "den", "är",
  "the", "in", "of", "a", "an", "my", "have", "has", "is", "and", "with", "on", "at", "to"]);

export function stems(t) {
  return (t || "").toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w)).map((w) => w.slice(0, 5));
}

export function lexScore(q, name) {
  const qs = new Set(stems(q));
  const ns = new Set(stems(name));
  if (!qs.size || !ns.size) return 0;
  let inter = 0;
  for (const s of qs) if (ns.has(s)) inter++;
  if (!inter) return 0;
  const r = inter / qs.size;
  const p = inter / ns.size;
  return (2 * r * p) / (r + p);
}

/** universe rows: [code, en, sv, topic]. Returns the same shape as the backend's /api/candidates. */
export function rankLexical(query, universe, k = 5, threshold = 0.45) {
  const q = (query || "").trim();
  if (!q) return { query: q, mode: "text", items: [], low_confidence: true, model: null, threshold };
  const rows = [];
  for (const [code, en, sv, topic] of universe) {
    const s = Math.max(lexScore(q, en), sv ? lexScore(q, sv) : 0);
    if (s > 0) rows.push({ code, en, sv, topic, score: +s.toFixed(4), confidence: +Math.min(1, s).toFixed(3), scores: { filter: false, lex: +s.toFixed(3), emb: null } });
  }
  rows.sort((a, b) => b.score - a.score || a.en.length - b.en.length);
  const items = rows.slice(0, k).map((r, i) => ({ ...r, rank: i + 1 }));
  return { query: q, mode: "text", items, low_confidence: !items.length || items[0].score < threshold, model: null, threshold };
}
