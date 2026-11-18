// PEN&PAD smart forms demo: free text -> SNOMED CT finding -> only the valid follow-up questions -> confirmation
// sentence + SNOMED expression + openEHR + FHIR. Runs on a static snapshot; if a backend answers /api/health it
// also uses the embedding model for candidates and validates codes live against the terminology server.

import { extract, buildPhrases } from "./extract.js";
import { sentence, expression, openEhr, fhirCondition, codesUsed, term } from "./generators.js";
import { rankLexical, lexScore, contentWords, normalizeSymptoms } from "./lexrank.js";
import { drawBodyMap, ZOOMABLE, mainViewFor, drawnIn, sideOfCode, mentionsSide } from "./bodymap.js";
import * as TX from "./txclient.js";
import { personalDataReason, PERSONAL_DATA_ERROR } from "./guard.js";

const I = {
  sv: {
    title: "Smarta formulär med SNOMED CT",
    sub: "Skriv vad patienten har. Systemet föreslår ett begrepp, frågar bara det som är giltigt och bekräftar med en mening.",
    lang: "Språk", mode: "Läge", clinician: "Klinik", patient: "Patient",
    notices: "Licenser och tredjepartsmaterial", subs: "Delområden", loading: "Laddar…", txError: "Kunde inte nå terminologiservern.",
    clientNote: "Live mot HL7 Nordics terminologiserver, direkt från din webbläsare. Den här sidan lagrar inget SNOMED-innehåll. Ingen modell: förslagen kommer från serverns textfilter.",
    mapTitle: "…eller peka på kroppen", front: "Fram", back: "Bak", toBody: "← Hela kroppen", location: "Plats",
    mapHint: "Klicka på en kroppsdel. Hand, fot och huvud zoomar in. Sidan du klickar på blir patientens sida.",
    findingsHere: "Fynd på vald plats", showMore: "Visa fler", all: "Alla", noFindings: "Inga fynd i listan för den här platsen.",
    fromMap: "ifyllt från kroppskartan", sideL: "vänster", sideR: "höger", legendSel: "vald av dig", legendHl: "plats för valt fynd",
    s1: "1. Berätta", s2: "2. Förslag", s3: "3. Förfina", s4: "4. Stämmer det här?", s5: "5. Utdata",
    ph: "Till exempel: smärta i vänster tumme sedan två dagar, bultande",
    go: "Tolka", reset: "Börja om", tryThese: "Prova",
    localNote: "Texten tolkas i din webbläsare. Bara kodslagningar går till terminologiservern.",
    localNoteClient: "Sökorden (inte hela texten) skickas till terminologiservern, en tredje part. Skriv inga personuppgifter: demon är bara för påhittade exempel.",
    personal: "Texten ser ut att innehålla en personuppgift (personnummer eller e-postadress). Den skickas inte någonstans. Demon är bara för påhittade exempel.",
    staticNote: "Demoläge: data är en förberäknad kopia av SNOMED CT från servern. Omrankning med modell finns bara för exempelfraserna.",
    liveNote: "Live: omrankning med en lokal modell och kontroll av koder mot terminologiservern.",
    nothing: "Skriv något och tryck Tolka.", noMatch: "Ingen säker träff. Välj själv i listan eller sök nedan.",
    lowConf: "Låg säkerhet. Kontrollera förslaget.", pick: "Välj", picked: "Valt",
    baseline: "Baslinje (textfilter)", rerank: "Omrankning (modell)",
    site: "Plats", sided: "kan ha sida", notSided: "ingen sida",
    prefilled: "ifyllt från din text", more: "fler…", fewer: "färre", why: "Varför de här alternativen?",
    whyText: "Alternativen kommer från terminologiservern med den här ECL-frågan:",
    quickText: "Snabbvalen är en kort lista inom samma mängd.",
    latWhy: "Sida visas bara för kroppsdelar i SNOMED CT:s referensmängd 'lateralizable body structure'.",
    num: "Antal", unit: "Enhet", clear: "Rensa",
    yes: "Ja, det stämmer", edit: "Ändra", confirmed: "Bekräftat i demon. Ingenting sparas.",
    fallback: "Visas på engelska eftersom svenska SNOMED CT saknar term:",
    pickFinding: "Välj ett begrepp ovan för att få fråga.",
    tabs: { expr: "SNOMED-uttryck", oe: "openEHR", fhir: "FHIR", codes: "Koder" },
    copy: "Kopiera", copied: "Kopierat", unmapped: "Ej mappat i openEHR-mallen",
    exprNote: "Efterkoordinerat uttryck. Själva uttrycket har inte validerats mot en server.",
    code: "Kod", role: "Roll", term: "Term", status: "Status",
    okBuild: "finns i serverns utvidgning vid bygget", okLive: "validerad mot servern nu", checking: "kontrollerar…", bad: "ogiltig",
    search: "Sök i begreppen (t.ex. fot, hals, mage)", results: "Träffar",
    foot: "Demo, inte beslutsstöd. Inga riktiga patientdata. SNOMED CT-innehåll via HL7 Nordics terminologiserver, svenska termer från Sveriges SNOMED CT-modul.",
    role_: { finding: "fynd", "finding site": "fyndplats" },
    sample: "Exempel", unreviewed: "Svenska formuleringar utöver SNOMED-termerna är våra och inte granskade.",
  },
  en: {
    title: "Smart forms with SNOMED CT",
    sub: "Type what the patient has. The system proposes a concept, asks only what is valid and confirms with a sentence.",
    lang: "Language", mode: "Mode", clinician: "Clinician", patient: "Patient",
    notices: "Licences and third-party material", subs: "Sub-areas", loading: "Loading…", txError: "Could not reach the terminology server.",
    clientNote: "Live against the HL7 Nordics terminology server, straight from your browser. This page stores no SNOMED content. No model: suggestions come from the server text filter.",
    mapTitle: "…or point at the body", front: "Front", back: "Back", toBody: "← Whole body", location: "Site",
    mapHint: "Click a body part. Hand, foot and head zoom in. The side you click becomes the patient's side.",
    findingsHere: "Findings at the chosen site", showMore: "Show more", all: "All", noFindings: "No findings listed for this site.",
    fromMap: "filled from the body map", sideL: "left", sideR: "right", legendSel: "chosen by you", legendHl: "site of the chosen finding",
    s1: "1. Tell", s2: "2. Suggestions", s3: "3. Refine", s4: "4. Is this what you meant?", s5: "5. Output",
    ph: "For example: pain in the left thumb for two days, throbbing",
    go: "Interpret", reset: "Start over", tryThese: "Try",
    localNote: "The text is interpreted in your browser. Only code lookups go to the terminology server.",
    localNoteClient: "The search words (not the whole text) are sent to the terminology server, a third party. Do not type personal data: the demo is for made-up examples only.",
    personal: "The text looks like it contains personal data (an identity number or an e-mail address). It is not sent anywhere. The demo is for made-up examples only.",
    staticNote: "Demo mode: data is a precomputed copy of SNOMED CT from the server. Model re-ranking exists only for the sample phrases.",
    liveNote: "Live: re-ranking with a local model and code checks against the terminology server.",
    nothing: "Type something and press Interpret.", noMatch: "No confident match. Pick from the list or search below.",
    lowConf: "Low confidence. Please check the suggestion.", pick: "Pick", picked: "Picked",
    baseline: "Baseline (text filter)", rerank: "Re-ranked (model)",
    site: "Site", sided: "can have a side", notSided: "no side",
    prefilled: "filled from your text", more: "more…", fewer: "fewer", why: "Why these options?",
    whyText: "The options come from the terminology server with this ECL query:",
    quickText: "The quick choices are a short list within the same set.",
    latWhy: "Side is shown only for body structures in the SNOMED CT reference set 'lateralizable body structure'.",
    num: "Number", unit: "Unit", clear: "Clear",
    yes: "Yes, that is right", edit: "Edit", confirmed: "Confirmed in the demo. Nothing is saved.",
    fallback: "Shown in English because Swedish SNOMED CT has no term:",
    pickFinding: "Pick a concept above to get the questions.",
    tabs: { expr: "SNOMED expression", oe: "openEHR", fhir: "FHIR", codes: "Codes" },
    copy: "Copy", copied: "Copied", unmapped: "Not mapped in the openEHR template",
    exprNote: "Post-coordinated expression. The expression itself has not been validated by a server.",
    code: "Code", role: "Role", term: "Term", status: "Status",
    okBuild: "in the server's expansion at build time", okLive: "validated against the server now", checking: "checking…", bad: "invalid",
    search: "Search the concepts (e.g. foot, throat, stomach)", results: "Results",
    foot: "Demo, not decision support. No real patient data. SNOMED CT content via the HL7 Nordics terminology server, Swedish terms from the Swedish SNOMED CT module.",
    role_: { finding: "finding", "finding site": "finding site" },
    sample: "Example", unreviewed: "Swedish wording beyond the SNOMED terms is ours and unreviewed.",
  },
};

