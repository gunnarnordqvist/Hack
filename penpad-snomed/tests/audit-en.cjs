// English audit: drives the whole app with the UI set to English and reports every visible line that looks Swedish.
//   node tests/audit-en.cjs <url>
// A line is suspicious if it has å/ä/ö, or a word that is in the Swedish UI texts but not in the English ones.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const url = process.argv[2];
if (!url) { console.error("usage: node tests/audit-en.cjs <url>"); process.exit(2); }

(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, ignoreHTTPSErrors: !!proxy });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: "networkidle" });

  // Swedish-only words: in the Swedish UI texts or the Swedish lexicon, not in any English text of ours
  const { svWords } = await page.evaluate(async () => {
    const { I } = await import("./i18n.js");
    const words = (o) => JSON.stringify(o).toLowerCase().match(/[a-zåäö]{4,}/g) || [];
    const sv = new Set(words(I.sv));
    const en = new Set(words(I.en));
    for (const w of en) sv.delete(w);
    return { svWords: [...sv] };
  });
  const svSet = new Set(svWords);
  const suspicious = (line) => {
    if (/[åäöÅÄÖ]/.test(line)) return true;
    const ws = line.toLowerCase().match(/[a-zåäö]{4,}/g) || [];
    return ws.some((w) => svSet.has(w));
  };

  const seen = new Map();
  const scan = async (label) => {
    const lines = await page.evaluate(() => {
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walk.nextNode())) {
        const p = n.parentElement;
        if (!p || ["SCRIPT", "STYLE", "TEXTAREA", "PRE", "CODE"].includes(p.tagName) || p.closest("pre")) continue;
        if (p.classList.contains("mono")) continue; // concept ids
        const t = n.textContent.trim();
        if (t) out.push(t);
      }
      // attributes people read: titles and aria labels
      for (const e of document.querySelectorAll("[aria-label],[title],[placeholder]")) for (const a of ["aria-label", "placeholder", "title"]) if (e.getAttribute(a)) out.push(e.getAttribute(a));
      return out;
    });
    for (const l of lines) if (suspicious(l)) { const k = l; if (!seen.has(k)) seen.set(k, label); }
  };
  const waitIdle = async (ms = 7000) => page.waitForTimeout(ms);

  if (process.env.AUDIT_SELFTEST) { // prove that the detector can fail: look at the Swedish page
    await scan("selftest (Swedish page)");
    console.log(`self-test: ${seen.size} suspicious line(s) on the Swedish page (must be > 0)`);
    await browser.close();
    process.exit(seen.size > 0 ? 0 : 1);
  }
  await page.click('.segbtn:has-text("EN")');
  await scan("start");

  // 1. every example
  const n = await page.$$eval("#samples .chip", (x) => x.length);
  for (let i = 0; i < n; i++) {
    await (await page.$$("#samples .chip"))[i].click();
    await waitIdle();
    await scan("example " + i);
    for (const tab of ["SNOMED", "openEHR", "FHIR", "Codes"]) { await page.click(`.tab:has-text("${tab}")`).catch(() => {}); await scan(`example ${i} tab ${tab}`); }
  }
  await page.click('.segbtn:has-text("Patient")'); await scan("patient mode");
  await page.click('.segbtn:has-text("Clinician")').catch(() => {});

  // 2. map: every region and every close-up
  const clickRegion = async (sel, label) => { await page.click(sel); await waitIdle(5000); await scan(label); };
  for (const r of ["head", "chest", "abdomen", "knee", "hand"]) {
    if (await page.$("#bm-back")) await page.click("#bm-back");
    await page.click(".loc button").catch(() => {});
    const side = ["knee", "hand"].includes(r) ? '[data-side="right"]' : "";
    await clickRegion(`.bm .part[data-region="${r}"]${side} path >> nth=0`, "map " + r);
  }
  // inside the head cross-section
  if (await page.$("#bm-back")) await page.click("#bm-back");
  await page.click('.bm .part[data-region="head"] path >> nth=0');
  for (const r of ["tongue", "teeth", "larynx", "throat", "nose"]) await clickRegion(`.bm .part[data-region="${r}"] path >> nth=0`, "head section " + r);
  await page.click("#bm-back");
  await page.click('.segbtn:has-text("Back")');
  await clickRegion('.bm .part[data-region="buttock"] path >> nth=0', "back close-up");
  await page.click("#bm-back");
  await page.click('.segbtn:has-text("Front")');
  await page.click(".loc button").catch(() => {});

  // 3. aspect chips and the form
  await page.click('.bm .part[data-region="knee"][data-side="right"] path >> nth=0');
  await page.click('[data-aspect="255561001"]');
  await page.waitForSelector(".mapitem", { timeout: 60000 });
  await page.click(".mapitem >> nth=0");
  await waitIdle(4000);
  await scan("form with aspect");
  await page.click("#add");
  await scan("after add to list");

  // 4. several findings in one sentence
  for (const text of ["pain in the right arm, hand and head since yesterday", "pain in the left knee and swollen right foot"]) {
    await page.fill("#text", text);
    await page.click("#go");
    await waitIdle(12000);
    await scan("multi: " + text);
  }
  if (await page.$("#add-all")) await page.click("#add-all");
  await scan("after add all");
  for (const tab of ["SNOMED", "openEHR", "FHIR", "Codes"]) { await page.click(`.tab:has-text("${tab}")`).catch(() => {}); await scan("list tab " + tab); }

  // 5. warnings and the personal data guard
  await page.fill("#text", "qqzzxx"); await page.click("#go"); await waitIdle(5000); await scan("no match");
  await page.fill("#text", "mail me at anna@example.com"); await page.click("#go"); await waitIdle(1500); await scan("personal data");

  await browser.close();
  if (errors.length) console.log("page errors:", errors.join(" | "));
  if (!seen.size) { console.log("English audit: no Swedish text found"); return; }
  console.log(`English audit: ${seen.size} suspicious line(s)`);
  for (const [l, where] of seen) console.log(`  [${where}] ${l}`);
  process.exitCode = 1;
})();
