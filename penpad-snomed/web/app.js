// PEN&PAD smart forms demo: free text -> SNOMED CT finding -> only the valid follow-up questions -> confirmation
// sentence + SNOMED expression + openEHR + FHIR. Runs on a static snapshot; if a backend answers /api/health it
// also uses the embedding model for candidates and validates codes live against the terminology server.

import { extract, buildPhrases } from "./extract.js";
import { sentence, expression, openEhr, fhirCondition, codesUsed, term, expressionMany, openEhrMany, fhirBundle, codesUsedMany } from "./generators.js";
import { rankLexical, lexScore, contentWords, normalizeSymptoms, stems, GENERIC_STEMS as GENERIC, addsTopicWord } from "./lexrank.js";
const GENERIC_PAIN = /^(pain|smärta|ont|ache|swelling|swollen|svullen|svullnad)?$/i;
import { parseMulti, bodyTable, findBodyWord, aliasOf } from "./multi.js";
import { drawBodyMap, ZOOM_OF, isZoomView, mainViewFor, drawnIn, sideOfCode, mentionsSide } from "./bodymap.js";
import * as TX from "./txclient.js";
import { personalDataReason, PERSONAL_DATA_ERROR } from "./guard.js";

import { I } from "./i18n.js";
import { serializeList, parseList, MAX_BYTES } from "./listio.js";
import * as ML from "./ml.js";

const S = {
  snap: null, source: "snapshot", known: new Map(), universe: [], optionsLoaded: new Set(), live: false, lang: "sv", mode: "clinician", text: "", ex: null, cand: null, candMode: "rerank",
  finding: null, values: {}, prefilled: new Set(), duration: null, expanded: new Set(), confirmed: false,
  tab: "expr", validation: {}, manual: "", sampleHit: null, chart: [], editing: null, scope: "one", multi: null,
  ml: { sem: "off", semMsg: "", mic: "idle", micMsg: "", info: null, status: "", crashed: null }, semMode: "fusion", semHi: 0.98,
  map: { view: "front", main: "front", side: null, sel: null, topic: "all", more: false }, prefilledMap: new Set(),
};
const CODE_OF_SIDE = { left: "7771000", right: "24028007" };
window.__penpad = S; // handle for tests and curious people

const $ = (s, r = document) => r.querySelector(s);
const t = (k) => I[S.lang][k];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const ctx = () => ({ cfg: S.snap.cfg, labels: S.snap.labels });
const gstate = () => ({ lang: S.lang, mode: S.mode, finding: S.finding, values: S.values, duration: S.duration, aspectSite: aspectSiteOf(S.finding, S.values) });
const lab = (code) => term(code, S.lang, S.snap.labels);
const plainSite = (site) => (S.lang === "sv" ? site.sv || site.en : site.en).replace(/,\s*struktur$/i, "").replace(/\s+structure$/i, "");
const browserLink = (code) => `https://browser.ihtsdotools.org/?perspective=full&conceptId1=${code}&edition=MAIN`;

// ------------------------------------------------------------------------------------------------ data flow
const examples = () => (S.snap.cfg.examples || []).filter((e) => e.lang === S.lang).map((e) => e.text);
const liveCheck = () => S.live || S.source === "client";
const nmI = (it) => (S.lang === "sv" ? it.sv || it.en : it.en);
const inLang = (it) => S.lang !== "en" || !!it.en; // concepts without an English term are not offered in English

function configCodes(cfg) {
  const c = new Set();
  for (const sl of Object.values(cfg.slots)) for (const x of [...(sl.quick || []), ...(sl.more || [])]) c.add(x);
  for (const u of cfg.units) c.add(u.code);
  for (const x of Object.values(cfg.meta.attributes)) c.add(x);
  return [...c];
}

/** The same shape as the snapshot, but empty: everything is fetched from the terminology server when needed. */
function clientSnap(cfg) {
  const options = {};
  for (const [name, sl] of Object.entries(cfg.slots)) {
    if (sl.kind === "duration") continue;
    options[name] = [...sl.quick.map((code) => ({ code, quick: true })), ...(sl.more || []).filter((c) => !sl.quick.includes(c)).map((code) => ({ code, quick: false }))];
  }
  return {
    cfg, labels: {}, options, universe: [], details: {}, samples: [], meta: { client: true },
    bodymap: { regions: cfg.bodymap.regions.map((r) => ({ id: r.id, label: r.label, sided: r.sided, parent: r.parent, count: null })), subregions: cfg.bodymap.subregions, findings: {}, siteRegions: {} },
  };
}

async function init() {
  let snap = null;
  try { const r = await fetch("data/snapshot.json"); if (r.ok) snap = await r.json(); } catch (_) { /* no snapshot: client mode */ }
  try {
    if (snap) {
      S.source = "snapshot"; S.snap = snap; S.universe = snap.universe;
      S.known = new Map(snap.universe.map((u) => [u[0], u]));
    } else {
      S.source = "client";
      const cfg = await (await fetch("data/config.json")).json();
      S.snap = clientSnap(cfg);
      $("#hdr").textContent = t("loading");
      S.snap.labels = await TX.labelsFor(configCodes(cfg));
    }
  } catch (e) { $("#hdr").textContent = t("txError") + " " + (e && e.message ? e.message : ""); return; }
  S.phrases = buildPhrases(S.snap.cfg, S.snap.labels);
  if (S.source === "snapshot") {
    try {
      const c = new AbortController();
      setTimeout(() => c.abort(), 1500);
      const r = await fetch("api/health", { signal: c.signal });
      const j = r.ok ? await r.json() : null;
      S.live = !!(j && j.ok);
      S.liveModel = j && j.model;
    } catch (_) { S.live = false; }
  }
  render();
  if (await recoverAfterCrash()) return; // the page was closed by the browser during a heavy step: put back what the visitor had
  const first = examples()[0];
  if (first) { S.text = first; interpret(); }
}

/** Candidates straight from the server: its text filter in English and Swedish, ranked by token overlap. No model. */
async function clientCandidates(q0, k = 5) {
  // The words as typed AND with everyday pain words replaced ("hurts" -> "pain"): some terms contain the typed word
  // ("ont i halsen" is a name of sore throat), others only the standard one.
  const variants = [...new Set([q0, normalizeSymptoms(q0)])];
  const calls = [];
  for (const v of variants) {
    const words = contentWords(v) || v; // filler words ("in", "the", "i", "på") make the server's text filter match far too much
    for (const tp of S.snap.cfg.topics) for (const lang of ["en", "sv"]) {
      calls.push(TX.expand(tp.ecl, { filter: words, lang, count: 40, designations: true }).then((r) => ({ tp, lang, r })).catch(() => null));
    }
  }
  const got = (await Promise.all(calls)).filter(Boolean);
  if (!got.length) throw new TX.TxError("no answer");
  const by = new Map();
  for (const { tp, lang, r } of got) r.items.forEach((it, idx) => {
    const e = by.get(it.code) || { code: it.code, en: null, sv: null, topic: tp.id, srv: 1, names: [] };
    e.names.push(...(it.names || []));
    e.srv = Math.min(e.srv, idx / Math.max(1, r.items.length)); // the server's own order (0 = first) breaks ties between equally good names
    e[lang] = it.display;
    by.set(it.code, e);
  });
  const boost = Math.min(0.3, 0.3 / Math.max(1, by.size));
  const rows = [...by.values()].map((e) => {
    if (e.sv === e.en) e.sv = null;
    const lex = Math.max(...variants.map((v) => Math.max(e.en ? lexScore(v, e.en) : 0, e.sv ? lexScore(v, e.sv) : 0, ...e.names.map((n) => lexScore(v, n)))));
    const score = lex + 0.25 + boost + 0.08 * (1 - e.srv);
    return { ...e, score: +score.toFixed(4), confidence: +Math.min(1, score).toFixed(3), scores: { filter: true, lex: +lex.toFixed(3), emb: null } };
  });
  rows.sort((a, b) => b.score - a.score || (a.en || a.sv || "").length - (b.en || b.sv || "").length);
  let ranked = rows;
  if (S.ml.sem === "ready" && S.semMode !== "off") {
    // meaning, computed in this browser: concepts whose names are close to the text even when no word matches ("jätteont i huvudet")
    try {
      const sem = await ML.semanticSearch(q0, 30);
      const cos = new Map(sem.map((x) => [x.code, x.cos]));
      let order = S.semMode === "only" ? sem.map((x) => x.code) : ML.fuseRanks([rows.map((r) => r.code), sem.map((x) => x.code)]);
      // a confident word match keeps the first place (measured: it is right more often than the closest meaning); meaning fills in behind it
      if (S.semMode === "fusion" && rows.length && rows[0].score >= 0.45) order = [rows[0].code, ...order.filter((c) => c !== rows[0].code)];
      const byCode = new Map(rows.map((r) => [r.code, r]));
      ranked = order.map((code) => {
        let r = byCode.get(code);
        if (!r) { const u = S.known.get(code); if (!u) return null; r = { code, en: u[1], sv: u[2], topic: u[3], score: 0, confidence: 0, scores: { filter: false, lex: 0, emb: null } }; }
        const c = cos.get(code);
        r.scores.emb = c === undefined ? null : +c.toFixed(3);
        // a very close meaning counts as a confident match even without a shared word
        if (c !== undefined && c >= S.semHi) { r.score = Math.max(r.score, 0.5); r.confidence = Math.max(r.confidence, +Math.min(1, c).toFixed(3)); }
        return r;
      }).filter(Boolean);
    } catch (_) { ranked = rows; /* the word search still stands */ }
  }
  const top = ranked.slice(0, 12);
  const missing = top.filter((r) => !r.en).map((r) => r.code);
  if (missing.length) {
    try {
      const lab = await TX.labelsFor(missing);
      for (const r of top) if (!r.en && lab[r.code]) { r.en = lab[r.code].en; r.sv = r.sv || lab[r.code].sv; }
    } catch (_) { /* keep what we have */ }
  }
  for (const r of top) S.known.set(r.code, [r.code, r.en, r.sv, r.topic]);
  const items = top.filter(inLang).slice(0, k).map((r, i) => ({ ...r, rank: i + 1 }));
  return { query: q0, mode: "text", items, low_confidence: !items.length || items[0].score < 0.45, model: null, threshold: 0.45 };
}

