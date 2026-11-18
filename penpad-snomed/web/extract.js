// Free text -> slot values (side, severity, onset, duration ...) and the "rest" of the text.
// Pure functions: run in the browser and in node. No model, no network.
//
// The words come from two places: SNOMED CT terms (English core, Swedish module, via the snapshot's labels)
// and our own small synonym lists in topics.json (unreviewed). Whatever is recognised is removed from the
// text, so the remainder ("smärta i tumme") can be ranked as a finding without side or duration words.

const L = "\\p{L}\\p{N}";

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a phrase table: [{phrase, slot, code}] sorted longest first. */
export function buildPhrases(cfg, labels) {
  const slotOf = new Map();
  for (const [slot, s] of Object.entries(cfg.slots)) {
    for (const c of [...(s.quick || []), ...(s.more || [])]) if (!slotOf.has(c)) slotOf.set(c, slot);
  }
  const out = [];
  const seen = new Set();
  const add = (phrase, code, lang) => {
    const p = phrase.toLowerCase().trim();
    const slot = slotOf.get(code);
    if (!p || !slot || p.length < 2) return;
    const k = p + "|" + code + "|" + lang;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ phrase: p, slot, code, lang });
  };
  for (const [code, lex] of Object.entries(cfg.lexicon || {})) {
    for (const w of lex.sv || []) add(w, code, "sv");
    for (const w of lex.en || []) add(w, code, "en");
  }
  for (const code of slotOf.keys()) {
    const l = labels[code] || {};
    if (l.sv) add(l.sv, code, "sv");
    if (l.en) add(l.en, code, "en");
  }
  out.sort((a, b) => b.phrase.length - a.phrase.length);
  return out;
}

// Common words, only to decide which synonym list to trust ("fast" is Swedish for firm, English for rapid).
const SV_HINT = new Set(["i", "och", "ont", "smärta", "sedan", "en", "ett", "av", "har", "svullen", "svullnad", "på", "med", "är", "jag", "min", "mitt", "dagar", "veckor", "igår", "värk", "tumme", "tummen", "foten", "magen"]);
const EN_HINT = new Set(["the", "in", "of", "for", "since", "my", "hurts", "pain", "swollen", "swelling", "is", "and", "with", "on", "days", "weeks", "yesterday", "thumb", "foot", "has", "have", "onset"]);

export function detectLang(text) {
  let sv = 0, en = 0;
  for (const w of (text || "").toLowerCase().split(/[^\p{L}]+/u)) {
    if (SV_HINT.has(w)) sv++;
    if (EN_HINT.has(w)) en++;
  }
  return en > sv ? "en" : sv > en ? "sv" : "both";
}

function wordRe(phrase) {
  return new RegExp(`(?<![${L}])${esc(phrase)}(?![${L}])`, "iu");
}

function numberValue(tok, cfg) {
  if (/^\d+$/.test(tok)) return parseInt(tok, 10);
  const t = tok.toLowerCase();
  for (const lang of ["sv", "en"]) {
    const v = cfg.numbers[lang][t];
    if (v) return v;
  }
  return null;
}

function unitTable(cfg) {
  const rows = [];
  for (const u of cfg.units) {
    for (const w of [...u.sv, ...u.en]) rows.push({ word: w.toLowerCase(), unit: u.key });
  }
  rows.sort((a, b) => b.word.length - a.word.length);
  return rows;
}

/**
 * extract("smärta i vänster tumme sedan två dagar, bultande", cfg, labels)
 *  -> { values: {laterality:'7771000', character:'29695002'}, duration:{n:2, unit:'day'},
 *       matched:[{slot, code, phrase}], rest:'smärta i tumme', lang:'sv' }
 */
export function extract(text, cfg, labels, phrases = buildPhrases(cfg, labels)) {
  let rest = " " + (text || "").toLowerCase() + " ";
  const values = {};
  const matched = [];
  let duration = null;

  // 1. duration: "sedan två dagar", "i 3 veckor", "for 2 days", "since yesterday", "igår"
  const units = unitTable(cfg);
  const unitAlt = units.map((u) => esc(u.word)).join("|");
  const numAlt = ["\\d+", ...Object.keys(cfg.numbers.sv), ...Object.keys(cfg.numbers.en)].map((x) => (x === "\\d+" ? x : esc(x))).join("|");
  const durRe = new RegExp(`(?<![${L}])(?:(?:sedan|för|i|since|for|during|över|over)\\s+)?(${numAlt})\\s+(${unitAlt})(?![${L}])`, "iu");
  const m = rest.match(durRe);
  if (m) {
    const n = numberValue(m[1], cfg);
    const unit = units.find((u) => u.word === m[2].toLowerCase());
    if (n && unit) {
      duration = { n, unit: unit.unit };
      rest = rest.replace(m[0], " ");
      matched.push({ slot: "duration", code: null, phrase: m[0].trim() });
    }
  }
  if (!duration) {
    for (const lang of ["sv", "en"]) {
      for (const [w, days] of Object.entries(cfg.relativeDays[lang])) {
        const re = new RegExp(`(?<![${L}])(?:(?:sedan|since|from)\\s+)?${esc(w)}(?![${L}])`, "iu");
        const r = rest.match(re);
        if (r && days > 0) {
          duration = { n: days, unit: "day" };
          rest = rest.replace(r[0], " ");
          matched.push({ slot: "duration", code: null, phrase: r[0].trim() });
          break;
        }
      }
      if (duration) break;
    }
  }

  // 2. coded words, longest phrase first; one value per slot (the first, i.e. longest, wins)
  const lang = detectLang(text);
  for (const p of phrases) {
    if (lang !== "both" && p.lang !== lang) continue;
    if (values[p.slot]) {
      // still remove repeated words of an already filled slot only if exactly the same phrase
      continue;
    }
    const re = wordRe(p.phrase);
    if (re.test(rest)) {
      values[p.slot] = p.code;
      rest = rest.replace(re, " ");
      matched.push({ slot: p.slot, code: p.code, phrase: p.phrase });
    }
  }

  rest = rest.replace(/[,;.]/g, " ").replace(/\b(sedan|since|för|for|och|and)\b/giu, " ").replace(/\s+/g, " ").trim();
  return { values, duration, matched, rest, lang };
}
