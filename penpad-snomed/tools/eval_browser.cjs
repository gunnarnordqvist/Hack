// Measures the public page itself in a real browser: how often is the right finding among the first suggestions, with the word search
// only, with meaning only (local embedding model), and with both fused?   node tools/eval_browser.cjs <url> GOLD.json [GOLD2.json ...]
// Uses the same gold files as backend/eval_two_step.py (codes only). Needs Playwright; downloads the model (118 MB) through the browser.
const { chromium } = require("playwright");
const fs = require("fs");
const [url, ...goldFiles] = process.argv.slice(2);
(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  const page = await browser.newPage({ ignoreHTTPSErrors: !!proxy });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(url, { waitUntil: "networkidle" });
  const t0 = Date.now();
  await page.evaluate(() => window.__penpadApi.enableSemantic());
  const state = await page.evaluate(() => ({ sem: window.__penpad.ml.sem, msg: window.__penpad.ml.semMsg, info: window.__penpad.ml.info }));
  console.log("semantic index:", JSON.stringify(state), "in", Math.round((Date.now() - t0) / 1000), "s");
  if (state.sem !== "ready") { await browser.close(); process.exit(1); }
  for (const gf of goldFiles) {
    const gold = JSON.parse(fs.readFileSync(gf, "utf8")).items;
    const rows = await page.evaluate(async (gold) => {
      const S = window.__penpad;
      const { extract } = await import("./extract.js");
      const out = [];
      for (const g of gold) {
        S.lang = g.lang;
        const rest = extract(g.text, S.snap.cfg, S.snap.labels, S.phrases).rest;
        const row = { lang: g.lang, text: g.text, rest };
        for (const mode of ["off", "only", "fusion"]) {
          S.semMode = mode;
          let c;
          try { c = await window.__penpadApi.clientCandidates(rest, 5); } catch (e) { c = { items: [], low_confidence: true }; }
          const codes = c.items.map((i) => i.code);
          row[mode] = { h1: g.finding.includes(codes[0]) ? 1 : 0, h5: codes.some((x) => g.finding.includes(x)) ? 1 : 0, low: !!c.low_confidence, emb: c.items[0] ? c.items[0].scores.emb : null, top: c.items[0] ? (c.items[0].en || c.items[0].sv) : null };
        }
        out.push(row);
      }
      S.semMode = "fusion"; S.lang = "sv";
      return out;
    }, gold);
    const pc = (xs) => Math.round(100 * xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));
    console.log(`\n== ${gf.split("/").pop()} (${rows.length} phrases): first / first five, %`);
    for (const mode of ["off", "only", "fusion"]) {
      const label = { off: "word search only (the site without the model)", only: "meaning only", fusion: "both fused" }[mode];
      const part = (sel) => { const r = rows.filter(sel); return `${pc(r.map((x) => x[mode].h1))}/${pc(r.map((x) => x[mode].h5))}`; };
      // auto-pick: the top suggestion is taken without a warning; how often is that right?
      const auto = rows.filter((x) => !x[mode].low && x[mode].top);
      console.log(`  ${label}: all ${part(() => true)} | sv ${part((x) => x.lang === "sv")} | en ${part((x) => x.lang === "en")} | picked without warning: ${auto.length}, right ${pc(auto.map((x) => x[mode].h1))} %`);
    }
    if (process.env.EVAL_DETAIL) for (const r of rows) console.log(`   ${r.fusion.h1 ? "ok " : "-- "} ${r.fusion.emb} ${r.fusion.low ? "low" : "   "} | ${r.text} -> ${r.fusion.top}`);
  }
  await browser.close();
})();