const S = {
  snap: null, source: "snapshot", known: new Map(), universe: [], optionsLoaded: new Set(), live: false, lang: "sv", mode: "clinician", text: "", ex: null, cand: null, candMode: "rerank",
  finding: null, values: {}, prefilled: new Set(), duration: null, expanded: new Set(), confirmed: false,
  tab: "expr", validation: {}, manual: "", sampleHit: null,
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
const gstate = () => ({ lang: S.lang, mode: S.mode, finding: S.finding, values: S.values, duration: S.duration });
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
  const top = rows.slice(0, 12);
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
  S.confirmed = false;
  if (personalDataReason(S.text)) {
    S.cand = { query: "", items: [], low_confidence: true, error: "personal" };
    S.finding = null; S.values = {}; S.prefilled = new Set(); S.duration = null; S.ex = null;
    render();
    return;
  }
  S.ex = extract(S.text, S.snap.cfg, S.snap.labels, S.phrases);
  try { S.cand = await candidatesFor(S.ex.rest, S.text); }
  catch (e) { S.cand = { query: S.text, mode: "text", items: [], low_confidence: true, error: e && e.message === PERSONAL_DATA_ERROR ? "personal" : true }; }
  S.finding = null; S.values = {}; S.prefilled = new Set(); S.prefilledMap = new Set(); S.duration = S.ex.duration; S.expanded = new Set();
  const first = S.cand.items.find(inLang);
  if (first && !S.cand.low_confidence) await selectFinding(first.code, true);
  else render();
}

