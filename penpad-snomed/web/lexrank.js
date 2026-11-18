// Lexical candidate ranking in the browser: same rule as backend/rank.py lex_score (token overlap on 5-letter stems,
// F1 of recall and precision). Used when no backend with the embedding model is running (static demo).

const STOP = new Set(["i", "på", "av", "och", "en", "ett", "med", "om", "har", "jag", "min", "mitt", "mina", "det", "den", "är",
  "the", "in", "of", "a", "an", "my", "have", "has", "is", "and", "with", "on", "at", "to",
  "feel", "feeling", "felt", "got", "getting", "am", "are", "was", "been", "being", "really", "very", "so", "quite", "känner", "känns", "får", "mår", "lite", "some", "bit"]);

/** Everyday words for pain become the word the terms use ("my thumb hurts" -> "my thumb pain", "ont i magen" -> "smärta i magen"). */
export function normalizeSymptoms(t) {
  return (t || "")
    .replace(/\b(hurts|hurt|hurting|aches|ache|aching)\b/gi, "pain")
    .replace(/(?<![\p{L}])(ont|värker|värkte)(?![\p{L}])/giu, "smärta")
    // adjectives and verbs for general symptoms -> the noun the terms use
    .replace(/\b(dizzy|giddy)\b/gi, "dizziness").replace(/\b(nauseous|nauseated)\b/gi, "nausea").replace(/\b(feverish)\b/gi, "fever")
    .replace(/\b(tired|exhausted)\b/gi, "fatigue").replace(/\b(itchy|itching)\b/gi, "itching").replace(/\b(coughing)\b/gi, "cough")
    .replace(/(?<![\p{L}])(yr|yrsel)(?![\p{L}])/giu, "yrsel").replace(/(?<![\p{L}])(trött|trötthet)(?![\p{L}])/giu, "fatigue")
    .replace(/(?<![\p{L}])(kräks|kräkas|kräktes)(?![\p{L}])/giu, "kräkning").replace(/(?<![\p{L}])(kliar|kliande)(?![\p{L}])/giu, "klåda")
    .replace(/(?<![\p{L}])(hostar|hostade)(?![\p{L}])/giu, "hosta");
}

/** The words of a query without filler words ("pain in the knee" -> "pain knee"): what is sent to the terminology server's text filter. */
export function contentWords(t) {
  return (t || "").toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).join(" ");
}

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
  rows.sort((a, b) => b.score - a.score || (a.en || a.sv || "").length - (b.en || b.sv || "").length);
  const items = rows.slice(0, k).map((r, i) => ({ ...r, rank: i + 1 }));
  return { query: q, mode: "text", items, low_confidence: !items.length || items[0].score < threshold, model: null, threshold };
}

// words that name the topic (pain, swelling), not a particular finding
export const GENERIC_STEMS = new Set(["pain", "smärt", "swell", "svull", "ache", "ont", "värk", "painf", "sore", "swoll", "achin"]);

/**
 * Does a pain/swelling suggestion add the topic word that the query does not contain? ("toenail fungus" -> "Pain in toe")
 * `names` are the suggestion's names (English and Swedish).
 */
export function addsTopicWord(query, names) {
  const qs = stems(normalizeSymptoms(query));
  if (qs.some((w) => GENERIC_STEMS.has(w))) return false;
  return names.filter(Boolean).flatMap((n) => stems(n)).some((w) => GENERIC_STEMS.has(w));
}
