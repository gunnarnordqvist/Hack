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
