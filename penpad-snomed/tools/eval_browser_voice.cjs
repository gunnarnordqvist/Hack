// Measures speech recognition in the browser (the page's own code path) on recordings of the gold phrases:
//   node tools/eval_browser_voice.cjs <url> GOLD.json AUDIO_DIR [--sem]
// AUDIO_DIR holds NN.wav in the order of GOLD.json. Reports how many transcripts are word for word right, and how often the right finding
// is among the first suggestions when the transcript goes through the page's search (with --sem: with the local embedding model on).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [url, goldFile, audioDir, flag] = process.argv.slice(2);
(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  const page = await browser.newPage({ ignoreHTTPSErrors: !!proxy });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(url, { waitUntil: "networkidle" });
  if (flag === "--sem") { await page.evaluate(() => window.__penpadApi.enableSemantic()); console.log("semantic:", await page.evaluate(() => window.__penpad.ml.sem)); }
  if (process.env.ASR_SV) await page.evaluate((m) => { window.__penpadML.ASR_MODELS.sv = m; }, process.env.ASR_SV); // try another Swedish recogniser
  const gold = JSON.parse(fs.readFileSync(goldFile, "utf8")).items.map((g, n) => ({ ...g, n })).filter((g) => !process.env.ONLY_LANG || g.lang === process.env.ONLY_LANG); // n = number of the recording
  const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean).join(" ");
  const rows = [];
  const t0 = Date.now();
  for (let i = 0; i < gold.length; i++) {
    const g = gold[i];
    const b64 = fs.readFileSync(path.join(audioDir, String(g.n).padStart(2, "0") + ".wav")).toString("base64");
    const r = await page.evaluate(async ({ b64, g }) => {
      const S = window.__penpad, ML = window.__penpadML;
      const bin = atob(b64); const buf = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
      const t1 = performance.now();
      const audio = await ML.decodeTo16k(buf.buffer);
      const text = await ML.transcribe(audio, g.lang);
      const ms = performance.now() - t1;
      const { extract } = await import("./extract.js");
      S.lang = g.lang;
      const ex = extract(text, S.snap.cfg, S.snap.labels, S.phrases);
      let c; try { c = await window.__penpadApi.clientCandidates(ex.rest, 5); } catch (e) { c = { items: [] }; }
      const codes = c.items.map((x) => x.code);
      return { text, ms, h1: g.finding.includes(codes[0]) ? 1 : 0, h5: codes.some((x) => g.finding.includes(x)) ? 1 : 0, slots: ex.values };
    }, { b64, g });
    rows.push({ ...r, lang: g.lang, exact: norm(r.text) === norm(g.text) ? 1 : 0, slotsOk: Object.entries(g.slots).every(([k, v]) => r.slots[k] === v) ? 1 : 0 });
    if (process.env.EVAL_DETAIL) console.log(`   ${r.h5 ? "ok " : "-- "} ${g.text}  =>  ${r.text}`);
  }
  const pc = (xs) => Math.round(100 * xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));
  for (const [name, sel] of [["all", () => true], ["sv", (x) => x.lang === "sv"], ["en", (x) => x.lang === "en"]]) {
    const r = rows.filter(sel);
    console.log(`${name} (${r.length}): word for word ${pc(r.map((x) => x.exact))} % | finding first ${pc(r.map((x) => x.h1))} %, first five ${pc(r.map((x) => x.h5))} % | every answer read right ${pc(r.map((x) => x.slotsOk))} % | ${Math.round(r.reduce((a, x) => a + x.ms, 0) / r.length / 100) / 10} s per phrase`);
  }
  console.log("total", Math.round((Date.now() - t0) / 1000), "s");
  await browser.close();
})();
