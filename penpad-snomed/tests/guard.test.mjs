import test from "node:test";
import assert from "node:assert/strict";
import { personalDataReason } from "../web/guard.js";

test("personal identity numbers are recognised in the usual forms", () => {
  for (const t of ["121212-1212", "121212 1212", "1212121212", "19121212-1212", "191212121212", "ont i tummen 800101+1234 sedan igår"]) {
    assert.equal(personalDataReason(t), "personnummer", t);
  }
});

test("e-mail addresses are recognised", () => {
  assert.equal(personalDataReason("kontakta anna.svensson@example.se om smärtan"), "email");
});

test("ordinary symptom text passes", () => {
  for (const t of ["smärta i vänster tumme sedan två dagar", "pain for 3 weeks, severe", "sedan 12 veckor", "2026-11-18", "blodtryck 120/80", "headache since 2 days", "", null, undefined]) {
    assert.equal(personalDataReason(t), null, String(t));
  }
});

test("separators, dashes, full-width digits, phone numbers and spelled-out e-mail do not slip through", () => {
  for (const x of ["121212-12 12", "12 12 12 1212", "121212 - 1212", "121212\u20131212", "1212-121212", "\uff11\uff12\uff11\uff12\uff11\uff12\uff11\uff12\uff11\uff12", "+46701234567", "070-123 45 67", "anna (at) x.se"])
    assert.notEqual(personalDataReason(x), null, x);
  assert.equal(personalDataReason("pain for 2 days, 3 times, since 12 March"), null);
});

test("a name or a street address is recognised; a capitalised first word and lower-case symptom text are not", () => {
  assert.equal(personalDataReason("ont i armen, patienten heter Anna Svensson"), "name");
  assert.equal(personalDataReason("pain in the knee, John Smith says"), "name");
  assert.equal(personalDataReason("Anna Svensson, Storgatan 1"), "address");
  assert.equal(personalDataReason("lives at Kungsgatan 12"), "address");
  for (const t of ["Smärta i vänster tumme sedan två dagar", "Pain in the right knee", "ont i huvudet, Feber sedan igår", "headache and fever for 3 days"]) assert.equal(personalDataReason(t), null, t);
});
