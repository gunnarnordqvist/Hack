import test from "node:test";
import assert from "node:assert/strict";
import { rankConcepts, fuseRanks, namesOf, resampleLinear, tidyTranscript, EMBED_MODEL, ASR_MODELS, ASR_SMALL, DOWNLOAD_MB, LIB_VERSION, lowMemory, asrModel, asrMB } from "../web/ml.js";
import { readFileSync } from "node:fs";

test("concepts are ranked by their best name; ties never depend on the order of the list", () => {
  // three names, two concepts, dim 2: concept a has names (1,0) and (0,1); concept b has (0.6,0.8)
  const m = new Float32Array([1, 0, 0, 1, 0.6, 0.8]);
  const r = rankConcepts(new Float32Array([0, 1]), m, 2, ["a", "a", "b"]);
  assert.deepEqual(r.map((x) => x.code), ["a", "b"]);
  assert.ok(Math.abs(r[0].cos - 1) < 1e-6 && Math.abs(r[1].cos - 0.8) < 1e-6);
  const tie = rankConcepts(new Float32Array([1, 0]), new Float32Array([1, 0, 1, 0]), 2, ["z", "y"]);
  assert.deepEqual(tie.map((x) => x.code), ["y", "z"]);
  assert.equal(rankConcepts(new Float32Array([1, 0]), m, 2, ["a", "a", "b"], 1).length, 1);
});

test("rank fusion rewards a code that both lists like", () => {
  assert.equal(fuseRanks([["a", "b", "c"], ["b", "d"]])[0], "b");
  assert.deepEqual(fuseRanks([["a"], []]), ["a"]);
});

test("names to embed: English and Swedish, the same string only once per concept", () => {
  assert.deepEqual(namesOf([["1", "Headache", "huvudvärk", "pain"], ["2", "Fatigue", "Fatigue", "general"], ["3", null, "bara svenska", "pain"]]),
    [{ code: "1", text: "Headache" }, { code: "1", text: "huvudvärk" }, { code: "2", text: "Fatigue" }, { code: "3", text: "bara svenska" }]);
});

test("audio is resampled to 16 kHz", () => {
  const out = resampleLinear(new Float32Array(48000).fill(0.5), 48000);
  assert.equal(out.length, 16000);
  assert.ok(Math.abs(out[100] - 0.5) < 1e-6);
  const same = new Float32Array(10);
  assert.equal(resampleLinear(same, 16000), same);
});

test("a transcript is tidied for the text box", () => {
  assert.equal(tidyTranscript("  Ont i magen   kommer och går. "), "Ont i magen kommer och går");
  assert.equal(tidyTranscript('"Headache!"'), "Headache");
  assert.equal(tidyTranscript(null), "");
});

test("the worker loads a pinned library version and the models are the ones in the dependency policy", () => {
  const w = readFileSync(new URL("../web/mlworker.js", import.meta.url), "utf8");
  const urls = [...w.matchAll(/from "(https:[^"]+)"/g)].map((m) => m[1]);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@\d+\.\d+\.\d+$/);
  const policy = readFileSync(new URL("../dependency-policy.yaml", import.meta.url), "utf8");
  for (const m of [EMBED_MODEL, ASR_MODELS.sv, ASR_MODELS.en, ASR_SMALL.sv, ASR_SMALL.en]) assert.ok(policy.includes(m), m + " missing in dependency-policy.yaml");
  assert.equal(urls[0].split("@huggingface/transformers@")[1], LIB_VERSION);
  const line = policy.split("\n").find((l) => l.includes('"@huggingface/transformers"'));
  assert.ok(line && line.includes(`version: "${LIB_VERSION}"`), "library version missing on its line in the policy");
  assert.ok(DOWNLOAD_MB.embed > 0 && DOWNLOAD_MB.asr.sv > 0);
});

test("phones and devices with little memory get the small speech model, a desktop gets the base model", () => {
  assert.equal(lowMemory({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari" }), true);
  assert.equal(lowMemory({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome Mobile" }), true);
  assert.equal(lowMemory({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }), true); // iPad that says it is a Mac
  assert.equal(lowMemory({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome", deviceMemory: 4 }), true);
  assert.equal(lowMemory({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome", deviceMemory: 8, maxTouchPoints: 0 }), false);
  assert.equal(lowMemory({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", maxTouchPoints: 0 }), false);
  assert.equal(asrModel("sv", true), "KBLab/kb-whisper-tiny");
  assert.equal(asrModel("sv", false), "KBLab/kb-whisper-base");
  assert.equal(asrModel("en", true), "Xenova/whisper-tiny");
  assert.ok(asrMB("sv", true) < asrMB("sv", false));
});

import { speechApi, startSpeechApi } from "../web/ml.js";

// a stand-in for the browser's SpeechRecognition
function fakeWindow(script) {
  class SR {
    constructor() { SR.last = this; this.started = false; }
    start() { this.started = true; script.onStart && script.onStart(this); }
    stop() { script.onStop && script.onStop(this); }
    abort() { this.aborted = true; }
  }
  return { webkitSpeechRecognition: SR, SR };
}
const results = (...parts) => ({ results: parts.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal })) });

test("the device's speech recognition: the API is found under either name, and not found when absent", () => {
  assert.equal(speechApi({}), null);
  const w = fakeWindow({});
  assert.equal(speechApi(w), w.SR);
  const w2 = { SpeechRecognition: class {} };
  assert.equal(speechApi(w2), w2.SpeechRecognition);
});

test("the device's speech recognition: language, interim words, and the final text on stop", async () => {
  const w = fakeWindow({ onStop(r) { r.onresult(results(["ont i magen", true], [" kommer och går", false])); r.onend(); } });
  const seen = [];
  const rec = startSpeechApi("sv", (t) => seen.push(t), w);
  assert.equal(w.SR.last.lang, "sv-SE");
  assert.equal(w.SR.last.interimResults, true);
  w.SR.last.onresult(results(["ont i"], [])); // never called with an empty list in the real API; harmless here
  w.SR.last.onresult(results(["ont i magen", false]));
  assert.deepEqual(seen.at(-1), "ont i magen");
  assert.equal(await rec.stop(), "ont i magen kommer och går"); // final text first, then what was still interim
  assert.equal(startSpeechApi("en", null, fakeWindow({})) && true, true);
});

test("the device's speech recognition: an error is reported in words, and a result wins over a late error", async () => {
  const w = fakeWindow({ onStop(r) { r.onerror({ error: "service-not-allowed" }); r.onend(); } });
  await assert.rejects(startSpeechApi("sv", null, w).stop(), /Enable Dictation/);
  const w2 = fakeWindow({ onStop(r) { r.onresult(results(["ont i magen", true])); r.onerror({ error: "no-speech" }); r.onend(); } });
  assert.equal(await startSpeechApi("sv", null, w2).stop(), "ont i magen");
  const w3 = fakeWindow({ onStop(r) { r.onend(); } });
  assert.equal(await startSpeechApi("en", null, w3).stop(), ""); // nothing heard: an empty text, not an error
  assert.throws(() => startSpeechApi("sv", null, {}), /no speech recognition/);
});

test("the device's speech recognition: stop after the recogniser ended on its own still gives the text", async () => {
  const w = fakeWindow({});
  const rec = startSpeechApi("en", null, w);
  w.SR.last.onresult(results(["headache", true]));
  w.SR.last.onend();
  assert.equal(await rec.stop(), "headache");
});