async function candidatesFor(rest, rawText) {
  if (S.source === "client") return clientCandidates(rest || rawText);
  const sample = S.snap.samples.find((s) => s.text.trim().toLowerCase() === rawText.trim().toLowerCase());
  S.sampleHit = sample || null;
  if (S.live) {
    try {
      const r = await fetch("api/candidates?" + new URLSearchParams({ q: rest || rawText, mode: S.candMode, k: "5" }));
      if (r.ok) return await r.json();
    } catch (_) { /* fall through */ }
  }
  if (sample && sample.candidates[S.candMode]) return sample.candidates[S.candMode];
  if (sample) return sample.candidates.text;
  return rankLexical(rest || rawText, S.universe);
}

async function interpret() {
  // one interpretation at a time, in the order they were asked for: a typed text and a spoken one can never mix their results
  S.busy = (S.busy || 0) + 1;
  const run = (interpretChain = interpretChain.then(() => interpretNow(), () => interpretNow()));
  try { await run; } finally { S.busy--; }
}
let interpretChain = Promise.resolve();

async function interpretNow() {
  S.confirmed = false;
  S.multi = null;
  if (personalDataReason(S.text)) {
    S.cand = { query: "", items: [], low_confidence: true, error: "personal" };
    S.finding = null; S.values = {}; S.prefilled = new Set(); S.duration = null; S.ex = null;
    render();
    return;
  }
  S.ex = extract(S.text, S.snap.cfg, S.snap.labels, S.phrases);
  // several body parts in one sentence ("ont i armen, handen och huvudet"): one proposal each, checked against its own body part
  const mp = parseMulti(S.text, S.snap.cfg, S.snap.labels, S.phrases);
  if (mp.multi || mp.hasOptional) { await startMulti(mp); return; }
  await interpretSingle();
}

async function interpretSingle() {
  try { S.cand = await candidatesFor(S.ex.rest, S.text); }
  catch (e) { S.cand = { query: S.text, mode: "text", items: [], low_confidence: true, error: e && e.message === PERSONAL_DATA_ERROR ? "personal" : true }; }
  try { if (!S.cand.error) await applyRegionGuard(); } catch (_) { /* the check needs the server; without it the suggestions stay as they are */ }
  S.finding = null; S.values = {}; S.prefilled = new Set(); S.prefilledMap = new Set(); S.duration = S.ex.duration; S.expanded = new Set();
  // outside what the demo covers: a pain or swelling finding is offered for words that name neither ("toenail fungus")
  if (S.cand && !S.cand.error && !S.cand.part) {
    const top = S.cand.items.find(inLang);
    if (top && (top.topic === "pain" || top.topic === "swelling")) {
      S.cand.scope = addsTopicWord(S.ex.rest, [top.en, top.sv]);
    }
  }
  const first = S.cand.items.find(inLang);
  if (first && !S.cand.low_confidence && !S.cand.scope && !(S.cand.part && S.cand.part.miss)) await selectFinding(first.code, true);
  else render();
}

