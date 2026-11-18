import test from "node:test";
import assert from "node:assert/strict";
import { splitClauses, bodyTable, findBodyWord, parseMulti } from "../web/multi.js";
import { cfg, labels } from "./helpers.mjs";

const parse = (t) => parseMulti(t, cfg, labels);
const summary = (r) => r.entries.map((e) => `${e.query}|${e.regions.join("+")}`);

test("a text is cut at commas, och, and, samt", () => {
  assert.deepEqual(splitClauses("ont i armen, handen och huvudet"), ["ont i armen", "handen", "huvudet"]);
  assert.deepEqual(splitClauses("pain in the arm, hand and head"), ["pain in the arm", "hand", "head"]);
  assert.deepEqual(splitClauses("a samt b; c + d"), ["a", "b", "c", "d"]);
  assert.deepEqual(splitClauses(""), []);
});

test("body words are found as whole words, in both languages and in definite forms", () => {
  const tb = bodyTable(cfg);
  assert.equal(findBodyWord("ont i handen", tb).regions[0], "hand");
  assert.equal(findBodyWord("pain in the knee", tb).regions[0], "knee");
  assert.equal(findBodyWord("smärta i underarmen", tb).regions[0], "forearm");
  assert.equal(findBodyWord("handledsbesvär", tb), null); // part of a longer word: not a body word on its own
  assert.equal(findBodyWord("ont", tb), null);
  assert.equal(findBodyWord("huvudvärk", tb).compound, true);
});

test("after a fall: arm, hand and head become three findings, each with its own body part", () => {
  const sv = parse("ont i armen, handen och huvudet");
  assert.equal(sv.multi, true);
  assert.deepEqual(sv.entries.map((e) => e.query), ["ont i armen", "ont i handen", "huvudvärk"]); // "ont i huvudet" has a finding of its own
  assert.deepEqual(sv.entries.map((e) => e.regions[0]), ["arm", "hand", "head"]);
  const en = parse("pain in the arm, hand and head");
  assert.deepEqual(en.entries.map((e) => e.query), ["pain in the arm", "pain in the hand", "headache"]);
});

test("a side, a severity or a character belongs to its own body part only", () => {
  const r = parse("svår smärta i höger arm och vänster hand, bultande");
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[0].values.laterality, "24028007");
  assert.equal(r.entries[1].values.laterality, "7771000");
  assert.equal(r.entries[0].values.severity, "24484000");
  assert.equal(r.entries[1].values.severity, undefined);
  assert.equal(r.entries[1].values.character, "29695002"); // said after the last part: it goes with that part
  assert.equal(r.entries[0].values.character, undefined);
});

test("time words said once are shared, a side is never shared", () => {
  const r = parse("ont i höger arm, handen och huvudet sedan igår");
  assert.equal(r.entries.length, 3);
  assert.ok(r.entries.every((e) => e.duration && e.duration.n === 1));
  assert.equal(r.entries[0].values.laterality, "24028007");
  assert.equal(r.entries[1].values.laterality, undefined);
  assert.equal(r.entries[2].values.laterality, undefined);
});

test("a compound word is a whole finding of its own", () => {
  const r = parse("ont i armen och huvudvärk");
  assert.deepEqual(summary(r), ["ont i armen|arm", "huvudvärk|head"]);
  const e = parse("swollen foot and pain in the knee");
  assert.deepEqual(e.entries.map((x) => x.regions[0]), ["foot", "knee"]);
});

test("one finding with several qualifiers stays one finding", () => {
  for (const t of ["smärta i vänster tumme sedan två dagar, bultande", "pain in the right knee for 3 weeks, severe, intermittent", "my thumb hurts, left, since yesterday", "headache since two days, severe, throbbing"]) {
    const r = parse(t);
    assert.equal(r.multi, false, t);
    assert.equal(r.entries.length, 1, t);
  }
});

test("text without any finding words gives no entries", () => {
  assert.equal(parse("").entries.length, 0);
  assert.equal(parse("bultande, svår").entries.length, 0);
});

test("an everyday phrase with a finding of its own becomes that finding's word", async () => {
  const { aliasOf } = await import("../web/multi.js");
  assert.equal(aliasOf("ont i huvudet", cfg).query, "huvudvärk");
  assert.equal(aliasOf("pain in the head", cfg).query, "headache");
  assert.deepEqual(aliasOf("ont i huvudet", cfg).regions, ["head"]);
  assert.equal(aliasOf("ont i handen", cfg), null);
  const r = parse("ont i armen, handen och huvudet");
  assert.equal(r.entries[2].query, "huvudvärk");
  assert.deepEqual(r.entries[2].regions, ["head"]);
});

test("the whole arm and the whole leg are body parts of their own (upper and lower limb)", () => {
  const r = parse("pain in the left arm and right leg");
  assert.deepEqual(r.entries.map((e) => e.regions), [["arm"], ["leg"]]);
  assert.deepEqual(r.entries.map((e) => e.values.laterality), ["7771000", "24028007"]);
});

test("every entry knows the language of its body word", () => {
  assert.equal(parse("stomach ache and ont i handen").entries.map((e) => e.lang).join(), "en,sv");
});

test("a later clause without a body word but with words of its own is a maybe-finding, not lost", () => {
  const r = parse("feber och hosta sedan tre dagar");
  assert.deepEqual(r.entries.map((e) => [e.query, !!e.optional]), [["feber", false], ["hosta", true]]);
  assert.equal(r.hasOptional, true);
  assert.equal(r.multi, false); // only the app can tell, by trying "hosta" against SNOMED CT
  assert.ok(r.entries.every((e) => e.duration && e.duration.n === 3)); // a time word said once is shared
  const en = parse("fever and cough for three days");
  assert.deepEqual(en.entries.map((e) => e.query), ["fever", "cough"]);
});

test("filler such as 'sudden onset' is not a maybe-finding", () => {
  for (const t of ["smärta i vänster tumme sedan två dagar, bultande, måttlig, plötslig debut, sämre", "pain in the knee, worse, sudden onset"]) {
    const r = parse(t);
    assert.equal(r.hasOptional, false, t);
    assert.equal(r.entries.length, 1, t);
  }
});

test("a body part followed by a plain quality word stays one finding", () => {
  const r = parse("pain in the knee, worse in the morning");
  assert.equal(r.entries.filter((e) => !e.optional).length, 1);
  assert.equal(r.multi, false);
});
