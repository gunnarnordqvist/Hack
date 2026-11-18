// Several findings in one sentence: "ont i armen, handen och huvudet", "svullen fot och smärta i knät".
//
// The text is cut into clauses; every clause gets its OWN body part (looked up in cfg.bodymap.words) and its own values, so a
// side, a severity or a character said about one part is never given to another. Only time words (duration, onset, progress,
// pattern) said once are shared. Nothing here looks at a terminology server: the result is a list of proposals
// {clause, regions, query, values, duration}; the app resolves each one against SNOMED CT and shows it for review.

import { extract } from "./extract.js";

const L = "\\p{L}";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SHARED = ["onset", "progress", "pattern"]; // time words said once apply to every finding; side, severity, character, aspect never do
// words that say nothing about a finding of their own ("sudden onset", "started yesterday")
const IGNORE = new Set(["debut", "onset", "start", "started", "började", "dag", "dagar", "day", "days", "morgon", "morgonen", "morning", "natt", "natten", "night", "kväll", "kvällen", "evening", "idag", "today", "tonight", "också", "also", "mycket", "very", "lite", "bit", "little", "ganska", "quite"]);
const ARTICLES = new Set(["i", "på", "av", "och", "and", "samt", "the", "my", "min", "mitt", "mina", "in", "on", "of", "a", "an", "också", "also", "båda", "both", "i", "to"]);

const SPLIT = new RegExp(`\\s*(?:[,;+&]|(?<![${L}])(?:och|samt|and)(?![${L}]))\\s*`, "iu");

/** Cut a text into clauses at commas, semicolons, "och", "and", "samt", "+" and "&". */
export function splitClauses(text) {
  return String(text || "").split(SPLIT).map((s) => s.trim()).filter(Boolean);
}

/** Body words from the configuration, longest first: [{word, regions, compound}]. */
export function bodyTable(cfg) {
  const rows = [];
  for (const w of cfg.bodymap.words || []) for (const [lang, list] of [["sv", w.sv], ["en", w.en]]) for (const word of list) rows.push({ word: word.toLowerCase(), regions: w.regions, compound: false, base: [w.sv[0], w.en[0]], lang });
  for (const c of cfg.bodymap.compounds || []) rows.push({ word: c.word.toLowerCase(), regions: c.regions, compound: true, base: [], lang: c.lang });
  rows.sort((a, b) => b.word.length - a.word.length);
  return rows;
}

/** The first body word in a text (whole words only; longest word wins), or null. */
export function findBodyWord(text, table) {
  const t = " " + String(text || "").toLowerCase() + " ";
  let best = null;
  for (const row of table) {
    const m = t.match(new RegExp(`(?<![${L}])${esc(row.word)}(?![${L}])`, "u"));
    if (m && (!best || m.index < best.index)) best = { ...row, index: m.index };
  }
  return best;
}

/** An everyday phrase that has a finding of its own ("ont i huvudet" -> "huvudvärk"): {query, bodyWord, regions, base} or null. */
export function aliasOf(query, cfg) {
  const key = meaningfulKey(query);
  for (const a of cfg.bodymap.aliases || []) {
    if (meaningfulKey(a.phrase) === key) {
      const c = (cfg.bodymap.compounds || []).find((x) => x.word === a.query);
      if (c) return { query: a.query, bodyWord: a.query, regions: c.regions, base: [] };
    }
  }
  return null;
}
const meaningfulKey = (t) => String(t || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !["the", "a", "an", "my", "min", "mitt", "mina"].includes(w)).join(" ");

const withoutWord = (text, word) => (" " + text + " ").replace(new RegExp(`(?<![${L}])${esc(word)}(?![${L}])`, "iu"), " ").replace(/\s+/g, " ").trim();
const meaningful = (text) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !ARTICLES.has(w));

/**
 * @returns {{multi: boolean, entries: Array<{clause, regions, bodyWord, query, values, duration}>}}
 * `query` is the clause's finding words with the body word kept ("ont i handen"); `regions` are the body regions that body word
 * stands for (null when the clause has no body word).
 */
export function parseMulti(text, cfg, labels, phrases) {
  const table = bodyTable(cfg);
  const entries = [];
  let template = null; // finding words of the last clause with the body word left open: "ont i §"
  for (const clause of splitClauses(text)) {
    const ex = extract(clause, cfg, labels, phrases);
    const rest = ex.rest.trim();
    const bw = findBodyWord(rest, table);
    const own = { values: { ...ex.values }, duration: ex.duration };
    if (bw && bw.compound) {
      entries.push({ clause, regions: bw.regions, bodyWord: bw.word, base: bw.base, lang: bw.lang, query: rest, ...own });
      template = null;
    } else if (bw) {
      const others = meaningful(withoutWord(rest, bw.word));
      if (!others.length && template) {
        entries.push({ clause, regions: bw.regions, bodyWord: bw.word, base: bw.base, lang: bw.lang, query: template.replace("§", bw.word), ...own });
      } else {
        entries.push({ clause, regions: bw.regions, bodyWord: bw.word, base: bw.base, lang: bw.lang, query: rest, ...own });
        if (others.length) template = rest.replace(new RegExp(`(?<![${L}])${esc(bw.word)}(?![${L}])`, "iu"), "§");
      }
    } else if (!entries.length) {
      if (rest) entries.push({ clause, regions: null, bodyWord: null, query: rest, ...own });
    } else if (meaningful(rest).some((w) => !IGNORE.has(w))) {
      // a later clause with words of its own but no body word ("fever and cough"): maybe a finding of its own; the app tries it
      // and puts it back to the finding before it (as plain words) if nothing matches
      entries.push({ clause, regions: null, bodyWord: null, query: rest, optional: true, ...own });
    } else {
      // no body word and nothing else in a later clause: it only adds words (side, severity, "since yesterday" ...) to the finding before it
      const last = [...entries].reverse().find((e) => !e.optional) || entries[entries.length - 1];
      for (const [k, v] of Object.entries(own.values)) if (last.values[k] === undefined) last.values[k] = v;
      if (own.duration && !last.duration) last.duration = own.duration;
    }
  }
  // time words said once are shared by every finding that has none of its own
  if (entries.length > 1) {
    for (const slot of SHARED) {
      const v = entries.map((e) => e.values[slot]).find(Boolean);
      if (v) for (const e of entries) if (e.values[slot] === undefined) e.values[slot] = v;
    }
    const d = entries.map((e) => e.duration).find(Boolean);
    if (d) for (const e of entries) if (!e.duration) e.duration = d;
  }
  for (const e of entries) { const a = aliasOf(e.query, cfg); if (a) Object.assign(e, a); }
  return { multi: entries.filter((e) => !e.optional).length > 1, hasOptional: entries.some((e) => e.optional), entries };
}
