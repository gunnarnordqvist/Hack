// Browser client for a FHIR R4 terminology server (default: HL7 Nordics). Used by the public site so that no SNOMED CT
// content has to be stored in this repository: the visitor's browser asks the server directly (the server allows
// cross-origin requests). Only standard operations: ValueSet/$expand, ValueSet/$validate-code, CodeSystem/$lookup.

import { personalDataReason, PERSONAL_DATA_ERROR } from "./guard.js";

export const TX_BASE = "https://tx-nordics.fhir.org/fhir/r4";
const SCT = "http://snomed.info/sct";
const SWEDEN = "http://snomed.info/sct/45991000052106"; // Swedish module; no version = the server's latest

export class TxError extends Error {}

const cache = new Map();

async function get(path, params) {
  const url = `${TX_BASE}/${path}?${new URLSearchParams(params)}`;
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    let last;
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(url, { headers: { Accept: "application/fhir+json" } });
        const j = await r.json();
        if (r.ok || (j && j.resourceType === "OperationOutcome")) return j;
        last = new TxError(`HTTP ${r.status}`);
      } catch (e) { last = new TxError(String(e && e.message || e)); }
      await new Promise((res) => setTimeout(res, 400));
    }
    throw last;
  })();
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

const langParams = (lang) => (lang === "sv" ? { "system-version": `${SCT}|${SWEDEN}`, displayLanguage: "sv" } : {});

/** All names of a concept in an expansion entry, without the semantic tag ("(finding)"). */
function synonyms(c) {
  const out = new Set([c.display]);
  for (const d of c.designation || []) if (d.value) out.add(d.value.replace(/\s*\((finding|disorder|symptom)\)$/i, ""));
  return [...out];
}

/** ValueSet/$expand on an implicit SNOMED CT ECL value set -> {total, items:[{code,display}]} */
export async function expand(ecl, { filter, lang = "en", count = 200, offset = 0, designations = false } = {}) {
  // the network boundary: text that looks like a personal identifier is never sent
  if (filter && personalDataReason(filter)) throw new TxError(PERSONAL_DATA_ERROR);
  const p = { url: `${SCT}?fhir_vs=ecl/${ecl}`, count: String(count), offset: String(offset), ...langParams(lang) };
  if (filter) p.filter = filter;
  if (designations) p.includeDesignations = "true"; // synonyms too: the server's text filter matches them, so the ranking should see them
  const j = await get("ValueSet/$expand", p);
  if (j.resourceType !== "Parameters" && j.resourceType !== "ValueSet") throw new TxError(j.issue?.[0]?.diagnostics || "expand failed");
  const e = j.expansion || {};
  return { total: e.total ?? (e.contains || []).length, items: (e.contains || []).map((c) => ({ code: c.code, display: c.display, ...(designations ? { names: synonyms(c) } : {}) })) };
}

/** Labels (English and Swedish) for a list of codes in two requests. */
export async function labelsFor(codes) {
  const ecl = codes.join(" OR ");
  const [en, sv] = await Promise.all([expand(ecl, { lang: "en", count: codes.length }), expand(ecl, { lang: "sv", count: codes.length })]);
  const out = {};
  for (const c of codes) out[c] = { en: null, sv: null };
  for (const i of en.items) out[i.code].en = i.display;
  for (const i of sv.items) out[i.code].sv = i.display;
  for (const c of codes) if (out[c].sv === out[c].en) out[c].sv = null; // no Swedish term: the server repeats the English one
  return out;
}

export async function lookup(code) {
  const j = await get("CodeSystem/$lookup", { system: SCT, code, property: "*" });
  if (j.resourceType !== "Parameters") throw new TxError(j.issue?.[0]?.diagnostics || "lookup failed");
  const out = { code, parents: [] };
  for (const part of j.parameter || []) {
    if (part.name === "display") out.display = part.valueString;
    if (part.name === "property") {
      const kv = Object.fromEntries((part.part || []).map((x) => [x.name, x]));
      const c = kv.code?.valueCode;
      const v = kv.value || {};
      if (c === "normalForm") out.normalForm = v.valueString;
      if (c === "parent") out.parents.push(v.valueCode);
    }
  }
  return out;
}

export async function validate(code, ecl) {
  const j = ecl
    ? await get("ValueSet/$validate-code", { url: `${SCT}?fhir_vs=ecl/${ecl}`, system: SCT, code })
    : await get("CodeSystem/$validate-code", { url: SCT, code });
  const r = (j.parameter || []).find((p) => p.name === "result");
  return { ok: !!(r && r.valueBoolean) };
}

const SITE_RE = /363698007\|[^|]*\|=\(?(\d+)\|([^|]*)\|/;
export function findingSite(normalForm) {
  const m = SITE_RE.exec(normalForm || "");
  return m ? { code: m[1], en: m[2] } : null;
}

/** Details of a finding: its finding site (English and Swedish name) and whether the site can have a side. */
export async function findingDetails(code, lateralizableRefset) {
  const l = await lookup(code);
  const fs = findingSite(l.normalForm);
  let site = null;
  if (fs) {
    const [lab, lat] = await Promise.all([labelsFor([fs.code]), validate(fs.code, `^ ${lateralizableRefset}`)]);
    site = { code: fs.code, en: lab[fs.code].en || fs.en, sv: lab[fs.code].sv, lateralizable: lat.ok };
  }
  return site;
}

/** Ancestors (and self) of a body structure, as a set of codes. */
export async function ancestors(code) {
  const r = await expand(`>> ${code}`, { count: 300 });
  return new Set(r.items.map((i) => i.code));
}
