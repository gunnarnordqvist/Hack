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
  // outbound HTTPS (client mode talks to the terminology server) may need the sandbox proxy
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: !!proxy });
  const errors = [];
  const missing = [];
  page.on("response", (r) => { if (r.status() === 404) missing.push(r.url()); });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(base);
  await page.waitForSelector("#sentence", { timeout: 60000 });
  const live = await page.evaluate(() => window.__penpad.live);
  console.log("mode:", await page.evaluate(() => window.__penpad.source), live ? "(with backend)" : "");

  // 1. first sample runs on load
  let sentence = await page.textContent("#sentence");
  check("sample sentence (sv, clinician)", /tumme, vänster, sedan 2 dagar\. .+\. Debut: .+\. Förlopp: .+\.$/i.test(sentence), sentence);
  await page.screenshot({ path: path.join(out, "01-sv-clinician.png"), fullPage: true });

  // 2. laterality is offered for a thumb; options are buttons with a more-cue
  check("laterality block shown for lateralizable site", (await page.$$('[data-slot="laterality"]')).length === 1);
  check("a 'more' cue exists on severity", (await page.$$('[data-slot="severity"] .opt.more')).length === 1);
  await page.click('[data-slot="severity"] .opt.more');
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="severity"] .opt:not(.more)').length > 3, null, { timeout: 60000 });
  const sevButtons = await page.$$eval('[data-slot="severity"] .opt:not(.more)', (b) => b.length);
  check("more… expands severity options", sevButtons > 3, `buttons=${sevButtons}`);
  await page.screenshot({ path: path.join(out, "02-more-expanded.png"), fullPage: true });
  await page.click('[data-slot="severity"] .opt.more');

  // 3. change a value: sentence updates, confirmation resets
  await page.click('[data-slot="severity"] button.opt:text-is("svår")');
  sentence = await page.textContent("#sentence");
  check("sentence follows a changed severity", /svår\./.test(sentence) && !/medelsvår|måttlig/.test(sentence), sentence);

  // 4. confirm
  await page.click("#yes");
  check("confirmation message", (await page.textContent("#okmsg")).includes("Bekräftat"));

  // 5. outputs
  const tabs = ["SNOMED-uttryck", "openEHR", "FHIR", "Koder"];
  for (const [i, tname] of tabs.entries()) {
    await page.click(`.tab:has-text("${tname}")`);
    const txt = await page.textContent("#outputs");
    const ok = [/300955002 \|[^|]+\| :/, /"_type": "COMPOSITION"/, /"resourceType": "Condition"/, /76505004/][i].test(txt);
    check(`output tab ${tname}`, ok);
    if (i === 1 || i === 3) await page.screenshot({ path: path.join(out, `0${3 + (i === 3 ? 1 : 0)}-tab-${tname}.png`), fullPage: true });
  }

  // 6. language and patient mode
  await page.click('.segbtn:has-text("EN")');
  sentence = await page.textContent("#sentence");
  check("English clinician sentence", /thumb.*, left, for 2 days\./i.test(sentence), sentence);
  await page.click('.segbtn:has-text("Patient")');
  sentence = await page.textContent("#sentence");
  check("English patient sentence", /^You have pain in your left thumb for 2 days\./.test(sentence), sentence);
  await page.screenshot({ path: path.join(out, "05-en-patient.png"), fullPage: true });
  await page.click('.segbtn:has-text("SV")');
  sentence = await page.textContent("#sentence");
  check("Swedish patient sentence", /^Du har ont i vänster tumme sedan 2 dagar\./.test(sentence), sentence);
  await page.click('.segbtn:has-text("Klinik")');

  // 6b. body map
  check("body map is drawn (front view)", (await page.$$(".bm .part")).length > 20);
  const hl = await page.$$eval(".bm .part.hl", (n) => n.map((x) => x.dataset.region + ":" + x.dataset.side));
  check("selected finding is highlighted on the left hand (thumb falls back to hand)", hl.length === 1 && hl[0] === "hand:left", hl.join(","));
  await page.screenshot({ path: path.join(out, "08-map-highlight.png"), fullPage: true });
  await page.click('.bm .part[data-region="knee"][data-side="right"] path >> nth=0');
  await page.waitForSelector(".mapitem", { timeout: 60000 });
  const kneeItems = await page.$$eval(".mapitem", (n) => n.length);
  check("clicking the right knee lists findings", kneeItems > 0, `items=${kneeItems}`);
  await page.click(".mapitem >> nth=0");
  await page.waitForFunction(() => window.__penpad.finding && window.__penpad.finding.site && /knä|knee/i.test(window.__penpad.finding.site.sv + window.__penpad.finding.site.en));
  const lat = await page.evaluate(() => window.__penpad.values.laterality);
  check("side from the map becomes laterality (right)", lat === "24028007", String(lat));
  check("tag says it came from the body map", (await page.textContent('[data-slot="laterality"] .tag')).includes("kroppskartan"));
  await page.screenshot({ path: path.join(out, "09-map-knee.png"), fullPage: true });
  await page.click("#bm-back"); // the knee opened the leg close-up
  await page.click('.bm .part[data-region="hand"][data-side="left"] path >> nth=0');
  await page.waitForSelector('.bm .part[data-region="thumb"]');
  check("hand zoom shows thumb and four fingers", (await page.$$eval('.bm .part[data-region="fingers"] path', (n) => n.length)) === 4);
  await page.screenshot({ path: path.join(out, "10-map-hand-zoom.png"), fullPage: true });
  await page.click('.bm .part[data-region="thumb"] path >> nth=0');
  await page.waitForSelector('.mapitem[data-code="300955002"]', { timeout: 60000 });
  await page.click('.mapitem[data-code="300955002"]');
  await page.waitForFunction(() => window.__penpad.finding && window.__penpad.finding.code === "300955002", null, { timeout: 60000 });
  check("thumb pain via the map, left side prefilled", (await page.evaluate(() => window.__penpad.values.laterality)) === "7771000");
  await page.click("#bm-back");
  // the right hand: no finding that names the left side may stay in the list, and vice versa
  await page.click('.bm .part[data-region="hand"][data-side="right"] path >> nth=0');
  await page.waitForSelector(".mapitem", { timeout: 60000 });
  const rightTexts = await page.$$eval(".mapitem span:first-child", (n) => n.map((x) => x.textContent));
  check("right hand: no finding about the left hand is listed", rightTexts.length > 0 && !rightTexts.some((t) => /vänster|left/i.test(t)), `n=${rightTexts.length}`);
  await page.click("#bm-back");
  await page.click('.bm .part[data-region="hand"][data-side="left"] path >> nth=0');
  await page.waitForSelector(".mapitem", { timeout: 60000 });
  const leftTexts = await page.$$eval(".mapitem span:first-child", (n) => n.map((x) => x.textContent));
  check("left hand: no finding about the right hand is listed", leftTexts.length > 0 && !leftTexts.some((t) => /höger|right/i.test(t)), `n=${leftTexts.length}`);
  await page.click("#bm-back");
  await page.click('.segbtn:has-text("Bak")');
  await page.click('.bm .part[data-region="back"] path >> nth=0');
  await page.waitForSelector(".mapitem", { timeout: 60000 });
  check("back view lists back findings", (await page.$$eval(".mapitem", (n) => n.length)) > 0);
  await page.screenshot({ path: path.join(out, "11-map-back.png"), fullPage: true });
  await page.click(".loc button");
  await page.click("#bm-back"); // the back opened its close-up
  await page.click('.segbtn:has-text("Fram")');

  // 6b2. personal data guard: a text with an identity number is refused and no request carries it
  const leaked = [];
  page.on("request", (r) => { if (/121212/.test(decodeURIComponent(r.url()))) leaked.push(r.url()); });
  await page.fill("#text", "ont i magen 121212-1212");
  await page.click("#go");
  await page.waitForSelector("#cand-error", { timeout: 60000 });
  check("personal data guard: warning shown", /personuppgift/i.test(await page.textContent("#cand-error")));
  check("personal data guard: nothing with the number left the page", leaked.length === 0, leaked.join(" "));

  // 6c. English UI: suggestions, map list and examples are in English
  await page.click('.segbtn:has-text("EN")');
  await page.fill("#text", "ont i magen");
  await page.click("#go");
  await page.waitForFunction(() => window.__penpad.cand && window.__penpad.cand.query === "ont i magen" && window.__penpad.finding, null, { timeout: 60000 });
  const shownNames = await page.$$eval(".cands .cname strong", (n) => n.map((x) => x.textContent));
  const enNames = await page.evaluate(() => window.__penpad.cand.items.filter((i) => i.en).slice(0, 5).map((i) => i.en));
  check("English UI: suggestions are shown in English", shownNames.length > 0 && JSON.stringify(shownNames) === JSON.stringify(enNames), shownNames.join(" | "));
  check("English UI: no Swedish name next to a suggestion", (await page.$$(".cands .alt")).length === 0);
  const chipCount = (await page.$$("#samples .chip")).length;
  const enExamples = await page.evaluate(() => window.__penpad.snap.cfg.examples.filter((e) => e.lang === "en").length);
  check("English UI: only English examples are offered", chipCount === enExamples && chipCount > 0, `chips=${chipCount}`);
  // every English example must lead to a finding (one was found to say "No confident match")
  const failedExamples = [];
  for (let i = 0; i < chipCount; i++) {
    await page.evaluate(() => { window.__penpad.finding = null; });
    const chip = (await page.$$("#samples .chip"))[i];
    const label = await chip.textContent();
    await chip.click();
    try { await page.waitForFunction(() => window.__penpad.finding, null, { timeout: 60000 }); } catch (_) { failedExamples.push(label); }
  }
  check("English UI: every example gives a finding", failedExamples.length === 0, failedExamples.join(" | "));
  await page.click('.bm .part[data-region="knee"][data-side="right"] path >> nth=0');
  await page.waitForSelector(".mapitem", { timeout: 60000 });
  const mapNames = await page.$$eval(".mapitem span:first-child", (n) => n.map((x) => x.textContent));
  const mapEn = await page.evaluate(() => window.__penpad.map.sel && window.__penpad.snap.bodymap.findings[window.__penpad.map.sel.region].map((c) => window.__penpad.known.get(c)).filter((u) => u && u[1]).map((u) => u[1]));
  check("English UI: the map list is in English", mapNames.length > 0 && mapNames.every((n) => mapEn.includes(n)), `n=${mapNames.length}`);
  await page.click(".loc button");
  await page.click('.segbtn:has-text("SV")');

  // 6d. close-ups: head and neck cross-section, leg, back (the hand close-up is checked earlier)
  if (await page.$("#bm-back")) await page.click("#bm-back");
  const partsOf = () => page.$$eval(".bm .part", (n) => n.map((x) => x.dataset.region + ":" + x.dataset.side));
  await page.click('.bm .part[data-region="head"] path >> nth=0');
  const headParts = (await partsOf()).map((x) => x.split(":")[0]);
  check("head close-up: cross-section with nose, mouth, teeth, tongue, throat and larynx", ["head", "nose", "mouth", "teeth", "tongue", "throat", "larynx"].every((r) => headParts.includes(r)), headParts.join(","));
  await page.click('.bm .part[data-region="tongue"] path >> nth=0');
  await page.waitForSelector(".mapitem", { timeout: 60000 });
  const tongueN = (await page.$$(".mapitem")).length;
  check("tongue in the cross-section lists findings", tongueN > 0, `n=${tongueN}`);
  await page.click("#bm-back");
  await page.click('.bm .part[data-region="thigh"][data-side="left"] path >> nth=0');
  const legParts = await partsOf();
  check("leg close-up: thigh, knee, lower leg, ankle and foot, all on the left", legParts.length === 5 && legParts.every((x) => x.endsWith(":left")), legParts.join(","));
  await page.waitForSelector(".mapitem", { timeout: 60000 });
  await page.click("#bm-back");
  await page.click('.segbtn:has-text("Bak")');
  await page.click('.bm .part[data-region="buttock"][data-side="left"] path >> nth=0');
  const backParts = (await partsOf()).map((x) => x.split(":")[0]);
  check("back close-up: back and buttock", backParts.includes("back") && backParts.includes("buttock"), backParts.join(","));
  await page.click("#bm-back");
  await page.click('.segbtn:has-text("Fram")');
  await page.click(".loc button").catch(() => {});

  // 6e. the aspect of a site (the body's counterpart of a tooth surface): chosen next to the map, and read from typed text
  await page.click('.bm .part[data-region="knee"][data-side="right"] path >> nth=0');
  await page.click('[data-aspect="255561001"]');
  await page.waitForSelector(".mapitem", { timeout: 60000 });
  await page.click(".mapitem >> nth=0");
  await page.waitForFunction(() => window.__penpad.finding && window.__penpad.finding.site, null, { timeout: 60000 });
  check("aspect chosen next to the map becomes the aspect of the finding", (await page.evaluate(() => window.__penpad.values.aspect)) === "255561001");
  check("the form shows the aspect slot", (await page.$$('[data-slot="aspect"]')).length === 1);
  await page.click("#bm-back");
  await page.click(".loc button").catch(() => {});
  await page.fill("#text", "smärta i höger knä, lateral");
  await page.click("#go");
  await page.waitForFunction(() => window.__penpad.cand && window.__penpad.cand.query === "smärta i knä" && window.__penpad.finding, null, { timeout: 60000 });
  check("typed 'lateral' fills the aspect", (await page.evaluate(() => window.__penpad.values.aspect)) === "49370004");

  // 6f. several findings after a fall: forearm, hand and head go into one list; outputs cover the whole list
  if (await page.$("#bm-back")) await page.click("#bm-back");
  await page.click(".loc button").catch(() => {});
  const addFromMap = async (selector) => {
    await page.click(selector);
    await page.waitForSelector(".mapitem", { timeout: 60000 });
    await page.click(".mapitem >> nth=0");
    await page.waitForFunction(() => window.__penpad.finding, null, { timeout: 60000 });
    await page.click("#add");
  };
  await addFromMap('.bm .part[data-region="forearm"][data-side="right"] path >> nth=0');
  await addFromMap('.bm .part[data-region="hand"][data-side="right"] path >> nth=0');
  await addFromMap('.bm .part[data-region="head"] path >> nth=0');
  check("list holds three findings", (await page.evaluate(() => window.__penpad.chart.length)) === 3 && (await page.$$(".chartlist li")).length === 3);
  check("the body marks the findings in the list", (await page.$$(".bm .part.ch")).length >= 2, `n=${(await page.$$(".bm .part.ch")).length}`);
  await page.click('.tab:has-text("FHIR")');
  const bundle = await page.textContent("pre.out");
  check("FHIR output for the list is a Bundle of three Conditions", /"resourceType": "Bundle"/.test(bundle) && (bundle.match(/"resourceType": "Condition"/g) || []).length === 3);
  await page.click('.tab:has-text("openEHR")');
  const comp = JSON.parse(await page.textContent("pre.out"));
  check("openEHR output for the list has one observation per finding", comp.content.length === 3 && comp.content.every((x) => x._type === "OBSERVATION"));
  await page.click('[data-edit="0"]');
  check("editing a listed finding opens it again", (await page.textContent("#add")).length > 0 && (await page.evaluate(() => window.__penpad.editing)) === 0);
  await page.click("#add");
  check("updating keeps three findings", (await page.evaluate(() => window.__penpad.chart.length)) === 3);
  await page.click('[data-remove="2"]');
  check("removing a listed finding", (await page.evaluate(() => window.__penpad.chart.length)) === 2);
  await page.click("#clear-list");
  check("clearing the list", (await page.evaluate(() => window.__penpad.chart.length)) === 0 && (await page.$$(".chartlist li")).length === 0);

  // 6g. several body parts in one sentence: each part is checked against its own body part and keeps its own values
  await page.fill("#text", "ont i höger arm och vänster hand, huvudet sedan igår");
  await page.click("#go");
  await page.waitForFunction(() => window.__penpad.multi && window.__penpad.multi.items.length === 3 && window.__penpad.multi.items.every((i) => i.status !== "resolving"), null, { timeout: 90000 });
  const mi = await page.evaluate(() => window.__penpad.multi.items.map((i) => ({ status: i.status, lat: i.entry && i.entry.values.laterality, site: i.entry && i.entry.finding.site && i.entry.finding.site.en, dur: i.entry && i.entry.duration && i.entry.duration.n })));
  check("one sentence, three body parts: every proposal is found", mi.length === 3 && mi.every((x) => x.status === "ok"), JSON.stringify(mi));
  check("each body part keeps its own side", mi[0].lat === "24028007" && mi[1].lat === "7771000" && !mi[2].lat, JSON.stringify(mi.map((x) => x.lat)));
  check("each finding's site is inside its own body part", /arm|elbow|upper limb/i.test(mi[0].site) && /hand/i.test(mi[1].site) && /head/i.test(mi[2].site), mi.map((x) => x.site).join(" | "));
  check("a time word said once is shared", mi.every((x) => x.dur === 1));
  await page.click("#add-all");
  check("add all puts the three findings in the list", (await page.evaluate(() => window.__penpad.chart.length)) === 3 && !(await page.$("#multi-note")));
  await page.click("#clear-list");
  // one typed finding that names a body part: its site must be inside that body part
  await page.fill("#text", "ont i handen");
  await page.click("#go");
  await page.waitForFunction(() => window.__penpad.cand && window.__penpad.cand.part && window.__penpad.finding, null, { timeout: 90000 });
  const handSite = await page.evaluate(() => window.__penpad.finding.site && window.__penpad.finding.site.en);
  check("'ont i handen' finds a finding whose site is in the hand", /hand/i.test(handSite || ""), String(handSite));

  // 6h. English regression table: typed English phrases must give the right finding, side, severity and time
  await page.click('.segbtn:has-text("EN")');
  const enTable = [
    ["my left thumb hurts since yesterday", { finding: "Pain in thumb", lat: "7771000", days: 1 }],
    ["severe headache for three days, throbbing", { finding: "Headache", sev: "24484000", days: 3 }],
    ["stomach ache", { finding: "Stomach ache" }],
    ["pain in the right knee for 2 weeks, mild", { finding: "Pain of knee region", lat: "24028007", sev: "255604002" }],
    ["swollen right ankle, firm, since last week", { finding: "Swollen ankle region", lat: "24028007", days: 7 }],
    ["pain in the medial side of the left knee", { finding: "Pain of knee region", lat: "7771000", aspect: "255561001" }],
  ];
  const enFail = [];
  // the local snapshot holds only the main name of each concept (no synonyms), so three of these phrases need the live terminology server
  const needsSynonyms = new Set(["stomach ache", "pain in the right knee for 2 weeks, mild", "pain in the medial side of the left knee"]);
  const isClient = (await page.evaluate(() => window.__penpad.source)) === "client";
  for (const [text, want] of enTable) {
    if (!isClient && needsSynonyms.has(text)) continue;
    await page.fill("#text", text);
    await page.click("#go");
    try { await page.waitForFunction((w) => window.__penpad.finding && window.__penpad.finding.en === w && window.__penpad.cand && window.__penpad.cand.query, want.finding, { timeout: 60000 }); }
    catch (_) { enFail.push(`${text} -> ${await page.evaluate(() => window.__penpad.finding && window.__penpad.finding.en)}`); continue; }
    await page.waitForTimeout(300);
    const got = await page.evaluate(() => ({ ...window.__penpad.values, days: window.__penpad.duration && window.__penpad.duration.n }));
    for (const [k, v] of Object.entries({ laterality: want.lat, severity: want.sev, aspect: want.aspect, days: want.days })) if (v !== undefined && got[k] !== v) enFail.push(`${text}: ${k} ${got[k]} != ${v}`);
  }
  check("English phrases give the right finding, side, severity, aspect and time", enFail.length === 0, enFail.join(" | "));
  await page.fill("#text", "pain in the left arm and right leg");
  await page.click("#go");
  await page.waitForFunction(() => window.__penpad.multi && window.__penpad.multi.items.length === 2 && window.__penpad.multi.items.every((i) => i.status !== "resolving"), null, { timeout: 90000 });
  const enMulti = await page.evaluate(() => window.__penpad.multi.items.map((i) => ({ status: i.status, f: i.entry && i.entry.finding.en, lat: i.entry && i.entry.values.laterality })));
  check("English: left arm and right leg are two findings, each in its own limb", enMulti.every((x) => x.status === "ok") && /left arm|upper arm|arm/i.test(enMulti[0].f) && /lower limb|leg/i.test(enMulti[1].f) && enMulti[1].lat === "24028007", JSON.stringify(enMulti));
  await page.click('.segbtn:has-text("SV")');
  await page.fill("#text", "");

  // 7. another sample: swelling of the right foot (hard)
  await page.click('.chip:has-text("svullen höger fot")');
  await page.waitForFunction(() => window.__penpad.finding && window.__penpad.finding.topic === "swelling", null, { timeout: 60000 });
  sentence = await page.textContent("#sentence");
  check("swelling sample", /fot, höger, sedan 1 vecka\. Hård/i.test(sentence), sentence);

  // 8. low-confidence input shows a warning and a manual path
  await page.fill("#text", "qqzzxx");
  await page.click("#go");
  await page.waitForSelector(".warn");
  const warn = await page.textContent(".warn");
  const hasManual = (await page.$$("#manual")).length === 1;
  check("low confidence warning and manual search", /säkerhet|träff/i.test(warn) && hasManual, warn);
  await page.screenshot({ path: path.join(out, "06-low-confidence.png"), fullPage: true });

  // 9. free text typed by the user
  await page.fill("#text", "pain in the right knee for 3 weeks, severe, intermittent");
  await page.click("#go");
  await page.waitForFunction(() => window.__penpad.finding, null, { timeout: 60000 });
  const f = await page.evaluate(() => ({ code: window.__penpad.finding.code, vals: window.__penpad.values, dur: window.__penpad.duration }));
  console.log("typed finding:", JSON.stringify(f));
  if ((await page.evaluate(() => window.__penpad.source)) === "client")
    check("English knee pain: the general concept is first, not a narrower one", (await page.evaluate(() => window.__penpad.cand.items[0].en)) === "Pain of knee region");
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
  const unexpected404 = missing.filter((u) => !u.endsWith("/api/health") && !u.endsWith("/data/snapshot.json"));
  const realErrors = errors.filter((e) => !/404/.test(e) || unexpected404.length);
  check("no console errors (the /api/health probe may 404 without a backend)", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  await browser.close();
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
