import test from "node:test";
import assert from "node:assert/strict";
import { serializeList, parseList, FORMAT, MAX_ENTRIES } from "../web/listio.js";
import { cfg, thumbState } from "./helpers.mjs";

const chart = () => [{ finding: thumbState().finding, values: { laterality: "7771000", severity: "6736007" }, duration: { n: 2, unit: "day" } }];

test("a saved list holds codes and answers only, no names", () => {
  const text = serializeList(chart());
  const j = JSON.parse(text);
  assert.equal(j.format, FORMAT);
  assert.deepEqual(j.entries[0], { finding: "300955002", topic: "pain", values: { laterality: "7771000", severity: "6736007" }, duration: { n: 2, unit: "day" } });
  assert.doesNotMatch(text, /thumb|tumme|ache|värk/i);
});

test("a saved list can be read again", () => {
  const r = parseList(serializeList(chart()), cfg);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.entries, [{ code: "300955002", topic: "pain", values: { laterality: "7771000", severity: "6736007" }, duration: { n: 2, unit: "day" } }]);
});

test("a file that is not a saved list, or has bad entries, is refused entry by entry", () => {
  assert.ok(parseList("not json", cfg).problems.length);
  assert.ok(parseList(JSON.stringify({ format: "other", entries: [] }), cfg).problems.length);
  const bad = JSON.stringify({ format: FORMAT, entries: [
    { finding: "300955002", topic: "pain", values: {} },
    { finding: "abc", topic: "pain", values: {} },
    { finding: "300955002", topic: "nope", values: {} },
    { finding: "300955002", topic: "pain", values: { laterality: "<script>" } },
    { finding: "300955002", topic: "pain", values: { notaslot: "7771000" } },
    { finding: "300955002", topic: "pain", values: {}, duration: { n: -1, unit: "day" } },
    { finding: "300955002", topic: "pain", values: {}, duration: { n: 2, unit: "fortnight" } },
  ] });
  const r = parseList(bad, cfg);
  assert.equal(r.entries.length, 1);
  assert.equal(r.problems.length, 6);
});

test("size limits", () => {
  assert.ok(parseList("x".repeat(300000), cfg).problems.length);
  const many = JSON.stringify({ format: FORMAT, entries: Array.from({ length: MAX_ENTRIES + 5 }, () => ({ finding: "300955002", topic: "pain", values: {} })) });
  const r = parseList(many, cfg);
  assert.equal(r.entries.length, MAX_ENTRIES);
  assert.ok(r.problems.some((p) => /first/.test(p)));
});
