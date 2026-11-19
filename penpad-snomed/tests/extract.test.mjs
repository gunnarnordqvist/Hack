import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../web/extract.js";
import { cfg, labels } from "./helpers.mjs";

const run = (t) => extract(t, cfg, labels);

test("Swedish dictation fills side, duration and character, leaves the finding", () => {
  const r = run("smärta i vänster tumme sedan två dagar, bultande");
  assert.equal(r.values.laterality, "7771000");
  assert.equal(r.values.character, "29695002");
  assert.deepEqual(r.duration, { n: 2, unit: "day" });
  assert.equal(r.rest, "smärta i tumme");
});

test("English dictation with severity and progress", () => {
  const r = run("pain in the right thumb for 3 weeks, severe, worse");
  assert.equal(r.values.laterality, "24028007");
  assert.equal(r.values.severity, "24484000");
  assert.equal(r.values.progress, "231877006");
  assert.deepEqual(r.duration, { n: 3, unit: "week" });
  assert.equal(r.rest, "pain in the thumb");
});

test("relative day words", () => {
  assert.deepEqual(run("svullen tumme sedan igår").duration, { n: 1, unit: "day" });
  assert.deepEqual(run("headache since yesterday").duration, { n: 1, unit: "day" });
});

test("text without slot words is left alone", () => {
  const r = run("ont i magen");
  assert.deepEqual(r.values, {});
  assert.equal(r.duration, null);
  assert.equal(r.rest, "ont i magen");
});

test("hard swelling in the right foot", () => {
  const r = run("hård svullnad i höger fot");
  assert.equal(r.values.consistency, "72505002");
  assert.equal(r.values.laterality, "24028007");
  assert.equal(r.rest, "svullnad i fot");
});

test("Swedish 'fast' means firm, English 'fast' is not a code word", () => {
  assert.equal(run("fast svullnad").values.consistency, "20583004");
  assert.equal(run("fast onset pain").values.consistency, undefined);
});

test("a number word without a unit is not a duration", () => {
  const r = run("en tumme");
  assert.equal(r.duration, null);
});

test("aspect words fill the aspect, in both languages", () => {
  assert.equal(run("smärta på insidan av höger knä, mediala").values.aspect, "255561001");
  assert.equal(run("pain in the left knee, lateral").values.aspect, "49370004");
  assert.equal(run("pain in the knee").values.aspect, undefined);
});

test("relative time words: last week, last month, förra veckan", () => {
  assert.deepEqual(run("swollen ankle since last week").duration, { n: 7, unit: "day" });
  assert.deepEqual(run("pain for last month").duration, { n: 30, unit: "day" });
  assert.deepEqual(run("ont i knät sedan förra veckan").duration, { n: 7, unit: "day" });
});

test("'värk' is the word for pain, not the character 'aching': it stays in the text that is searched", () => {
  const r = run("värk i höger knä som blivit sämre");
  assert.equal(r.values.character, undefined);
  assert.equal(r.values.laterality, "24028007");
  assert.match(r.rest, /värk/);
  assert.equal(run("värkande knä").values.character, "27635008"); // the adjective is still the character
});

test("everyday synonyms for severity, constancy, progress, onset and character are read, and none stands for two answers", () => {
  const v = (t) => run(t).values;
  assert.equal(v("outhärdlig värk").severity, "24484000");
  assert.equal(v("terrible headache").severity, "24484000");
  assert.equal(v("lite ont i knät").severity, "255604002");
  assert.equal(v("pain all the time").pattern, "255238004");
  assert.equal(v("ont hela tiden").pattern, "255238004");
  assert.equal(v("it has eased off").progress, "3442003");
  assert.equal(v("smärtan har avtagit").progress, "3442003");
  assert.equal(v("the pain has increased").progress, "231877006");
  assert.equal(v("det smög sig på").onset, "61751001");
  assert.equal(v("pain that crept up").onset, "61751001");
  assert.equal(v("det brinner i handen").character, "36349006");
  assert.equal(v("ont, ingen skillnad").progress, "260388006");
});

test("no word of the word list stands for two different answers in the same language", async () => {
  const seen = new Map();
  for (const [code, d] of Object.entries(cfg.lexicon)) for (const lang of ["sv", "en"]) for (const w of d[lang] || []) {
    const k = lang + ":" + w;
    assert.ok(!seen.has(k) || seen.get(k) === code, `${k} is both ${seen.get(k)} and ${code}`);
    seen.set(k, code);
  }
});
