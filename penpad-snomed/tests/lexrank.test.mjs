import test from "node:test";
import assert from "node:assert/strict";
import { rankLexical, lexScore } from "../web/lexrank.js";

// rows: [code, en, sv, topic]. Some concepts exist only in the Swedish module and have no English term (en = null).
const universe = [
  ["1", "pain in thumb", "smärta i tumme", "pain"],
  ["2", null, "smärta i fingerled", "pain"],
  ["3", "swollen thumb", null, "swelling"],
];

test("a concept without an English term does not break the ranking", () => {
  const r = rankLexical("smärta i tumme", universe);
  assert.equal(r.items[0].code, "1");
  assert.ok(r.items.some((i) => i.code === "2"), "the Swedish-only concept can still be found by Swedish text");
});

test("ties are broken by the shorter name, using whichever name exists", () => {
  const r = rankLexical("tumme", [["a", "thumb pain at rest", "tumme värk i vila", "pain"], ["b", null, "tumme", "pain"]]);
  assert.equal(r.items[0].code, "b");
});

test("token overlap scoring", () => {
  assert.equal(lexScore("smärta i tumme", "smärta i tumme"), 1);
  assert.equal(lexScore("xyz", "smärta i tumme"), 0);
  assert.equal(lexScore("anything", null), 0);
});

test("filler words are dropped from what is sent to the terminology server", async () => {
  const { contentWords } = await import("../web/lexrank.js");
  assert.equal(contentWords("Pain in the knee"), "pain knee");
  assert.equal(contentWords("ont i tummen"), "ont tummen");
  assert.equal(contentWords("in the"), "");
});

test("everyday pain words become the word the terms use", async () => {
  const { normalizeSymptoms } = await import("../web/lexrank.js");
  assert.equal(normalizeSymptoms("my thumb hurts"), "my thumb pain");
  assert.equal(normalizeSymptoms("knee aching"), "knee pain");
  assert.equal(normalizeSymptoms("ont i magen"), "smärta i magen");
  assert.equal(normalizeSymptoms("halsont"), "halsont");
  assert.equal(normalizeSymptoms("huvudvärk"), "huvudvärk");
});
