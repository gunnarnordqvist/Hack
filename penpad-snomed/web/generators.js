// Output generators: confirmation sentence (sv/en, clinician/patient), SNOMED CT expression,
// openEHR COMPOSITION (canonical JSON) and FHIR Condition. Pure functions for browser and node.
//
// The openEHR structure (archetypes, at-codes, composition shape) follows Erik Sundvall's
// clinergy-extractor (Apache-2.0), whose mappings cite the published CKM archetypes:
//   COMPOSITION.encounter.v1, OBSERVATION.story.v1, CLUSTER.symptom_sign.v2, CLUSTER.anatomical_location.v1.
// Here the coded values are SNOMED CT concepts. Elements the template does not carry are listed in `unmapped`.
//
// state = {
//   lang: 'sv'|'en', mode: 'clinician'|'patient',
//   finding: { code, en, sv, topic, site: {code,en,sv,lateralizable} | null },
//   values: { laterality?, character?, consistency?, severity?, onset?, pattern?, progress? }   // SNOMED codes
//   duration: { n, unit } | null
// }

const SCT = "http://snomed.info/sct";
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function term(code, lang, labels, fallbacks) {
  const l = labels[code] || {};
  if (lang === "sv" && l.sv) return l.sv;
  if (lang === "sv" && fallbacks) fallbacks.add(code);
  return l.en || code;
}

function findingTerm(f, lang, fallbacks) {
  if (lang === "sv" && f.sv) return f.sv;
  if (lang === "sv" && fallbacks) fallbacks.add(f.code);
  return f.en;
}

function sitePlain(site, lang) {
  const t = lang === "sv" ? site.sv || site.en : site.en;
  return t.replace(/,\s*struktur$/i, "").replace(/\s+structure$/i, "").replace(/\s+region$/i, "").toLowerCase();
}

function unitWord(cfg, unit, n, lang) {
  const u = cfg.units.find((x) => x.key === unit);
  if (!u) return unit;
  if (lang === "sv") return n === 1 ? u.svLabel[0] : u.svLabel[1];
  return n === 1 ? u.en[0] : u.en[1] || u.en[0];
}

function strip(s, lang) {
  // "Throbbing pain" -> "throbbing", "plötslig debut" -> "plötslig": the slot name already says what it is
  return s.replace(/\s+(pain|smärta|onset|debut)$/i, "");
}

/** Confirmation sentence. Returns {text, fallbacks:[codes shown in English because the Swedish module has no term]}. */
export function sentence(state, ctx) {
  const { cfg, labels } = ctx;
  const { lang, mode, finding: f, values: v, duration } = state;
  const fb = new Set();
  const T = (c) => term(c, lang, labels, fb);
  const out = [];
  const sv = lang === "sv";

  if (mode === "patient") {
    const topic = cfg.topics.find((t) => t.id === f.topic) || cfg.topics[0];
    const P = cfg.patientPhrases[lang];
    const side = v.laterality ? T(v.laterality).toLowerCase() : null;
    let head;
    if (f.site) {
      const site = (side && !/^(båda|both)/i.test(side) && f.site.lateralizable !== false ? side + " " : "") + sitePlain(f.site, lang);
      head = topic.patient[lang].have.replace("{site}", site + (v.aspect ? " (" + lower(strip(T(v.aspect), lang)) + ")" : ""));
    } else {
      head = (sv ? "Du har " : "You have ") + lower(findingTerm(f, lang, fb));
    }
    if (duration) head += (sv ? " sedan " : " for ") + duration.n + " " + unitWord(cfg, duration.unit, duration.n, lang);
    out.push(head + ".");
    const qual = [v.character, v.consistency].filter(Boolean).map((c) => P.character?.[c] || P.consistency?.[c] || lower(strip(T(c), lang)));
    const sev = v.severity ? P.severity?.[v.severity] || lower(T(v.severity)) : null;
    const words = [...qual, ...(sev ? [sev] : [])];
    if (words.length) out.push(P.lead[f.topic].replace("{x}", words.join(sv ? " och " : " and ")));
    for (const slot of ["onset", "pattern", "progress"]) {
      const c = v[slot];
      if (c) out.push(P[slot]?.[c] || `${cap(cfg.slots[slot].label[lang])}: ${lower(strip(T(c), lang))}.`);
    }
    out.push(topic.patient[lang].explain);
    return { text: out.join(" "), fallbacks: [...fb] };
  }

  // clinician
  const ft = findingTerm(f, lang, fb);
  const head = [cap(ft)];
  if (v.laterality) {
    const s = T(v.laterality);
    if (!ft.toLowerCase().includes(s.toLowerCase())) head.push(lower(s));
  }
  if (v.aspect && f.site) head.push(lower(strip(T(v.aspect), lang)));
  let first = head.join(", ");
  if (duration) first += (sv ? ", sedan " : ", for ") + duration.n + " " + unitWord(cfg, duration.unit, duration.n, lang);
  out.push(first + ".");
  const quality = [v.character, v.consistency, v.severity].filter(Boolean).map((c) => lower(strip(T(c), lang)));
  if (quality.length) out.push(cap(quality.join(", ")) + ".");
  for (const slot of ["onset", "pattern", "progress"]) {
    if (v[slot]) out.push(`${cfg.slots[slot].label[lang]}: ${lower(strip(T(v[slot]), lang))}.`);
  }
  return { text: out.join(" "), fallbacks: [...fb] };
}