function visibleSlots(f) {
  if (!f) return [];
  const topic = S.snap.cfg.topics.find((x) => x.id === f.topic) || S.snap.cfg.topics[0];
  return topic.slots.filter((s) => s !== "laterality" || (f.site && f.site.lateralizable));
}

/** Body regions of a finding site, most specific first (asked of the server: the site's ancestors). */
async function ensureSiteRegions(site) {
  const bm = S.snap.bodymap;
  if (bm.siteRegions[site] !== undefined) return;
  const anc = await TX.ancestors(site);
  const regions = S.snap.cfg.bodymap.regions;
  bm.siteRegions[site] = (S.snap.cfg.bodymap.specificity || []).filter((rid) => regions.find((r) => r.id === rid)?.codes.some((c) => anc.has(c)));
}

async function selectFinding(code, fromText, fromMap) {
  const u = S.known.get(code);
  if (!u) return;
  let en = u[1], sv = u[2], site = null;
  if (S.source === "client") {
    try {
      const [lab, s2] = await Promise.all([TX.labelsFor([code]), TX.findingDetails(code, S.snap.cfg.meta.refsets.lateralizable)]);
      en = lab[code].en || en; sv = lab[code].sv; site = s2;
      if (site) { S.snap.details[code] = site; await ensureSiteRegions(site.code); }
      S.known.set(code, [code, en, sv, u[3]]);
    } catch (e) { $("#cands").append(h("p", { class: "warn" }, t("txError"))); return; }
  } else {
    site = S.snap.details[code] || null;
  }
  S.finding = { code, en: en || sv, sv, topic: u[3], site };
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
  focusMapOn(S.finding);
  S.confirmed = false;
  render();
  if (liveCheck()) validateAll();
}