// ------------------------------------------------------------------------------------------------ body part check
const regionOf = (r) => S.snap.bodymap.regions.find((x) => x.id === r);
const removeWord = (text, word) => (" " + text + " ").replace(new RegExp(`(?<![\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu"), " ").replace(/\s+/g, " ").trim();

const sitesOf = (regions) => regions.flatMap((r) => S.snap.cfg.bodymap.regions.find((x) => x.id === r)?.codes || []).map((c) => `<< ${c}`).join(" OR ");

/** Which of these finding codes have their finding site inside the given body regions? (SNOMED is-a on the site, asked of the server.) */
async function inRegionCodes(codes, regions) {
  if (S.source !== "client") {
    const set = new Set(regions.flatMap((r) => S.snap.bodymap.findings[r] || []));
    return new Set(codes.filter((c) => set.has(c)));
  }
  if (!codes.length) return new Set();
  const attr = S.snap.cfg.meta.attributes.findingSite;
  const r = await TX.expand(`(${codes.join(" OR ")}) : ${attr} = (${sitesOf(regions)})`, { lang: "en", count: codes.length });
  return new Set(r.items.map((i) => i.code));
}

/**
 * Findings whose site is inside the given body regions and whose names fit the words, best first: [{code, en, sv, topic, sc}].
 * The server's text filter is given the body word only (in its base form); the region is a constraint on the finding site, so the
 * result can never be about another body part.
 */
async function searchInRegions(regions, p) {
  const attr = S.snap.cfg.meta.attributes.findingSite;
  const sites = sitesOf(regions);
  const q = normalizeSymptoms(p.query);
  const findingWords = contentWords(p.bodyWord ? removeWord(q, p.bodyWord) : q);
  const partWords = [...regions.flatMap((r) => [regionOf(r)?.label.sv, regionOf(r)?.label.en]), ...(p.base || [])].filter(Boolean);
  const side = sideOfCode(p.values && p.values.laterality);
  const otherSide = side === "left" ? "right" : side === "right" ? "left" : null;
  const calls = [];
  if (S.source === "client") {
    for (const tp of S.snap.cfg.topics) for (const lang of ["en", "sv"]) {
      // the word as typed and its base form ("handen" is not the start of any term, "hand" is); a compound is searched as it is
      const bases = p.base && p.base.length ? [p.base[lang === "sv" ? 0 : 1]] : [];
      const words = [...new Set([...(p.lang === lang || !p.lang ? [p.bodyWord] : []), ...bases, GENERIC_PAIN.test(findingWords) ? null : findingWords].filter(Boolean))];
      for (const word of words) calls.push(TX.expand(`(${tp.ecl}) : ${attr} = (${sites})`, { filter: word, lang, count: 60, designations: true }).then((r) => ({ tp, lang, r })).catch(() => null));
    }
  }
  const got = (await Promise.all(calls)).filter(Boolean);
  const by = new Map();
  for (const { tp, lang, r } of got) for (const it of r.items) {
    const e = by.get(it.code) || { code: it.code, en: null, sv: null, topic: tp.id, names: [] };
    e[lang] = it.display; e.names.push(...(it.names || []));
    by.set(it.code, e);
  }
  if (S.source !== "client") { // the snapshot already holds the findings of every region
    for (const c of await inRegionCodes([...new Set(regions.flatMap((r) => S.snap.bodymap.findings[r] || []))], regions)) {
      const u = S.known.get(c); if (u) by.set(c, { code: c, en: u[1], sv: u[2], topic: u[3], names: [] });
    }
  }
  const rows = [];
  for (const e of by.values()) {
    if (e.sv === e.en) e.sv = null;
    if (S.lang === "en" && !e.en) continue;
    if (otherSide && mentionsSide([e.en, e.sv], otherSide)) continue; // "right arm" never gets "pain in left arm"
    S.known.set(e.code, [e.code, e.en, e.sv, e.topic]);
    const names = [e.en, e.sv, ...e.names].filter(Boolean);
    // finding words (anything but pain/swelling) must show up in a name: a body part alone does not make a match ("rash" on the arm)
    const fstems = findingWords ? stems(findingWords).filter((w) => !GENERIC.has(w)) : [];
    if (fstems.length && !names.some((n) => fstems.some((w) => stems(n).includes(w)))) continue;
    const sc = Math.max(...names.map((n) => lexScore(q, n)), ...partWords.flatMap((w) => names.map((n) => lexScore(`${findingWords} ${w}`, n))));
    rows.push({ code: e.code, en: e.en, sv: e.sv, topic: e.topic, sc, len: (nmI(e) || "").length });
  }
  rows.sort((a, b) => b.sc - a.sc || a.len - b.len);
  return rows;
}

/** One typed finding that names a body part: suggestions inside that body part come first, the others are marked. */
async function applyRegionGuard() {
  S.cand.part = null;
  const alias = aliasOf(S.ex.rest, S.snap.cfg);
  const bw = alias ? { word: alias.bodyWord, regions: alias.regions, base: [], lang: undefined } : findBodyWord(S.ex.rest, bodyTable(S.snap.cfg));
  if (!bw) return;
  // suggestions found inside the body part itself (the text filter alone may miss them, e.g. "handen" is not a word start of "hand")
  const own = (await searchInRegions(bw.regions, { query: alias ? alias.query : S.ex.rest, bodyWord: alias ? alias.bodyWord : bw.word, base: bw.base, lang: bw.lang, values: S.ex.values })).filter((r) => r.sc >= 0.45).slice(0, 5);
  const items = [...own.map((r) => ({ code: r.code, en: r.en, sv: r.sv, topic: r.topic, score: +r.sc.toFixed(4), confidence: +Math.min(1, r.sc).toFixed(3), scores: { filter: true, lex: +r.sc.toFixed(3), emb: null }, inRegion: true })),
    ...S.cand.items.filter((i) => !own.some((o) => o.code === i.code))];
  const rest = items.filter((i) => i.inRegion === undefined);
  if (rest.length) { const inside = await inRegionCodes(rest.map((i) => i.code), bw.regions); for (const i of rest) i.inRegion = inside.has(i.code); }
  S.cand.items = [...items.filter((i) => i.inRegion), ...items.filter((i) => !i.inRegion)].map((i, n) => ({ ...i, rank: n + 1 }));
  const top = S.cand.items.find(inLang);
  S.cand.low_confidence = !top || !((top.score ?? 0) >= (S.cand.threshold ?? 0.45));
  S.cand.part = { word: bw.word, regions: bw.regions, miss: !S.cand.items.some((i) => i.inRegion) };
}

/** One proposal from a multi-finding text -> {status: ok|none, entry}. The finding must have its site inside the proposal's body part. */
async function resolveProposal(p) {
  const out = { p, status: "none", entry: null };
  try {
    let code = null;
    if (p.regions) {
      const best = (await searchInRegions(p.regions, p))[0];
      if (best && best.sc >= 0.45) code = best.code;
    } else {
      const cand = await candidatesFor(p.query, p.query);
      const first = cand.items.find(inLang);
      if (first && !cand.low_confidence) code = first.code;
    }
    if (!code) return out;
    const f = await loadFinding(code);
    if (!f) return out;
    // the finding must have a finding site inside the body part that was said (asked of the server, not guessed from the first site shown:
    // "Pain in left arm" has the site "left half of body" first and the arm second)
    if (p.regions && !(await inRegionCodes([code], p.regions)).has(code)) return out;
    const vis = new Set(visibleSlots(f));
    const values = {};
    for (const [slot, c] of Object.entries(p.values)) if (vis.has(slot)) values[slot] = c;
    return { p, status: "ok", entry: { finding: f, values, duration: p.duration || null } };
  } catch (e) { return out; }
}

async function startMulti(mp) {
  const m = { items: mp.entries.map((p) => ({ p, status: "resolving", entry: null })) };
  S.multi = m;
  S.cand = null; S.finding = null; S.values = {}; S.prefilled = new Set(); S.prefilledMap = new Set(); S.duration = null; S.confirmed = false;
  render();
  await Promise.all(m.items.map(async (it) => { Object.assign(it, await resolveProposal(it.p)); if (S.multi === m) renderCandidates(); }));
  if (S.multi !== m) return;
  // a clause that was only a maybe and matched nothing is not a finding: its words go back to the finding before it
  const kept = [];
  for (const it of m.items) {
    if (it.p.optional && it.status !== "ok") {
      const prev = kept[kept.length - 1];
      if (prev && prev.entry) for (const [k, v] of Object.entries(it.p.values)) if (prev.entry.values[k] === undefined && visibleSlots(prev.entry.finding).includes(k)) prev.entry.values[k] = v;
    } else kept.push(it);
  }
  m.items = kept;
  if (m.items.length < 2) { S.multi = null; S.ex = extract(S.text, S.snap.cfg, S.snap.labels, S.phrases); await interpretSingle(); return; } // it was one finding after all
  renderCandidates();
  if (liveCheck()) validateAll();
}

function multiAdd(idxs) {
  const m = S.multi;
  if (!m) return;
  for (const i of idxs) if (m.items[i]?.status === "ok") S.chart.push(clone(m.items[i].entry));
  m.items = m.items.filter((_, i) => !idxs.includes(i));
  S.scope = "all";
  if (!m.items.length) { S.multi = null; resetCurrent(); }
  render();
}

function multiReview(i) {
  const it = S.multi?.items[i];
  if (!it || it.status !== "ok") return;
  S.finding = clone(it.entry.finding); S.values = clone(it.entry.values); S.duration = it.entry.duration ? clone(it.entry.duration) : null;
  S.prefilled = new Set(Object.keys(S.values)); S.prefilledMap = new Set(); S.confirmed = false; S.editing = null;
  S.multi.items.splice(i, 1);
  if (!S.multi.items.length) S.multi = null;
  focusMapOn(S.finding);
  render();
  $("#form").scrollIntoView({ behavior: "smooth" });
}

function renderMulti(box) {
  const items = S.multi.items;
  box.append(h("p", { class: "hint", id: "multi-note" }, t("multiFound")));
  const ul = h("ul", { class: "multi" });
  items.forEach((it, i) => {
    const parts = (it.p.regions || []).map(regionLabel).join(" / ");
    let body;
    if (it.status === "resolving") body = h("p", { class: "hint" }, t("resolving"));
    else if (it.status === "ok") body = [h("p", { class: "msent" }, sentence(entryState(it.entry), ctx()).text),
      h("p", { class: "hint" }, "✓ " + t("siteOk") + (it.entry.finding.site ? ": " + plainSite(it.entry.finding.site) : ""))];
    else body = h("p", { class: "warn" }, t("noneInPart"));
    ul.append(h("li", { class: "mitem " + it.status, "data-multi": String(i) },
      h("div", { class: "mhead" }, h("strong", {}, it.p.clause), parts ? h("span", { class: "dim" }, `${t("bodyPart")}: ${parts}`) : null),
      body,
      it.status === "ok" ? h("div", { class: "row tight" },
        h("button", { type: "button", class: "primary small", "data-add-one": String(i), onclick: () => multiAdd([i]) }, t("addOne")),
        h("button", { type: "button", class: "ghost small", "data-review": String(i), onclick: () => multiReview(i) }, t("review"))) : null));
  });
  box.append(ul);
  const ok = items.map((it, i) => (it.status === "ok" ? i : -1)).filter((i) => i >= 0);
  if (ok.length > 1) box.append(h("button", { type: "button", class: "primary", id: "add-all", onclick: () => multiAdd(ok) }, `${t("addAll")} (${ok.length})`));
}

// ------------------------------------------------------------------------------------------------ a tab that the browser closes
// A heavy step (building the semantic index, speech recognition) can use more memory than a phone allows; the browser then closes the tab
// and reloads the page. Before such a step the text and the list are kept in this tab's session storage (never longer than the tab lives);
// if the page comes back with the flag still set, the step is switched off, the text and the list are put back, and the visitor is told.
const ML_FLAG = "penpad-ml-running", ML_SAVED = "penpad-ml-saved";
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* no storage: nothing is kept */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch (_) { /* nothing */ } },
};
function heavyStart(kind) { store.set(ML_FLAG, kind); store.set(ML_SAVED, JSON.stringify({ text: S.text, list: serializeList(S.chart) })); }
function heavyEnd() { store.del(ML_FLAG); store.del(ML_SAVED); }

async function recoverAfterCrash() {
  const kind = store.get(ML_FLAG);
  if (!kind) return false;
  let saved = null;
  try { saved = JSON.parse(store.get(ML_SAVED) || "null"); } catch (_) { saved = null; }
  heavyEnd();
  S.ml.crashed = kind === "sem" || kind === "asr" ? kind : "asr";
  if (saved && typeof saved.text === "string") { S.text = saved.text; $("#text").value = saved.text; }
  if (saved && typeof saved.list === "string") await importListText(saved.list); // checked entry by entry like any opened list
  render();
  const d = $("#ml"); if (d) d.open = true;
  return true;
}

// ------------------------------------------------------------------------------------------------ local models (optional)
/** Every finding of the topics, [code, en, sv, topic]: the local copy, or fetched from the terminology server page by page. */
async function universeRows() {
  if (S.source !== "client") return S.universe;
  const by = new Map();
  for (const tp of S.snap.cfg.topics) for (const lang of ["en", "sv"]) {
    for (let offset = 0; ;) {
      const r = await TX.expand(tp.ecl, { lang, count: 1000, offset });
      for (const it of r.items) { const e = by.get(it.code) || { code: it.code, en: null, sv: null, topic: tp.id }; e[lang] = it.display; by.set(it.code, e); }
      offset += r.items.length;
      if (r.items.length < 1000) break; // a short page is the last one (the server's total is not relied on)
    }
  }
  const rows = [];
  for (const e of by.values()) {
    if (e.sv === e.en) e.sv = null;
    if (!S.known.has(e.code)) S.known.set(e.code, [e.code, e.en, e.sv, e.topic]);
    rows.push([e.code, e.en, e.sv, e.topic]);
  }
  return rows;
}

const pct = (p) => (p && p.total ? ` ${Math.round(100 * p.loaded / p.total)} %` : "");
/** Progress goes to the status line only: the buttons are not rebuilt, so keyboard focus stays where it is. */
function mlStatus(text) { S.ml.status = text || ""; const el = $("#ml-status"); if (el) el.textContent = S.ml.status; }

async function enableSemantic() {
  if (S.ml.sem === "loading" || S.ml.sem === "ready") return;
  S.ml.sem = "loading"; S.ml.semMsg = ""; renderMl(); mlStatus(`${t("semLoading")}: ${t("semFetch")}`);
  heavyStart("sem");
  try {
    const rows = await universeRows();
    S.ml.info = await ML.buildIndex(rows, (p) => mlStatus(`${t("semLoading")}: ` + (p.what === "embedding" ? `${t("semEmbed")} ${p.loaded}/${p.total}` : t("semModel") + pct(p))));
    S.ml.sem = "ready"; S.ml.status = "";
  } catch (e) { S.ml.sem = "error"; S.ml.semMsg = String((e && e.message) || e); S.ml.status = ""; }
  heavyEnd();
  renderMl();
}

let recorder = null, micTimer = null;
function micFail(e) { heavyEnd(); clearTimeout(micTimer); if (recorder) { try { recorder.cancel(); } catch (_) { /* already stopped */ } recorder = null; } S.ml.mic = "error"; S.ml.micMsg = String((e && e.message) || e); S.ml.status = ""; renderMl(); }

async function toggleMic() {
  const M = S.ml;
  if (M.mic === "working" || M.mic === "starting") return; // a second click while the permission prompt is open must not start a second recorder
  if (M.mic !== "recording") {
    M.mic = "starting"; M.micMsg = ""; renderMl(); mlStatus(t("micStarting"));
    try { recorder = await ML.startRecording(); } catch (e) { recorder = null; micFail(e); return; }
    M.mic = "recording"; renderMl(); mlStatus(t("micRecording"));
    micTimer = setTimeout(() => { if (S.ml.mic === "recording") toggleMic(); }, 30000);
    return;
  }
  clearTimeout(micTimer);
  M.mic = "working"; renderMl(); mlStatus(t("micWorking"));
  const lang = S.lang;
  try {
    const rec = recorder; recorder = null;
    const audio = await rec.stop();
    heavyStart("asr");
    const text = await ML.transcribe(audio, lang, (p) => mlStatus(t("micModel") + pct(p)));
    heavyEnd();
    M.mic = "idle"; M.status = ""; M.micMsg = text ? "" : t("micNothing");
    renderMl();
    if (text) { S.text = text; $("#text").value = text; await interpret(); } // the personal-data guard reads the transcript like any typed text
  } catch (e) { micFail(e); }
}

function renderMl() {
  const box = $("#ml");
  if (!box) return;
  const M = S.ml;
  if (!box.dataset.ready) { // closing the panel while recording stops the recording and throws the sound away
    box.dataset.ready = "1";
    box.addEventListener("toggle", () => { if (!box.open && S.ml.mic === "recording") { clearTimeout(micTimer); try { recorder.cancel(); } catch (_) { /* nothing to stop */ } recorder = null; S.ml.mic = "idle"; S.ml.status = ""; renderMl(); } });
  }
  const blocked = (kind) => M.crashed === kind;
  const semBtn = M.sem === "ready"
    ? h("span", { class: "ok", id: "sem-status" }, "✓ " + t("semReady") + (M.info ? ` (${M.info.concepts})` : ""))
    : h("button", { type: "button", class: "ghost small", id: "sem-on", disabled: M.sem === "loading" || blocked("sem"), onclick: enableSemantic }, M.sem === "loading" ? t("semLoading") + "…" : t("semOn").replace("{mb}", String(ML.DOWNLOAD_MB.embed)));
  const canMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const micBtn = canMic ? h("button", { type: "button", class: M.mic === "recording" ? "primary small" : "ghost small", id: "mic", disabled: M.mic === "working" || M.mic === "starting" || blocked("asr"), onclick: toggleMic },
    M.mic === "recording" ? "● " + t("micStop") : t("micStart")) : null;
  const hadFocus = document.activeElement && document.activeElement.id;
  box.replaceChildren(
    h("summary", {}, t("mlTitle")),
    h("div", { class: "row tight" }, semBtn, micBtn),
    M.crashed ? h("div", { class: "warn", id: "crash-note", role: "alert" }, t(M.crashed === "sem" ? "crashSem" : "crashAsr"), " ",
      h("button", { type: "button", class: "ghost small", id: "retry-anyway", onclick: () => { S.ml.crashed = null; renderMl(); } }, t("retryAnyway"))) : null,
    h("p", { class: "hint", id: "ml-status", role: "status", "aria-live": "polite" }, M.status || ""),
    M.sem === "error" ? h("p", { class: "warn", id: "sem-error", role: "alert" }, `${t("semError")}: ${M.semMsg}`) : null,
    M.mic === "error" ? h("p", { class: "warn", id: "mic-error", role: "alert" }, `${t("micError")}: ${M.micMsg}`) : (M.micMsg ? h("p", { class: "hint", id: "mic-msg", role: "status" }, M.micMsg) : null),
    canMic ? h("p", { class: "hint" }, t("micHint").replace("{mb}", String(ML.asrMB(S.lang))) + (ML.lowMemory() ? " " + t("lowMem") : "")) : null,
    h("p", { class: "hint" }, t("mlNote")));
  if (hadFocus === "mic" || hadFocus === "sem-on") { const el = $("#" + hadFocus); if (el && !el.disabled) el.focus(); }
}

window.__penpadML = ML; // for the tests
window.__penpadApi = { clientCandidates: (q, k) => clientCandidates(q, k), enableSemantic: () => enableSemantic() };

function visibleSlots(f) {
  if (!f) return [];
  const topic = S.snap.cfg.topics.find((x) => x.id === f.topic) || S.snap.cfg.topics[0];
  return topic.slots.filter((s) => (s !== "laterality" || (f.site && f.site.lateralizable)) && (s !== "aspect" || f.site));
}

/** Body regions of a finding site, most specific first (asked of the server: the site's ancestors). */
async function ensureSiteRegions(site) {
  const bm = S.snap.bodymap;
  if (bm.siteRegions[site] !== undefined) return;
  const anc = await TX.ancestors(site);
  const regions = S.snap.cfg.bodymap.regions;
  bm.siteRegions[site] = (S.snap.cfg.bodymap.specificity || []).filter((rid) => regions.find((r) => r.id === rid)?.codes.some((c) => anc.has(c)));
}

/** Names and finding site of a finding (from the server in client mode). Throws on a server error. */
async function loadFinding(code) {
  const u = S.known.get(code);
  if (!u) return null;
  let en = u[1], sv = u[2], site = null;
  if (S.source === "client") {
    const [lab, s2] = await Promise.all([TX.labelsFor([code]), TX.findingDetails(code, S.snap.cfg.meta.refsets.lateralizable)]);
    en = lab[code].en || en; sv = lab[code].sv; site = s2;
    if (site) { S.snap.details[code] = site; await ensureSiteRegions(site.code); }
    S.known.set(code, [code, en, sv, u[3]]);
  } else {
    site = S.snap.details[code] || null;
  }
  return { code, en: en || sv, sv, topic: u[3], site };
}

async function selectFinding(code, fromText, fromMap) {
  const u = S.known.get(code);
  if (!u) return;
  let loaded;
  try { loaded = await loadFinding(code); }
  catch (e) { $("#cands").append(h("p", { class: "warn" }, t("txError"))); return; }
  const { en, sv, site } = loaded;
  S.finding = loaded;
  const vis = new Set(visibleSlots(S.finding));
  S.values = {}; S.prefilled = new Set();
  if (fromText && S.ex) {
    for (const [slot, c] of Object.entries(S.ex.values)) if (vis.has(slot)) { S.values[slot] = c; S.prefilled.add(slot); }
    if (S.ex.duration) S.prefilled.add("duration");
  }
  S.prefilledMap = new Set();
  const sel = S.map.sel;
  // pointing at the body is explicit: its side wins over a side that was only in the typed text
  if (sel && sel.side && vis.has("laterality") && (fromMap || !S.values.laterality)) {
    S.values.laterality = CODE_OF_SIDE[sel.side]; S.prefilled.add("laterality"); S.prefilledMap.add("laterality");
  }
  // an aspect chosen next to the map (anterior, medial ...) is explicit too
  if (sel && sel.aspect && vis.has("aspect")) { S.values.aspect = sel.aspect; S.prefilled.add("aspect"); S.prefilledMap.add("aspect"); }
  focusMapOn(S.finding);
  S.confirmed = false;
  render();
  if (liveCheck()) validateAll();
}

async function validateAll() {
  const sts = [...(S.finding ? [gstate()] : []), ...allStates()];
  for (const { code } of codesUsedMany(sts, ctx())) {
    if (S.validation[code]) continue;
    S.validation[code] = { state: "checking" };
    const check = S.source === "client" ? TX.validate(code) : fetch("api/validate?code=" + code).then((r) => r.json());
    check.then((j) => { S.validation[code] = { state: j.ok ? "ok" : "bad" }; renderOutputs(); })
      .catch(() => { S.validation[code] = { state: "build" }; renderOutputs(); });
  }
  renderOutputs();
}

/** Findings of a body region from the server: finding site is that structure or a descendant (ECL attribute search). */
async function ensureRegion(region) {
  const bm = S.snap.bodymap;
  if (bm.findings[region]) return;
  const info = S.snap.cfg.bodymap.regions.find((r) => r.id === region);
  if (info.general) { // "whole body": findings without a body part (fever, cough, ...) are those of the general topic
    const tp = S.snap.cfg.topics.find((x) => x.id === info.general);
    const ecl = tp.headline && tp.headline.length ? tp.headline.join(" OR ") : tp.ecl; // the main symptoms, not every subtype
    const [en, sv] = await Promise.all(["en", "sv"].map((lang) => TX.expand(ecl, { lang, count: 300 })));
    const by = new Map();
    for (const [lang, r] of [["en", en], ["sv", sv]]) for (const it of r.items) { const e = by.get(it.code) || { code: it.code, en: null, sv: null }; e[lang] = it.display; by.set(it.code, e); }
    bm.findings[region] = [...by.values()].map((e) => { if (e.sv === e.en) e.sv = null; S.known.set(e.code, [e.code, e.en, e.sv, tp.id]); return e.code; });
    return;
  }
  const sites = info.codes.map((c) => `<< ${c}`).join(" OR ");
  const attr = S.snap.cfg.meta.attributes.findingSite;
  const calls = [];
  for (const tp of S.snap.cfg.topics) for (const lang of ["en", "sv"]) calls.push(TX.expand(`(${tp.ecl}) : ${attr} = (${sites})`, { lang, count: 300 }).then((r) => ({ tp, lang, r })));
  const got = await Promise.all(calls);
  const by = new Map();
  for (const { tp, lang, r } of got) for (const it of r.items) {
    const e = by.get(it.code) || { code: it.code, en: null, sv: null, topic: tp.id };
    e[lang] = it.display;
    by.set(it.code, e);
  }
  bm.findings[region] = [...by.values()].map((e) => {
    if (e.sv === e.en) e.sv = null;
    S.known.set(e.code, [e.code, e.en, e.sv, e.topic]);
    return e.code;
  });
}

/** Extra options of a slot (more…) from the server, in the same order the snapshot builder uses. */
async function ensureOptions(slot) {
  const sl = S.snap.cfg.slots[slot];
  const [en, sv] = await Promise.all([TX.expand(sl.ecl, { lang: "en", count: 300 }), TX.expand(sl.ecl, { lang: "sv", count: 300 })]);
  const svm = new Map(sv.items.map((i) => [i.code, i.display]));
  const base = [...sl.quick, ...(sl.more || []).filter((c) => !sl.quick.includes(c))];
  const extra = [];
  for (const i of [...en.items].sort((a, b) => a.display.localeCompare(b.display))) {
    if (!base.includes(i.code) && extra.length < sl.limit) {
      extra.push(i.code);
      S.snap.labels[i.code] = { en: i.display, sv: svm.get(i.code) !== i.display ? svm.get(i.code) : null };
    }
  }
  S.snap.options[slot] = [...base.map((code) => ({ code, quick: sl.quick.includes(code) })), ...extra.map((code) => ({ code, quick: false }))];
  S.optionsLoaded.add(slot);
}

// ------------------------------------------------------------------------------------------------ rendering
// ------------------------------------------------------------------------------------------------ ready-made aspect concepts
// SNOMED CT has structures such as "Anterior aspect of knee" for some body parts. When one exists under the finding's site it is shown
// as information next to the aspect (comment in the expression, extra FHIR body site); the finding's own site is never replaced.
S.aspectSites = {};
function aspectSiteOf(f, values) {
  if (!f || !f.site || !values || !values.aspect) return null;
  return S.aspectSites[`${f.site.code}|${values.aspect}`] || null;
}
async function lookupAspectSite(f, values) {
  if (S.source !== "client" || !f || !f.site || !values || !values.aspect) return;
  const key = `${f.site.code}|${values.aspect}`;
  if (key in S.aspectSites) return;
  S.aspectSites[key] = null; // asked once, whatever the answer
  const word = ((S.snap.labels[values.aspect] || {}).en || "").toLowerCase();
  if (!word) return;
  try {
    const r = await TX.expand(`<< ${f.site.code}`, { filter: `${word} aspect`, lang: "en", count: 20 });
    const hit = r.items.find((i) => i.display.toLowerCase().startsWith(`${word} aspect of`));
    if (hit) { S.aspectSites[key] = { code: hit.code, en: hit.display }; renderOutputs(); }
  } catch (_) { /* the aspect then stays a comment without a ready-made structure */ }
}

// ------------------------------------------------------------------------------------------------ list of findings
const entryState = (e) => ({ lang: S.lang, mode: S.mode, finding: e.finding, values: e.values, duration: e.duration, aspectSite: aspectSiteOf(e.finding, e.values) });
const allStates = () => S.chart.map(entryState);
const clone = (x) => JSON.parse(JSON.stringify(x));

function resetCurrent() {
  S.text = ""; S.cand = null; S.finding = null; S.values = {}; S.prefilled = new Set(); S.prefilledMap = new Set(); S.duration = null; S.ex = null; S.confirmed = false;
  S.map.sel = null; S.map.side = null; S.map.view = S.map.main; S.editing = null; S.multi = null;
}

function chartAdd() {
  if (!S.finding) return;
  const entry = clone({ finding: S.finding, values: S.values, duration: S.duration });
  if (S.editing !== null && S.chart[S.editing]) S.chart[S.editing] = entry; else S.chart.push(entry);
  resetCurrent();
  S.scope = "all";
  render();
  const msg = $("#addedmsg"); if (msg) msg.hidden = false;
}

function chartEdit(i) {
  const e = S.chart[i];
  if (!e) return;
  S.finding = clone(e.finding); S.values = clone(e.values); S.duration = e.duration ? clone(e.duration) : null;
  S.prefilled = new Set(); S.prefilledMap = new Set(); S.confirmed = false; S.editing = i; S.cand = null; S.ex = null;
  focusMapOn(S.finding);
  render();
  $("#form").scrollIntoView({ behavior: "smooth" });
}

function chartRemove(i) {
  S.chart.splice(i, 1);
  if (S.editing === i) resetCurrent(); else if (S.editing !== null && S.editing > i) S.editing--;
  if (!S.chart.length) S.scope = "one";
  render();
}

/** Where on the body the listed findings are: [{region, side}] (the most specific region of each finding's site). */
function chartMarks() {
  const marks = [];
  for (const e of S.chart) {
    const regs = e.finding.site ? S.snap.bodymap.siteRegions[e.finding.site.code] : null;
    if (regs && regs.length) marks.push({ region: regs[0], side: sideOfCode(e.values.laterality) });
  }
  return marks;
}

function saveList() {
  const blob = new Blob([serializeList(S.chart)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: "penpad-list.json" });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Open a saved list: codes and answers are read, names are fetched again from the terminology server. */
async function importList(file) {
  const msg = $("#list-msg");
  if (file.size > MAX_BYTES) { msg.hidden = false; msg.textContent = `${t("listProblems")} ${file.name}`; return; }
  await importListText(await file.text());
}

async function importListText(text) {
  const msg = $("#list-msg");
  const say = (text) => { msg.hidden = !text; msg.textContent = text || ""; };
  const parsed = parseList(text, S.snap.cfg);
  const problems = [...parsed.problems];
  let added = 0;
  for (const e of parsed.entries) {
    try {
      if (!S.known.has(e.code)) {
        if (S.source !== "client") { problems.push(`${e.code}: not in this local copy`); continue; }
        const lab = await TX.labelsFor([e.code]);
        S.known.set(e.code, [e.code, lab[e.code].en, lab[e.code].sv, e.topic]);
      }
      const f = await loadFinding(e.code);
      if (!f) { problems.push(`${e.code}: unknown`); continue; }
      f.topic = e.topic;
      const vis = new Set(visibleSlots(f));
      const values = Object.fromEntries(Object.entries(e.values).filter(([k]) => vis.has(k)));
      S.chart.push({ finding: f, values, duration: e.duration });
      added++;
    } catch (_) { problems.push(`${e.code}: ${t("txError")}`); }
  }
  if (added) S.scope = "all";
  render();
  say([added ? `${t("listOpened")} ${added}` : "", problems.length ? `${t("listProblems")} ${problems.join("; ")}` : ""].filter(Boolean).join(" · "));
  if (liveCheck() && added) validateAll();
}

function renderChart() {
  const box = $("#chart");
  box.hidden = !S.chart.length;
  if (!S.chart.length) { box.replaceChildren(); return; }
  box.replaceChildren(h("h2", {}, `${t("chart")} (${S.chart.length})`),
    h("ol", { class: "chartlist" }, S.chart.map((e, i) => h("li", { class: S.editing === i ? "editing" : "", "data-entry": String(i) },
      h("span", { class: "entry" }, sentence(entryState(e), ctx()).text),
      h("span", { class: "row tight" },
        h("button", { type: "button", class: "ghost small", "data-edit": String(i), onclick: () => chartEdit(i) }, t("editEntry")),
        h("button", { type: "button", class: "ghost small", "data-remove": String(i), onclick: () => chartRemove(i) }, t("removeEntry")))))),
    h("button", { type: "button", class: "ghost small", id: "save-list", onclick: saveList, title: t("listNote") }, t("saveList")), " ",
    h("button", { type: "button", class: "ghost small", id: "clear-list", onclick: () => { S.chart = []; S.scope = "one"; resetCurrent(); render(); } }, t("clearList")));
}

function render() {
  document.documentElement.lang = S.lang;
  renderHeader(); renderInput(); renderMap(); renderCandidates(); renderForm(); renderConfirm(); renderChart(); renderOutputs(); renderFoot();
}

function seg(label, options, current, on) {
  return h("div", { class: "seg", role: "group", "aria-label": label },
    h("span", { class: "seglabel" }, label),
    options.map(([v, text]) => h("button", { type: "button", class: "segbtn" + (v === current ? " on" : ""), "aria-pressed": v === current ? "true" : "false", onclick: () => on(v) }, text)));
}

function renderHeader() {
  const el = $("#hdr");
  el.replaceChildren(
    h("div", { class: "hrow" },
      h("div", {}, h("p", { class: "eyebrow" }, "PEN&PAD · Nordic Hackathon 2026"), h("h1", {}, t("title")), h("p", { class: "lede" }, t("sub"))),
      h("div", { class: "ctl" },
        seg(t("lang"), [["sv", "SV"], ["en", "EN"]], S.lang, (v) => { S.lang = v; render(); }),
        seg(t("mode"), [["clinician", t("clinician")], ["patient", t("patient")]], S.mode, (v) => { S.mode = v; render(); }))),
    h("p", { class: "badge " + (S.live || S.source === "client" ? "live" : "static") }, S.source === "client" ? t("clientNote") : S.live ? `${t("liveNote")} (${S.liveModel || "model"})` : t("staticNote")));
}

function renderInput() {
  const box = $("#input");
  if (!box.dataset.ready) {
    box.dataset.ready = "1";
    box.append(
      h("h2", { id: "h-in" }, ""),
      h("label", { for: "text", class: "sr" }, "text"),
      h("textarea", { id: "text", rows: "2", spellcheck: "false" }),
      h("div", { class: "row" }, h("button", { id: "go", type: "button", class: "primary" }, ""), h("button", { id: "rs", type: "button", class: "ghost" }, ""),
        h("button", { id: "open-list", type: "button", class: "ghost" }, ""), h("input", { id: "import-file", type: "file", accept: "application/json,.json", hidden: true })),
      h("p", { id: "list-msg", class: "hint", hidden: true }),
      h("details", { id: "ml", class: "mlbox" }),
      h("p", { id: "notes", class: "hint" }), h("div", { id: "samples", class: "chips" }));
    $("#text").addEventListener("input", (e) => { S.text = e.target.value; });
    $("#text").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); interpret(); } });
    $("#go").addEventListener("click", () => interpret());
    $("#open-list").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) importList(f); e.target.value = ""; });
    $("#rs").addEventListener("click", () => { S.text = ""; $("#text").value = ""; S.cand = null; S.finding = null; S.values = {}; S.duration = null; S.ex = null; S.map.sel = null; S.map.side = null; S.map.view = S.map.main; S.prefilledMap = new Set(); S.multi = null; render(); });
  }
  $("#h-in").textContent = t("s1");
  $("#text").placeholder = t("ph");
  if ($("#text").value !== S.text) $("#text").value = S.text;
  $("#go").textContent = t("go"); $("#rs").textContent = t("reset"); $("#open-list").textContent = t("openList");
  $("#notes").textContent = t(S.source === "client" ? "localNoteClient" : "localNote");
  $("#ml").hidden = S.source !== "client"; // the local models are wired to the client mode (the public site)
  renderMl();
  $("#samples").replaceChildren(h("span", { class: "seglabel" }, t("tryThese")),
    ...examples().map((txt) => h("button", { type: "button", class: "chip", onclick: () => { S.text = txt; $("#text").value = txt; interpret(); } }, txt.length > 46 ? txt.slice(0, 44) + "…" : txt)));
}

// ------------------------------------------------------------------------------------------------ body map
const regionInfo = (r) => S.snap.bodymap.regions.find((x) => x.id === r);
const regionLabel = (r) => (regionInfo(r)?.label[S.lang]) || r;
const viewLabel = (v) => (v === "hand" ? regionLabel(v) : t("zoom_" + v));
const sideLabel = (side) => (side === "left" ? t("sideL") : side === "right" ? t("sideR") : "");

function currentHl() {
  const f = S.finding;
  const regs = f && f.site ? S.snap.bodymap.siteRegions[f.site.code] : null;
  return regs && regs.length ? { region: regs[0], side: sideOfCode(S.values.laterality) } : null;
}

/** Show the part of the body where the chosen finding sits (switch front/back or leave a zoom if needed). */
function focusMapOn(f) {
  const regs = f && f.site ? S.snap.bodymap.siteRegions[f.site.code] : null;
  if (!regs || !regs.length) return;
  const M = S.map;
  if (drawnIn(M.view, regs[0], M.side)) return;
  const mv = mainViewFor(regs[0], M.main);
  if (mv) { M.view = mv.view; M.main = mv.view; }
}

function onRegion(region, side) {
  const M = S.map;
  const sameSel = M.sel && M.sel.region === region && (M.sel.side || null) === (side || null);
  if ((M.view === "front" || M.view === "back") && ZOOM_OF[region]) {
    M.main = M.view; M.view = ZOOM_OF[region]; M.side = side; M.sel = { region, side }; M.more = false;
  } else if (sameSel) { M.sel = null; }
  else { M.sel = { region, side }; M.more = false; }
  renderMap();
}

const aspectName = (c) => { const L = S.snap.labels[c]; return (L && (S.lang === "sv" ? L.sv || L.en : L.en)) || c; };

function chooseAspect(c) {
  const M = S.map;
  M.sel.aspect = M.sel.aspect === c ? null : c;
  if (S.finding && visibleSlots(S.finding).includes("aspect")) {
    if (M.sel.aspect) { S.values.aspect = M.sel.aspect; S.prefilled.add("aspect"); S.prefilledMap.add("aspect"); }
    else { delete S.values.aspect; S.prefilled.delete("aspect"); S.prefilledMap.delete("aspect"); }
    render();
    if (liveCheck()) validateAll();
  } else renderMap();
}

function mapFindings() {
  const M = S.map;
  if (!M.sel) return null;
  const bm = S.snap.bodymap;
  const codes = bm.findings[M.sel.region] || [];
  const rest = S.ex && S.ex.rest;
  const name = (u) => (S.lang === "sv" ? u[2] || u[1] : u[1]) || "";
  // a chosen side removes findings that name the other side ("left thumb" when the right hand was clicked)
  const other = M.sel.side === "left" ? "right" : M.sel.side === "right" ? "left" : null;
  const rows = codes.map((c) => S.known.get(c)).filter(Boolean).filter((u) => M.topic === "all" || u[3] === M.topic)
    .filter((u) => !other || !mentionsSide([u[1], u[2]], other))
    .filter((u) => S.lang !== "en" || u[1])
    .map((u) => ({ u, score: rest ? Math.max(lexScore(rest, u[1]), u[2] ? lexScore(rest, u[2]) : 0) : 0 }));
  rows.sort((a, b) => b.score - a.score || name(a.u).localeCompare(name(b.u), S.lang));
  return rows;
}

function renderMap() {
  const box = $("#map");
  const M = S.map;
  const zoom = M.view !== "front" && M.view !== "back";
  box.replaceChildren(h("h2", {}, t("mapTitle")));
  box.append(zoom
    ? h("div", { class: "row tight" }, h("button", { type: "button", class: "ghost small", id: "bm-back", onclick: () => { M.view = M.main; renderMap(); } }, t("toBody")),
        h("span", { class: "dim" }, viewLabel(M.view) + (M.side && M.view !== "headsection" && M.view !== "backzoom" ? ", " + sideLabel(M.side) : "")))
    : seg("", [["front", t("front")], ["back", t("back")]], M.view, (v) => { M.view = v; M.main = v; renderMap(); }));
  box.append(h("button", { type: "button", class: "ghost small" + (M.sel && M.sel.region === "whole" ? " on" : ""), id: "bm-whole", onclick: () => { M.sel = { region: "whole", side: null }; M.more = false; renderMap(); } }, t("wholeBody")));
  const host = h("div", { class: "bmhost", id: "bmhost" });
  box.append(host);
  drawBodyMap(host, { view: M.view, side: M.side, sel: M.sel, hl: currentHl(), chart: chartMarks(), regionLabel, sideLabel }, { region: onRegion });
  box.append(h("div", { class: "legend" }, h("span", { class: "sw sel" }), t("legendSel"), h("span", { class: "sw hl" }), t("legendHl"), S.chart.length ? [h("span", { class: "sw ch" }), t("legendChart")] : null));
  if (!M.sel) { box.append(h("p", { class: "hint" }, t("mapHint"))); return; }
  box.append(h("div", { class: "loc" }, h("strong", {}, t("location") + ": "), regionLabel(M.sel.region) + (M.sel.side ? " (" + sideLabel(M.sel.side) + ")" : ""),
    h("button", { type: "button", class: "ghost small", onclick: () => { M.sel = null; renderMap(); } }, "×")));
  const info = regionInfo(M.sel.region);
  const subs = S.snap.cfg.bodymap.subregions[M.sel.region] || [];
  if (info?.parent || subs.length) {
    const go = (r) => () => { M.sel = { region: r, side: M.sel.side, aspect: M.sel.aspect }; M.more = false; renderMap(); };
    box.append(h("div", { class: "subs" }, h("span", { class: "seglabel" }, t("subs")),
      info?.parent ? h("button", { type: "button", class: "chip", "data-sub": info.parent, onclick: go(info.parent) }, "↑ " + regionLabel(info.parent)) : null,
      subs.map((r) => h("button", { type: "button", class: "chip", "data-sub": r, onclick: go(r) }, regionLabel(r)))));
  }
  // the aspect of the chosen site (the body's counterpart of a tooth surface): anterior, posterior, medial, lateral, proximal, distal
  const aspects = S.snap.cfg.slots.aspect.quick;
  box.append(h("div", { class: "subs" }, h("span", { class: "seglabel" }, S.snap.cfg.slots.aspect.label[S.lang]),
    aspects.map((c) => h("button", { type: "button", class: "chip" + (M.sel.aspect === c ? " on" : ""), "data-aspect": c, "aria-pressed": M.sel.aspect === c ? "true" : "false",
      onclick: () => chooseAspect(c) }, aspectName(c)))));
  box.append(seg("", [["all", t("all")], ...S.snap.cfg.topics.map((x) => [x.id, x.label[S.lang]])], M.topic, (v) => { M.topic = v; M.more = false; renderMap(); }));
  if (S.source === "client" && !S.snap.bodymap.findings[M.sel.region]) {
    const want = M.sel.region;
    box.append(h("p", { class: "hint", id: "maploading" }, t("loading")));
    ensureRegion(want).then(() => { if (S.map.sel && S.map.sel.region === want) renderMap(); })
      .catch(() => box.append(h("p", { class: "warn" }, t("txError"))));
    return;
  }
  const rows = mapFindings();
  box.append(h("h3", { class: "listh" }, `${t("findingsHere")} (${rows.length})`));
  if (!rows.length) { box.append(h("p", { class: "hint" }, t("noFindings"))); return; }
  const shown = rows.slice(0, M.more ? 60 : 10);
  box.append(h("ul", { class: "maplist" }, shown.map(({ u }) => {
    const on = S.finding && S.finding.code === u[0];
    return h("li", {}, h("button", { type: "button", class: "mapitem" + (on ? " on" : ""), "data-code": u[0], onclick: () => selectFinding(u[0], !!S.ex, true) },
      h("span", {}, S.lang === "sv" ? u[2] || u[1] : u[1]), h("span", { class: "mono dim" }, u[0])));
  })));
  if (rows.length > shown.length) box.append(h("button", { type: "button", class: "ghost small", onclick: () => { M.more = true; renderMap(); } }, `${t("showMore")} (+${rows.length - shown.length})`));
}

function bar(v) { return h("span", { class: "bar", "aria-hidden": "true" }, h("i", { style: `width:${Math.round(Math.min(1, v) * 100)}%` })); }

function renderCandidates() {
  const box = $("#cands");
  box.replaceChildren(h("h2", {}, t("s2")));
  if (S.multi) { renderMulti(box); return; }
  if (!S.cand) { box.append(h("p", { class: "hint" }, t("nothing"))); return; }
  const both = S.live || (S.sampleHit && S.sampleHit.candidates.rerank);
  if (both) {
    box.append(seg("", [["text", t("baseline")], ["rerank", t("rerank")]], S.candMode, async (m) => { S.candMode = m; S.cand = await candidatesFor(S.ex.rest, S.text); render(); }));
  }
  const shownItems = S.cand.items.filter(inLang);
  if (S.cand.error) box.append(h("p", { class: "warn", id: "cand-error" }, t(S.cand.error === "personal" ? "personal" : "txError")));
  else if (S.cand.part && S.cand.part.miss) box.append(h("p", { class: "warn", id: "part-miss" }, "⚠ " + t("partMiss")));
  else if (!shownItems.length) box.append(h("p", { class: "warn" }, t("noMatch")));
  else if (S.cand.scope) box.append(h("p", { class: "warn", id: "scope-note" }, "⚠ " + t("scopeNote")));
  else if (S.cand.low_confidence) box.append(h("p", { class: "warn" }, "⚠ " + t("lowConf")));
  const list = h("ul", { class: "cands" });
  for (const it of shownItems.slice(0, 5)) {
    const sel = S.finding && S.finding.code === it.code;
    const det = S.snap.details[it.code];
    list.append(h("li", { class: "cand" + (sel ? " sel" : "") },
      h("div", { class: "cmain" },
        h("div", { class: "cname" }, h("strong", {}, nmI(it)), S.lang === "sv" && it.sv && it.en ? h("span", { class: "alt" }, it.en) : null,
          S.cand.part && it.inRegion === false ? h("span", { class: "tag offreg" }, t("otherPart")) : null),
        h("div", { class: "cmeta" },
          h("a", { href: browserLink(it.code), target: "_blank", rel: "noopener", class: "mono" }, it.code),
          det ? h("span", {}, `${t("site")}: ${plainSite(det)} (${det.lateralizable ? t("sided") : t("notSided")})`) : null,
          h("span", { class: "mono dim" }, `lex ${it.scores.lex}` + (it.scores.emb != null ? ` · emb ${it.scores.emb}` : "")))),
      bar(it.confidence ?? it.score),
      h("button", { type: "button", class: sel ? "ghost" : "primary small", onclick: () => selectFinding(it.code, true) }, sel ? t("picked") : t("pick"))));
  }
  box.append(list);
  if (S.cand.low_confidence || !shownItems.length) box.append(manualSearch());
}

function manualSearch() {
  const wrap = h("div", { class: "manual" });
  const input = h("input", { type: "search", id: "manual", placeholder: t("search"), value: S.manual, "aria-label": t("search") });
  const out = h("ul", { class: "cands small" });
  const draw = (items) => out.replaceChildren(...items.filter(inLang).map((it) => h("li", { class: "cand" }, h("div", { class: "cmain" }, h("strong", {}, nmI(it)), h("span", { class: "mono dim" }, it.code)),
    h("button", { type: "button", class: "primary small", onclick: () => selectFinding(it.code, true) }, t("pick")))));
  let timer = null;
  const run = () => {
    S.manual = input.value;
    if (S.source === "client") {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = S.manual.trim();
        if (q.length < 2) { draw([]); return; }
        try { draw((await clientCandidates(q, 8)).items); } catch (e) { out.replaceChildren(h("li", { class: "warn" }, t(e && e.message === PERSONAL_DATA_ERROR ? "personal" : "txError"))); }
      }, 300);
      return;
    }
    draw(rankLexical(S.manual, S.universe, 8, 0).items);
  };
  input.addEventListener("input", run);
  wrap.append(input, out);
  queueMicrotask(run);
  return wrap;
}

function slotBlock(slot) {
  const cfg = S.snap.cfg.slots[slot];
  const blk = h("div", { class: "slot", "data-slot": slot });
  const filled = S.prefilled.has(slot);
  blk.append(h("div", { class: "slothead" }, h("span", { class: "slotname" }, cfg.label[S.lang]), filled ? h("span", { class: "tag" }, "✎ " + t(S.prefilledMap.has(slot) ? "fromMap" : "prefilled")) : null));
  if (cfg.kind === "duration") {
    const n = h("input", { type: "number", min: "1", max: "999", id: "dur-n", "aria-label": t("num"), value: S.duration ? S.duration.n : "" });
    const u = h("select", { id: "dur-u", "aria-label": t("unit") }, S.snap.cfg.units.map((x) => h("option", { value: x.key, selected: S.duration && S.duration.unit === x.key }, S.lang === "sv" ? x.svLabel[1] : x.en[1] || x.en[0])));
    const upd = () => { const v = parseInt(n.value, 10); S.duration = v > 0 ? { n: v, unit: u.value } : null; S.prefilled.delete("duration"); S.confirmed = false; renderConfirm(); renderOutputs(); };
    n.addEventListener("input", upd); u.addEventListener("change", () => { if (n.value) upd(); });
    blk.append(h("div", { class: "row" }, n, u, h("button", { type: "button", class: "ghost small", onclick: () => { S.duration = null; S.confirmed = false; renderForm(); renderConfirm(); renderOutputs(); } }, t("clear"))));
    return blk;
  }
  const opts = S.snap.options[slot];
  const quick = opts.filter((o) => o.quick);
  const extra = opts.filter((o) => !o.quick);
  const open = S.expanded.has(slot);
  const shown = open ? opts : quick;
  const row = h("div", { class: "btns" });
  for (const o of shown) {
    const on = S.values[slot] === o.code;
    row.append(h("button", { type: "button", class: "opt" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", onclick: () => {
      if (on) delete S.values[slot]; else S.values[slot] = o.code;
      S.prefilled.delete(slot); S.prefilledMap.delete(slot); S.confirmed = false; renderForm(); renderConfirm(); renderOutputs(); renderMap(); if (liveCheck()) validateAll();
    } }, lab(o.code)));
  }
  const canLoad = S.source === "client" && cfg.limit && !S.optionsLoaded.has(slot);
  if (extra.length || canLoad) {
    row.append(h("button", { type: "button", class: "opt more", "aria-expanded": open ? "true" : "false", onclick: async () => {
      if (open) S.expanded.delete(slot);
      else { if (canLoad) { try { await ensureOptions(slot); } catch (_) { return; } } S.expanded.add(slot); }
      renderForm();
    } }, open ? t("fewer") : extra.length ? `${t("more")} (+${extra.length})` : t("more")));
  }
  blk.append(row);
  const ecl = h("details", { class: "why" }, h("summary", {}, t("why")),
    h("p", {}, t("whyText")), h("code", { class: "ecl" }, cfg.ecl), h("p", { class: "hint" }, t("quickText")), slot === "laterality" ? h("p", { class: "hint" }, t("latWhy")) : null);
  blk.append(ecl);
  return blk;
}

function renderForm() {
  const box = $("#form");
  box.replaceChildren(h("h2", {}, t("s3")));
  if (!S.finding) { box.append(h("p", { class: "hint" }, t("pickFinding"))); return; }
  const f = S.finding;
  box.append(h("div", { class: "found" },
    h("strong", {}, S.lang === "sv" ? f.sv || f.en : f.en), h("a", { href: browserLink(f.code), target: "_blank", rel: "noopener", class: "mono" }, f.code),
    f.site ? h("span", { class: "dim" }, `${t("site")}: ${plainSite(f.site)}`) : null));
  const grid = h("div", { class: "slots" });
  for (const s of visibleSlots(f)) grid.append(slotBlock(s));
  box.append(grid);
}

function renderConfirm() {
  const box = $("#confirm");
  box.replaceChildren(h("h2", {}, t("s4")));
  if (!S.finding) { box.append(h("p", { class: "hint" }, t("pickFinding"))); return; }
  const r = sentence(gstate(), ctx());
  box.append(h("blockquote", { class: "sentence", id: "sentence" }, r.text));
  if (r.fallbacks.length) box.append(h("p", { class: "hint" }, t("fallback") + " " + r.fallbacks.map((c) => `${S.snap.labels[c]?.en || c}`).join(", ")));
  if (S.lang === "sv") box.append(h("p", { class: "hint" }, t("unreviewed")));
  box.append(h("div", { class: "row" },
    h("button", { type: "button", class: "primary", id: "yes", onclick: () => { S.confirmed = true; renderConfirm(); } }, t("yes")),
    h("button", { type: "button", class: "secondary", id: "add", onclick: chartAdd }, S.editing !== null ? t("updateEntry") : t("addToList")),
    h("button", { type: "button", class: "ghost", onclick: () => $("#form").scrollIntoView({ behavior: "smooth" }) }, t("edit"))));
  if (S.confirmed) box.append(h("p", { class: "ok", id: "okmsg" }, "✓ " + t("confirmed")));
  box.append(h("p", { class: "hint" }, S.editing !== null ? t("editingNote") : t("chartHint")));
}

function pre(text, extraNote) {
  const p = h("pre", { class: "out" }, text);
  const btn = h("button", { type: "button", class: "ghost small", onclick: async (e) => {
    try { await navigator.clipboard.writeText(text); e.target.textContent = t("copied"); }
    catch (_) { const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    setTimeout(() => { e.target.textContent = t("copy"); }, 1400);
  } }, t("copy"));
  return h("div", { class: "outwrap" }, h("div", { class: "outbar" }, extraNote ? h("span", { class: "hint" }, extraNote) : h("span"), btn), p);
}

function statusCell(code) {
  const v = S.validation[code];
  if (liveCheck() && v) {
    if (v.state === "checking") return h("span", { class: "dim" }, t("checking"));
    if (v.state === "ok") return h("span", { class: "okc" }, "✓ " + t("okLive"));
    if (v.state === "bad") return h("span", { class: "badc" }, "✗ " + t("bad"));
  }
  return h("span", { class: "okc" }, "✓ " + t("okBuild"));
}

function renderOutputs() {
  const box = $("#outputs");
  if (S.finding) lookupAspectSite(S.finding, S.values);
  for (const e of S.chart) lookupAspectSite(e.finding, e.values);
  box.replaceChildren(h("h2", {}, t("s5")));
  if (!S.finding && !S.chart.length) { box.append(h("p", { class: "hint" }, t("pickFinding"))); return; }
  // with a list: one finding or the whole list (the list alone when no finding is open)
  const all = S.chart.length > 0 && (S.scope === "all" || !S.finding);
  if (S.chart.length && S.finding) box.append(seg("", [["one", t("scopeOne")], ["all", `${t("scopeAll")} (${S.chart.length})`]], S.scope, (v) => { S.scope = v; renderOutputs(); }));
  const states = all ? allStates() : [gstate()];
  const tabs = h("div", { class: "tabs", role: "tablist" }, Object.entries(t("tabs")).map(([k, v]) => h("button", { type: "button", role: "tab", class: "tab" + (S.tab === k ? " on" : ""), "aria-selected": S.tab === k ? "true" : "false", onclick: () => { S.tab = k; renderOutputs(); } }, v)));
  box.append(tabs);
  const c = ctx();
  const time = "2026-11-18T12:00:00Z";
  if (S.tab === "expr") box.append(pre(expressionMany(states, c), t("exprNote")));
  else if (S.tab === "oe") {
    const r = openEhrMany(states, c, { time });
    box.append(pre(JSON.stringify(r.composition, null, 2)));
    if (r.unmapped.length) box.append(h("div", { class: "callout" }, h("strong", {}, t("unmapped")), h("ul", {}, r.unmapped.map((u) => h("li", {}, `${u.key}: ${u.reason}`)))));
  } else if (S.tab === "fhir") box.append(pre(JSON.stringify(all ? fhirBundle(states, c, { time }) : fhirCondition(states[0], c, { time }), null, 2)));
  else {
    const rows = codesUsedMany(states, c);
    const termOf = (r) => r.role === "finding site" ? (S.lang === "sv" ? r.finding.site.sv || r.finding.site.en : r.finding.site.en) : r.role === "finding" ? (S.lang === "sv" ? r.finding.sv || r.finding.en : r.finding.en) : lab(r.code);
    box.append(h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, [t("role"), t("code"), t("term"), t("status")].map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, (I[S.lang].role_ || {})[r.role] || S.snap.cfg.slots[r.role]?.label[S.lang] || r.role), h("td", {}, h("a", { href: browserLink(r.code), target: "_blank", rel: "noopener", class: "mono" }, r.code)),
        h("td", {}, termOf(r)), h("td", {}, statusCell(r.code))))))));
  }
}

function renderFoot() {
  $("#foot").replaceChildren(t("foot") + " ", h("a", { href: "THIRD_PARTY_NOTICES.md", target: "_blank", rel: "noopener" }, t("notices")));
}

init();
