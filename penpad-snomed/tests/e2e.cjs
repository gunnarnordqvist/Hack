// End-to-end check in a real browser: node tests/e2e.cjs <baseUrl> <outDir>
// Drives the demo through the whole flow, asserts what the user sees, and saves screenshots.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || "http://127.0.0.1:8766/";
const out = process.argv[3] || path.join(__dirname, "..", "screenshots");
fs.mkdirSync(out, { recursive: true });
const checks = [];
const check = (name, ok, extra = "") => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  const missing = [];
  page.on("response", (r) => { if (r.status() === 404) missing.push(r.url()); });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(base);
  await page.waitForSelector("#sentence", { timeout: 15000 });
  const live = await page.evaluate(() => window.__penpad.live);
  console.log("mode:", live ? "live" : "static");

  // 1. first sample runs on load
  let sentence = await page.textContent("#sentence");
  check("sample sentence (sv, clinician)", sentence === "Smärta i tumme, vänster, sedan 2 dagar. Bultande, medelsvår. Debut: plötslig. Förlopp: sämre.", sentence);
  await page.screenshot({ path: path.join(out, "01-sv-clinician.png"), fullPage: true });

  // 2. laterality is offered for a thumb; options are buttons with a more-cue
  check("laterality block shown for lateralizable site", (await page.$$('[data-slot="laterality"]')).length === 1);
  check("a 'more' cue exists on severity", (await page.$$('[data-slot="severity"] .opt.more')).length === 1);
  await page.click('[data-slot="severity"] .opt.more');
  const sevButtons = await page.$$eval('[data-slot="severity"] .opt:not(.more)', (b) => b.length);
  check("more… expands severity options", sevButtons > 3, `buttons=${sevButtons}`);
  await page.screenshot({ path: path.join(out, "02-more-expanded.png"), fullPage: true });
  await page.click('[data-slot="severity"] .opt.more');

  // 3. change a value: sentence updates, confirmation resets
  await page.click('[data-slot="severity"] button.opt:text-is("svår")');
  sentence = await page.textContent("#sentence");
  check("sentence follows a changed severity", /svår\./.test(sentence) && !/medelsvår/.test(sentence), sentence);

  // 4. confirm
  await page.click("#yes");
  check("confirmation message", (await page.textContent("#okmsg")).includes("Bekräftat"));

  // 5. outputs
  const tabs = ["SNOMED-uttryck", "openEHR", "FHIR", "Koder"];
  for (const [i, tname] of tabs.entries()) {
    await page.click(`.tab:has-text("${tname}")`);
    const txt = await page.textContent("#outputs");
    const ok = [/300955002 \|Pain in thumb\|/, /"_type": "COMPOSITION"/, /"resourceType": "Condition"/, /76505004/][i].test(txt);
    check(`output tab ${tname}`, ok);
    if (i === 1 || i === 3) await page.screenshot({ path: path.join(out, `0${3 + (i === 3 ? 1 : 0)}-tab-${tname}.png`), fullPage: true });
  }

  // 6. language and patient mode
  await page.click('.segbtn:has-text("EN")');
  sentence = await page.textContent("#sentence");
  check("English clinician sentence", /^Pain in thumb, Left, for 2 days\./.test(sentence), sentence);
  await page.click('.segbtn:has-text("Patient")');
  sentence = await page.textContent("#sentence");
  check("English patient sentence", /^You have pain in your left thumb for 2 days\./.test(sentence), sentence);
  await page.screenshot({ path: path.join(out, "05-en-patient.png"), fullPage: true });
  await page.click('.segbtn:has-text("SV")');
  sentence = await page.textContent("#sentence");
  check("Swedish patient sentence", /^Du har ont i vänster tumme sedan 2 dagar\./.test(sentence), sentence);
  await page.click('.segbtn:has-text("Klinik")');

  // 7. another sample: swelling of the right foot (hard)
  await page.click('.chip:has-text("svullen höger fot")');
  await page.waitForFunction(() => window.__penpad.finding && window.__penpad.finding.topic === "swelling");
  sentence = await page.textContent("#sentence");
  check("swelling sample", /^Svullen fot, höger, sedan 1 vecka\. Hård\./.test(sentence), sentence);

  // 8. low-confidence input shows a warning and a manual path
  await page.fill("#text", "magont");
  await page.click("#go");
  await page.waitForSelector(".warn");
  const warn = await page.textContent(".warn");
  const hasManual = (await page.$$("#manual")).length === 1;
  check("low confidence warning and manual search", /säkerhet|träff/i.test(warn) && hasManual, warn);
  await page.screenshot({ path: path.join(out, "06-low-confidence.png"), fullPage: true });

  // 9. free text typed by the user
  await page.fill("#text", "pain in the right knee for 3 weeks, severe, intermittent");
  await page.click("#go");
  await page.waitForFunction(() => window.__penpad.finding);
  const f = await page.evaluate(() => ({ code: window.__penpad.finding.code, vals: window.__penpad.values, dur: window.__penpad.duration }));
  console.log("typed finding:", JSON.stringify(f));
  check("typed text prefilled severity/pattern/duration", f.vals.severity === "24484000" && f.vals.pattern === "7087005" && f.dur && f.dur.n === 3);

  // 10. phone width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.fill("#text", "smärta i vänster tumme sedan två dagar, bultande");
  await page.click("#go");
  await page.waitForFunction(() => window.__penpad.finding && window.__penpad.finding.code === "300955002");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no horizontal page scroll at 390px", overflow <= 1, `overflow=${overflow}`);
  await page.screenshot({ path: path.join(out, "07-phone.png"), fullPage: true });

  // static mode has no backend: the probe of /api/health is expected to 404
  const unexpected404 = missing.filter((u) => !u.endsWith("/api/health"));
  const realErrors = errors.filter((e) => !/404/.test(e) || unexpected404.length);
  check("no console errors (the /api/health probe may 404 without a backend)", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