async function validateAll() {
  for (const { code } of codesUsed(gstate(), ctx())) {
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
function render() {
  document.documentElement.lang = S.lang;
  renderHeader(); renderInput(); renderMap(); renderCandidates(); renderForm(); renderConfirm(); renderOutputs(); renderFoot();
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
      h("div", { class: "row" }, h("button", { id: "go", type: "button", class: "primary" }, ""), h("button", { id: "rs", type: "button", class: "ghost" }, "")),
      h("p", { id: "notes", class: "hint" }), h("div", { id: "samples", class: "chips" }));
    $("#text").addEventListener("input", (e) => { S.text = e.target.value; });
    $("#text").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); interpret(); } });
    $("#go").addEventListener("click", () => interpret());
    $("#rs").addEventListener("click", () => { S.text = ""; $("#text").value = ""; S.cand = null; S.finding = null; S.values = {}; S.duration = null; S.ex = null; S.map.sel = null; S.map.side = null; S.map.view = S.map.main; S.prefilledMap = new Set(); render(); });
  }
  $("#h-in").textContent = t("s1");
  $("#text").placeholder = t("ph");
  if ($("#text").value !== S.text) $("#text").value = S.text;
  $("#go").textContent = t("go"); $("#rs").textContent = t("reset");
  $("#notes").textContent = t(S.source === "client" ? "localNoteClient" : "localNote");
  $("#samples").replaceChildren(h("span", { class: "seglabel" }, t("tryThese")),
    ...examples().map((txt) => h("button", { type: "button", class: "chip", onclick: () => { S.text = txt; $("#text").value = txt; interpret(); } }, txt.length > 46 ? txt.slice(0, 44) + "…" : txt)));
}

