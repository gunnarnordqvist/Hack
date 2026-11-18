import test from "node:test";
import assert from "node:assert/strict";

// The network boundary: text that looks like personal data must never reach fetch().
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  return { ok: true, json: async () => ({ resourceType: "ValueSet", expansion: { total: 0, contains: [] } }) };
};
const { expand, TxError } = await import("../web/txclient.js");

test("a filter that looks like a personal identity number is refused before any request", async () => {
  calls.length = 0;
  await assert.rejects(() => expand("<< 22253000", { filter: "ont i tummen 121212-1212" }), (e) => e instanceof TxError && e.message === "personal-data");
  assert.equal(calls.length, 0);
});

test("an e-mail address is refused too", async () => {
  calls.length = 0;
  await assert.rejects(() => expand("<< 22253000", { filter: "anna@example.se" }), /personal-data/);
  assert.equal(calls.length, 0);
});

test("a normal search word is sent, URL-encoded, as the filter only", async () => {
  calls.length = 0;
  const r = await expand("<< 22253000", { filter: "smärta i tumme", lang: "sv" });
  assert.equal(r.total, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /filter=sm%C3%A4rta\+i\+tumme/);
  assert.match(calls[0], /^https:\/\/tx-nordics\.fhir\.org\/fhir\/r4\/ValueSet\/\$expand\?/);
});
