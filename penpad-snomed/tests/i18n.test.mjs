import test from "node:test";
import assert from "node:assert/strict";
import { I } from "../web/i18n.js";
import { cfg } from "./helpers.mjs";

const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, p + k + ".") : [[p + k, v]]));

test("Swedish and English have exactly the same text keys", () => {
  const sv = flat(I.sv).map(([k]) => k).sort();
  const en = flat(I.en).map(([k]) => k).sort();
  assert.deepEqual(sv, en);
});

test("English texts contain no Swedish letters and are not copies of the Swedish ones", () => {
  const sv = new Map(flat(I.sv));
  for (const [k, v] of flat(I.en)) {
    assert.doesNotMatch(String(v), /[åäöÅÄÖ]/, `en.${k}`);
    if (String(v).length > 12) assert.notEqual(v, sv.get(k), `en.${k} is the Swedish text`);
  }
});

test("every label in the configuration has an English text without Swedish letters", () => {
  const bad = [];
  const walk = (o, path) => {
    if (!o || typeof o !== "object") return;
    if (typeof o.en === "string" && typeof o.sv === "string" && /[åäöÅÄÖ]/.test(o.en)) bad.push(path);
    for (const [k, v] of Object.entries(o)) walk(v, path + "." + k);
  };
  walk(cfg, "cfg");
  assert.deepEqual(bad, []);
  for (const r of cfg.bodymap.regions) assert.ok(r.label.en && r.label.sv, r.id);
  for (const [slot, sl] of Object.entries(cfg.slots)) assert.ok(sl.label.en, slot);
  for (const ex of cfg.examples) assert.ok(["sv", "en"].includes(ex.lang));
  assert.ok(cfg.examples.filter((e) => e.lang === "en").length >= 5);
});