// ------------------------------------------------------------------------------------------------ body map
const regionInfo = (r) => S.snap.bodymap.regions.find((x) => x.id === r);
const regionLabel = (r) => (regionInfo(r)?.label[S.lang]) || r;
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
  if ((M.view === "front" || M.view === "back") && ZOOMABLE.has(region)) {
    M.main = M.view; M.view = region; M.side = side; M.sel = { region, side }; M.more = false;
  } else if (sameSel) { M.sel = null; }
  else { M.sel = { region, side }; M.more = false; }
  renderMap();
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
        h("span", { class: "dim" }, regionLabel(M.view) + (M.side ? ", " + sideLabel(M.side) : "")))
    : seg("", [["front", t("front")], ["back", t("back")]], M.view, (v) => { M.view = v; M.main = v; renderMap(); }));
  const host = h("div", { class: "bmhost", id: "bmhost" });
  box.append(host);
  drawBodyMap(host, { view: M.view, side: M.side, sel: M.sel, hl: currentHl(), regionLabel, sideLabel }, { region: onRegion });
  box.append(h("div", { class: "legend" }, h("span", { class: "sw sel" }), t("legendSel"), h("span", { class: "sw hl" }), t("legendHl")));
  if (!M.sel) { box.append(h("p", { class: "hint" }, t("mapHint"))); return; }
  box.append(h("div", { class: "loc" }, h("strong", {}, t("location") + ": "), regionLabel(M.sel.region) + (M.sel.side ? " (" + sideLabel(M.sel.side) + ")" : ""),
    h("button", { type: "button", class: "ghost small", onclick: () => { M.sel = null; renderMap(); } }, "×")));
  const info = regionInfo(M.sel.region);
  const subs = S.snap.cfg.bodymap.subregions[M.sel.region] || [];
  if (info?.parent || subs.length) {
    const go = (r) => () => { M.sel = { region: r, side: M.sel.side }; M.more = false; renderMap(); };
    box.append(h("div", { class: "subs" }, h("span", { class: "seglabel" }, t("subs")),
      info?.parent ? h("button", { type: "button", class: "chip", "data-sub": info.parent, onclick: go(info.parent) }, "↑ " + regionLabel(info.parent)) : null,
      subs.map((r) => h("button", { type: "button", class: "chip", "data-sub": r, onclick: go(r) }, regionLabel(r)))));
  }
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
  if (!S.cand) { box.append(h("p", { class: "hint" }, t("nothing"))); return; }
  const both = S.live || (S.sampleHit && S.sampleHit.candidates.rerank);
  if (both) {
    box.append(seg("", [["text", t("baseline")], ["rerank", t("rerank")]], S.candMode, async (m) => { S.candMode = m; S.cand = await candidatesFor(S.ex.rest, S.text); render(); }));
  }
  const shownItems = S.cand.items.filter(inLang);
  if (S.cand.error) box.append(h("p", { class: "warn", id: "cand-error" }, t(S.cand.error === "personal" ? "personal" : "txError")));
  else if (!shownItems.length) box.append(h("p", { class: "warn" }, t("noMatch")));
  else if (S.cand.low_confidence) box.append(h("p", { class: "warn" }, "⚠ " + t("lowConf")));
  const list = h("ul", { class: "cands" });
  for (const it of shownItems.slice(0, 5)) {
    const sel = S.finding && S.finding.code === it.code;
    const det = S.snap.details[it.code];
    list.append(h("li", { class: "cand" + (sel ? " sel" : "") },
      h("div", { class: "cmain" },
        h("div", { class: "cname" }, h("strong", {}, nmI(it)), S.lang === "sv" && it.sv && it.en ? h("span", { class: "alt" }, it.en) : null),
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
    h("button", { type: "button", class: "ghost", onclick: () => $("#form").scrollIntoView({ behavior: "smooth" }) }, t("edit"))));
  if (S.confirmed) box.append(h("p", { class: "ok", id: "okmsg" }, "✓ " + t("confirmed")));
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
  box.replaceChildren(h("h2", {}, t("s5")));
  if (!S.finding) { box.append(h("p", { class: "hint" }, t("pickFinding"))); return; }
  const tabs = h("div", { class: "tabs", role: "tablist" }, Object.entries(t("tabs")).map(([k, v]) => h("button", { type: "button", role: "tab", class: "tab" + (S.tab === k ? " on" : ""), "aria-selected": S.tab === k ? "true" : "false", onclick: () => { S.tab = k; renderOutputs(); } }, v)));
  box.append(tabs);
  const c = ctx();
  const time = "2026-11-18T12:00:00Z";
  if (S.tab === "expr") box.append(pre(expression(gstate(), c), t("exprNote")));
  else if (S.tab === "oe") {
    const r = openEhr(gstate(), c, { time });
    box.append(pre(JSON.stringify(r.composition, null, 2)));
    if (r.unmapped.length) box.append(h("div", { class: "callout" }, h("strong", {}, t("unmapped")), h("ul", {}, r.unmapped.map((u) => h("li", {}, `${u.key}: ${u.reason}`)))));
  } else if (S.tab === "fhir") box.append(pre(JSON.stringify(fhirCondition(gstate(), c, { time }), null, 2)));
  else {
    const rows = codesUsed(gstate(), c);
    box.append(h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, [t("role"), t("code"), t("term"), t("status")].map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, (I[S.lang].role_ || {})[r.role] || S.snap.cfg.slots[r.role]?.label[S.lang] || r.role), h("td", {}, h("a", { href: browserLink(r.code), target: "_blank", rel: "noopener", class: "mono" }, r.code)),
        h("td", {}, r.role === "finding site" ? (S.lang === "sv" ? S.finding.site.sv || S.finding.site.en : S.finding.site.en) : r.role === "finding" ? (S.lang === "sv" ? S.finding.sv || S.finding.en : S.finding.en) : lab(r.code)), h("td", {}, statusCell(r.code))))))));
  }
}

function renderFoot() {
  $("#foot").replaceChildren(t("foot") + " ", h("a", { href: "THIRD_PARTY_NOTICES.md", target: "_blank", rel: "noopener" }, t("notices")));
}

init();
