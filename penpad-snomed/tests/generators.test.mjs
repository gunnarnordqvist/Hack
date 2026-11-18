import test from "node:test";
import assert from "node:assert/strict";
import { sentence, expression, openEhr, fhirCondition, codesUsed, isoDuration } from "../web/generators.js";
import { ctx, thumbState } from "./helpers.mjs";

const T = "2026-11-18T12:00:00Z";

test("clinician sentence, Swedish", () => {
  assert.equal(sentence(thumbState(), ctx).text, "Tumvärk, vänster, sedan 2 dagar. Bultande, måttlig. Debut: abrupt start. Förlopp: förvärras.");
});

test("clinician sentence, English", () => {
  assert.equal(sentence(thumbState({ lang: "en" }), ctx).text, "Thumb ache, left, for 2 days. Pounding, moderate. Onset: abrupt start. Progress: worsening.");
});

test("patient sentence, Swedish and English", () => {
  const sv = sentence(thumbState({ mode: "patient" }), ctx).text;
  assert.match(sv, /^Du har ont i vänster tumme sedan 2 dagar\. Smärtan är bultande och måttlig\. Det började plötsligt\. Det har blivit värre\./);
  const en = sentence(thumbState({ mode: "patient", lang: "en" }), ctx).text;
  assert.match(en, /^You have pain in your left thumb for 2 days\. The pain is throbbing and moderate\. It started suddenly\. It has got worse\./);
});

test("a term missing in the Swedish module is shown in English and reported", () => {
  const s = thumbState({ values: { onset: "1384228004" }, duration: null });
  const r = sentence(s, ctx);
  assert.match(r.text, /Debut: fast start\./);
  assert.deepEqual(r.fallbacks, ["1384228004"]);
});

test("laterality is ignored when the body site is not lateralizable", () => {
  const s = thumbState();
  s.finding.site.lateralizable = false;
  const out = fhirCondition(s, ctx, { time: T });
  assert.equal(out.bodySite.length, 1);
  assert.doesNotMatch(expression(s, ctx), /Laterality/);
  const oe = openEhr(s, ctx, { time: T });
  assert.ok(oe.unmapped.some((u) => u.key === "laterality"));
});

test("SNOMED expression", () => {
  const e = expression(thumbState(), ctx);
  assert.match(e, /^300955002 \|thumb ache\| :/);
  assert.match(e, /\{ 363698007 \|Finding site\| = \(76505004 \|thumb\| : 272741003 \|Laterality\| = 7771000 \|left\|\) \}/);
  assert.match(e, /246112005 \|Severity\| = 6736007 \|moderate\|/);
  assert.match(e, /263502005 \|Clinical course\| = 385315009 \|abrupt start\|/);
});

test("openEHR composition carries SNOMED codes and the archetype nodes", () => {
  const { composition, unmapped } = openEhr(thumbState(), ctx, { time: T });
  assert.equal(composition._type, "COMPOSITION");
  assert.equal(composition.category.defining_code.code_string, "433");
  const tree = composition.content[0].data.events[0].data.items;
  const sym = tree.find((i) => i.archetype_node_id === "openEHR-EHR-CLUSTER.symptom_sign.v2");
  const byNode = Object.fromEntries(sym.items.filter((i) => i._type === "ELEMENT").map((i) => [i.archetype_node_id, i.value]));
  assert.equal(byNode.at0001.defining_code.code_string, "300955002");
  assert.equal(byNode.at0001.defining_code.terminology_id.value, "SNOMED-CT");
  assert.equal(byNode.at0021.defining_code.code_string, "at0024");
  assert.equal(byNode.at0021.mappings[0].target.code_string, "6736007");
  assert.equal(byNode.at0028.value, "P2D");
  assert.equal(byNode.at0164.defining_code.code_string, "385315009");
  assert.equal(byNode.at0189.defining_code.code_string, "29695002");
  const loc = sym.items.find((i) => i.archetype_node_id === "openEHR-EHR-CLUSTER.anatomical_location.v1");
  const side = loc.items.find((i) => i.archetype_node_id === "at0002");
  assert.equal(side.value.defining_code.code_string, "at0003");
  assert.equal(side.value.mappings[0].target.code_string, "7771000");
  assert.deepEqual(unmapped.map((u) => u.key), ["progress"]);
});

test("FHIR Condition", () => {
  const c = fhirCondition(thumbState(), ctx, { time: T });
  assert.equal(c.resourceType, "Condition");
  assert.equal(c.code.coding[0].system, "http://snomed.info/sct");
  assert.equal(c.code.coding[0].code, "300955002");
  assert.equal(c.severity.coding[0].code, "6736007");
  assert.equal(c.bodySite.length, 2);
  assert.equal(c.bodySite[1].coding[0].code, "7771000");
  assert.deepEqual(c.extension.map((e) => e.url.split("/").pop()), ["onset", "progress", "character"]);
  assert.match(c.onsetString, /^2 days ago/);
  assert.equal(c.recordedDate, "2026-11-18");
});

test("codesUsed lists finding, site and every chosen value", () => {
  const codes = codesUsed(thumbState(), ctx).map((r) => r.code);
  assert.deepEqual(codes, ["300955002", "76505004", "7771000", "29695002", "6736007", "385315009", "231877006"]);
});

