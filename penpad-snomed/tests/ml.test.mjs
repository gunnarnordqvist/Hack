import test from "node:test";
import assert from "node:assert/strict";
import { rankConcepts, fuseRanks, namesOf, resampleLinear, tidyTranscript, EMBED_MODEL, ASR_MODELS, DOWNLOAD_MB, LIB_VERSION } from "../web/ml.js";
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
  for (const m of [EMBED_MODEL, ASR_MODELS.sv, ASR_MODELS.en]) assert.ok(policy.includes(m), m + " missing in dependency-policy.yaml");
  assert.equal(urls[0].split("@huggingface/transformers@")[1], LIB_VERSION);
  const line = policy.split("\n").find((l) => l.includes('"@huggingface/transformers"'));
  assert.ok(line && line.includes(`version: "${LIB_VERSION}"`), "library version missing on its line in the policy");
  assert.ok(DOWNLOAD_MB.embed > 0 && DOWNLOAD_MB.asr.sv > 0);
});