/** Every SNOMED CT code the output relies on, with its role. */
export function codesUsed(state, ctx) {
  const rows = [{ code: state.finding.code, role: "finding" }];
  if (state.finding.site) rows.push({ code: state.finding.site.code, role: "finding site" });
  for (const [slot, c] of Object.entries(state.values)) if (c) rows.push({ code: c, role: slot });
  return rows;
}

const ex = (code, labels) => `${code} |${(labels[code] || {}).en || ""}|`;

/** Post-coordinated SNOMED CT expression (compositional grammar). The expression itself is NOT validated by a server. */
export function expression(state, ctx) {
  const { cfg, labels } = ctx;
  const a = cfg.meta.attributes;
  const f = state.finding;
  const v = state.values;
  const refinements = [];
  if (f.site) {
    let site = ex(f.site.code, { [f.site.code]: { en: f.site.en } });
    if (v.laterality && f.site.lateralizable) site = `(${site} : ${a.laterality} |Laterality| = ${ex(v.laterality, labels)})`;
    else site = `${site}`;
    refinements.push(`{ ${a.findingSite} |Finding site| = ${site} }`);
  }
  if (v.severity) refinements.push(`${a.severity} |Severity| = ${ex(v.severity, labels)}`);
  if (v.onset) refinements.push(`${a.clinicalCourse} |Clinical course| = ${ex(v.onset, labels)}`);
  const focus = `${f.code} |${f.en}|`;
  const body = refinements.length ? `${focus} :\n  ${refinements.join(",\n  ")}` : focus;
  // the SNOMED CT model has no attribute for an aspect of a body structure, so it is kept as a comment and not claimed as part of the meaning
  return v.aspect && f.site ? `${body}\n/* aspect of the site: ${ex(v.aspect, labels)} (no attribute for it in the SNOMED CT model; not part of the expression) */` : body;
}

// ---------------------------------------------------------------------------------------------------
// openEHR
// ---------------------------------------------------------------------------------------------------
const OE = {
  composition: { archetype: "openEHR-EHR-COMPOSITION.encounter.v1", category: { code: "433", text: "event" }, setting: { code: "228", text: "primary medical care" } },
  story: { archetype: "openEHR-EHR-OBSERVATION.story.v1", node: "at0004" },
  symptom: { archetype: "openEHR-EHR-CLUSTER.symptom_sign.v2", name: "at0001", severity: "at0021", duration: "at0028", onset: "at0164", character: "at0189" },
  location: { archetype: "openEHR-EHR-CLUSTER.anatomical_location.v1", name: "at0001", laterality: "at0002", left: "at0003", right: "at0004" },
  severity: { "255604002": "at0023", "6736007": "at0024", "24484000": "at0025" },
  templateId: "penpad-snomed-symptom.v0",
};

const dvText = (value) => ({ _type: "DV_TEXT", value });
const phrase = (terminology, code) => ({ _type: "CODE_PHRASE", terminology_id: { _type: "TERMINOLOGY_ID", value: terminology }, code_string: code });
const coded = (value, terminology, code, snomedMap) => {
  const out = { _type: "DV_CODED_TEXT", value, defining_code: phrase(terminology, code) };
  if (snomedMap) {
    out.mappings = [{ _type: "TERM_MAPPING", match: "=", target: phrase("SNOMED-CT", snomedMap) }];
  }
  return out;
};
const element = (node, name, value) => ({ _type: "ELEMENT", name: dvText(name), archetype_node_id: node, value });
const cluster = (arch, name, items) => ({
  _type: "CLUSTER", name: dvText(name), archetype_node_id: arch,
  archetype_details: { _type: "ARCHETYPED", archetype_id: { _type: "ARCHETYPE_ID", value: arch }, rm_version: "1.1.0" }, items,
});