test("ISO 8601 durations", () => {
  assert.equal(isoDuration(3, "week"), "P3W");
  assert.equal(isoDuration(30, "minute"), "PT30M");
  assert.equal(isoDuration(1, "year"), "P1Y");
});

test("an aspect of the site (front side, toward the middle ...) is in the sentence, kept as a comment in the expression, listed as unmapped in openEHR and an extension in FHIR", () => {
  const s = thumbState({ values: { laterality: "7771000", aspect: "255561001" } });
  assert.match(sentence(s, ctx).text, /^Tumvärk, vänster, mot mitten, sedan 2 dagar\./);
  assert.match(sentence({ ...s, lang: "en", mode: "patient" }, ctx).text, /^You have pain in your left thumb \(toward the middle\) for 2 days\./);
  const e = expression(s, ctx);
  assert.match(e, /\/\* aspect of the site: 255561001 \|toward the middle\| .*not part of the expression\) \*\//);
  assert.doesNotMatch(e.split("/*")[0], /255561001/);
  assert.ok(openEhr(s, ctx, { time: T }).unmapped.some((u) => u.key === "aspect"));
  const f = fhirCondition(s, ctx, { time: T });
  assert.ok(f.extension.some((x) => x.url.endsWith("/aspect") && x.valueCodeableConcept.coding[0].code === "255561001"));
  assert.ok(codesUsed(s, ctx).some((r) => r.code === "255561001" && r.role === "aspect"));
});

test("an aspect without a body site is ignored", () => {
  const s = thumbState({ values: { aspect: "255549009" } });
  s.finding.site = null;
  assert.doesNotMatch(sentence(s, ctx).text, /framsidan/);
  assert.doesNotMatch(expression(s, ctx), /aspect/);
});

test("a list of findings: one expression each, one composition with an observation each, a FHIR Bundle, codes once", async () => {
  const { expressionMany, openEhrMany, fhirBundle, codesUsedMany } = await import("../web/generators.js");
  const a = thumbState();
  const b = thumbState({ values: { laterality: "24028007", aspect: "255549009" }, duration: null });
  b.finding = { code: "25064002", en: "headache", sv: "huvudvärk", topic: "pain", site: null };
  const states = [a, b];
  assert.equal(expressionMany(states, ctx).split("\n\n").length, 2);
  assert.match(expressionMany(states, ctx), /300955002 \|thumb ache\|[\s\S]*25064002 \|headache\|/);
  const oe = openEhrMany(states, ctx, { time: T });
  assert.equal(oe.composition.content.length, 2);
  assert.equal(oe.composition.content.every((c) => c._type === "OBSERVATION"), true);
  assert.ok(oe.unmapped.every((u) => /^\d+ /.test(u.key)));
  const fb = fhirBundle(states, ctx, { time: T });
  assert.equal(fb.type, "collection");
  const conds = fb.entry.filter((e) => e.resource.resourceType === "Condition").map((e) => e.resource);
  assert.deepEqual(fb.entry.map((e) => e.resource.resourceType), ["Patient", "Encounter", "Condition", "Condition"]);
  assert.deepEqual(conds.map((c) => c.id), ["demo-condition-1", "demo-condition-2"]);
  assert.deepEqual(conds.map((c) => c.code.coding[0].code), ["300955002", "25064002"]);
  // every reference resolves to an entry of the bundle (by fullUrl)
  const urls = new Set(fb.entry.map((e) => e.fullUrl));
  for (const c of conds) for (const ref of [c.subject.reference, c.encounter.reference]) assert.ok(urls.has("https://penpad-snomed.example/fhir/" + ref), ref);
  assert.equal(fb.entry[1].resource.subject.reference, "Patient/demo-patient");
  assert.equal(fhirCondition(a, ctx, { time: T }).subject.reference, undefined); // a single Condition carries no reference
  const rows = codesUsedMany([a, a], ctx);
  assert.equal(rows.length, codesUsedMany([a], ctx).length);
  assert.equal(openEhrMany([], ctx).composition, null);
});

test("a single FHIR Condition keeps its usual id", () => {
  assert.equal(fhirCondition(thumbState(), ctx, { time: T }).id, "demo-condition");
});

test("a ready-made aspect structure is information only: comment, extra FHIR body site, extra code row; the site is not replaced", () => {
  const s = thumbState({ values: { laterality: "7771000", aspect: "255561001" } });
  s.aspectSite = { code: "182296000", en: "Medial aspect of knee" };
  const e = expression(s, ctx);
  assert.match(e, /ready-made structure: 182296000 \|Medial aspect of knee\|/);
  assert.match(e.split("/*")[0], /76505004/); // the finding site is still the finding's own
  assert.doesNotMatch(e.split("/*")[0], /182296000/);
  const f = fhirCondition(s, ctx, { time: T });
  assert.ok(f.bodySite.some((b) => b.coding[0].code === "182296000"));
  assert.ok(f.bodySite.some((b) => b.coding[0].code === "76505004"));
  assert.ok(codesUsed(s, ctx).some((r) => r.role === "aspect structure" && r.code === "182296000"));
  delete s.aspectSite;
  assert.doesNotMatch(expression(s, ctx), /ready-made/);
});