export function isoDuration(n, unit) {
  const d = { minute: `PT${n}M`, hour: `PT${n}H`, day: `P${n}D`, week: `P${n}W`, month: `P${n}M`, year: `P${n}Y` };
  return d[unit] || null;
}

/** openEHR canonical COMPOSITION. Returns {composition, unmapped:[{key, reason}]}. */
export function openEhr(state, ctx, opts = {}) {
  const { cfg, labels } = ctx;
  const lang = state.lang;
  const time = opts.time || new Date().toISOString();
  const f = state.finding;
  const v = state.values;
  const unmapped = [];
  const fb = new Set();
  const T = (c) => term(c, lang, labels, fb);
  const items = [];

  items.push(element(OE.symptom.name, "Symptom/Sign name", coded(findingTerm(f, lang, fb), "SNOMED-CT", f.code)));

  if (f.site) {
    const loc = [element(OE.location.name, "Body site name", coded(sitePlain(f.site, lang), "SNOMED-CT", f.site.code))];
    if (v.laterality) {
      const local = v.laterality === "7771000" ? OE.location.left : v.laterality === "24028007" ? OE.location.right : null;
      if (local && f.site.lateralizable) loc.push(element(OE.location.laterality, "Laterality", coded(T(v.laterality), "local", local, v.laterality)));
      else unmapped.push({ key: "laterality", reason: local ? "body site is not lateralizable" : "the archetype has local codes for left and right only" });
    }
    if (v.aspect) unmapped.push({ key: "aspect", reason: "the anatomical location mapping we follow has no node for an aspect (anterior, medial ...)" });
    items.push(cluster(OE.location.archetype, "Anatomical location", loc));
  } else if (v.aspect) {
    unmapped.push({ key: "aspect", reason: "no body site on this finding, so no anatomical location cluster" });
  } else if (v.laterality) {
    unmapped.push({ key: "laterality", reason: "no body site on this finding, so no anatomical location cluster" });
  }

  if (v.severity) {
    const local = OE.severity[v.severity];
    if (local) items.push(element(OE.symptom.severity, "Severity category", coded(T(v.severity), "local", local, v.severity)));
    else unmapped.push({ key: "severity", reason: "the archetype has local codes for mild, moderate and severe only" });
  }
  if (state.duration) {
    const iso = isoDuration(state.duration.n, state.duration.unit);
    if (iso) items.push(element(OE.symptom.duration, "Episode duration", { _type: "DV_DURATION", value: iso }));
  }
  if (v.onset) items.push(element(OE.symptom.onset, "Onset timing", coded(T(v.onset), "SNOMED-CT", v.onset)));
  if (v.character) items.push(element(OE.symptom.character, "Character", coded(T(v.character), "SNOMED-CT", v.character)));
  for (const slot of ["pattern", "progress", "consistency"]) {
    if (v[slot]) unmapped.push({ key: slot, reason: "not in the verified template (CLUSTER.symptom_sign.v2 elements for this are not mapped yet)" });
  }

  const s = sentence({ ...state, mode: "clinician" }, ctx).text;
  const dt = (value) => ({ _type: "DV_DATE_TIME", value });
  const archetyped = (a, tpl) => ({ _type: "ARCHETYPED", archetype_id: { _type: "ARCHETYPE_ID", value: a }, ...(tpl ? { template_id: { _type: "TEMPLATE_ID", value: tpl } } : {}), rm_version: "1.1.0" });
  const observation = {
    _type: "OBSERVATION", name: dvText("Story/History"), archetype_node_id: OE.story.archetype,
    archetype_details: archetyped(OE.story.archetype, OE.templateId),
    language: phrase("ISO_639-1", lang), encoding: phrase("IANA_character-sets", "UTF-8"), subject: { _type: "PARTY_SELF" },
    data: {
      _type: "HISTORY", name: dvText("Event Series"), archetype_node_id: "at0001", origin: dt(time),
      events: [{
        _type: "POINT_EVENT", name: dvText("Any event"), archetype_node_id: "at0002", time: dt(time),
        data: { _type: "ITEM_TREE", name: dvText("Tree"), archetype_node_id: "at0003", items: [element(OE.story.node, "Story", dvText(s)), cluster(OE.symptom.archetype, "Symptom/Sign", items)] },
      }],
    },
  };
  const composition = {
    _type: "COMPOSITION", name: dvText("Encounter"), archetype_node_id: OE.composition.archetype,
    archetype_details: archetyped(OE.composition.archetype, OE.templateId),
    language: phrase("ISO_639-1", lang), territory: phrase("ISO_3166-1", "SE"),
    category: coded(OE.composition.category.text, "openehr", OE.composition.category.code),
    composer: { _type: "PARTY_IDENTIFIED", name: "Demo user" },
    context: { _type: "EVENT_CONTEXT", start_time: dt(time), setting: coded(OE.composition.setting.text, "openehr", OE.composition.setting.code) },
    content: [observation],
  };
  return { composition, unmapped };
}

// ---------------------------------------------------------------------------------------------------
// FHIR R4 Condition
// ---------------------------------------------------------------------------------------------------
const sctCoding = (code, labels) => ({ system: SCT, code, display: (labels[code] || {}).en });
const cc = (code, labels, lang) => ({ coding: [sctCoding(code, labels)], text: term(code, lang, labels) });

const EXT = "https://penpad-snomed.example/StructureDefinition/";

/** FHIR Condition. Course, pattern, progress, character and consistency go in extensions (no published profile yet). */
export function fhirCondition(state, ctx, opts = {}) {
  const id = opts.id || "demo-condition";
  const { labels } = ctx;
  const f = state.finding;
  const v = state.values;
  const lang = state.lang;
  const r = {
    resourceType: "Condition",
    id,
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
    verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "unconfirmed" }] },
    code: { coding: [{ system: SCT, code: f.code, display: f.en }], text: findingTerm(f, lang) },
    subject: { display: "Demo patient (no real data)" },
    recordedDate: (opts.time || new Date().toISOString()).slice(0, 10),
  };
  if (v.severity) r.severity = cc(v.severity, labels, lang);
  const bodySite = [];
  if (f.site) bodySite.push({ coding: [{ system: SCT, code: f.site.code, display: f.site.en }], text: sitePlain(f.site, lang) });
  if (v.laterality && f.site && f.site.lateralizable) bodySite.push(cc(v.laterality, labels, lang));
  if (bodySite.length) r.bodySite = bodySite;
  if (state.duration) r.onsetString = `${state.duration.n} ${unitWord(ctx.cfg, state.duration.unit, state.duration.n, "en")} ago (duration entered, no date)`;
  const ext = [];
  for (const slot of ["onset", "pattern", "progress", "character", "consistency", "aspect"]) {
    if (v[slot]) ext.push({ url: EXT + slot, valueCodeableConcept: cc(v[slot], labels, lang) });
  }
  if (ext.length) r.extension = ext;
  r.note = [{ text: sentence({ ...state, mode: "clinician" }, ctx).text }];
  return r;
}

// ---------------------------------------------------------------------------------------------------
// Several findings at once (a list, e.g. after a fall: arm, hand and head)
// ---------------------------------------------------------------------------------------------------

/** One SNOMED expression per finding, separated by a blank line. */
export function expressionMany(states, ctx) {
  return states.map((s) => expression(s, ctx)).join("\n\n");
}

/** One COMPOSITION with one OBSERVATION per finding. unmapped entries say which finding they belong to. */
export function openEhrMany(states, ctx, opts = {}) {
  const rs = states.map((s) => openEhr(s, ctx, opts));
  if (!rs.length) return { composition: null, unmapped: [] };
  const composition = { ...rs[0].composition, content: rs.flatMap((r) => r.composition.content) };
  const unmapped = rs.flatMap((r, i) => r.unmapped.map((u) => ({ ...u, key: `${states[i].finding.code} ${u.key}` })));
  return { composition, unmapped };
}

/** FHIR Bundle (collection) of Conditions, ids demo-condition-1 ... */
export function fhirBundle(states, ctx, opts = {}) {
  return {
    resourceType: "Bundle", type: "collection",
    entry: states.map((s, i) => { const id = `demo-condition-${i + 1}`; return { fullUrl: `urn:demo:${id}`, resource: fhirCondition(s, ctx, { ...opts, id }) }; }),
  };
}

/** Every code the list relies on, once per role and code. */
export function codesUsedMany(states, ctx) {
  const seen = new Set();
  const rows = [];
  for (const s of states) for (const r of codesUsed(s, ctx)) {
    const k = r.role + ":" + r.code;
    if (!seen.has(k)) { seen.add(k); rows.push({ ...r, finding: s.finding }); }
  }
  return rows;
}
