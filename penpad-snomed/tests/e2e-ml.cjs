// Browser test of the optional local models (semantic search and speech) on the page:  node tests/e2e-ml.cjs <url>
// Heavy: downloads about 300 MB of models through the browser, so it is run by hand, not in CI. The microphone is a file
// (tests/fixtures/voice-sv.wav: synthetic speech saying "ont i magen, kommer och går"), fed to Chromium as a fake capture device.
const { chromium } = require("playwright");
const path = require("path");
const url = process.argv[2];
if (!url) { console.error("usage: node tests/e2e-ml.cjs <url>"); process.exit(2); }
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`); ok ? pass++ : fail++; };

(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const wav = path.join(__dirname, "fixtures", "voice-sv.wav");
  const browser = await chromium.launch({ ...(proxy ? { proxy } : {}), args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: !!proxy, permissions: ["microphone"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const hosts = new Map(); // host -> urls
  const record = (u) => { try { const x = new URL(u); if (x.protocol.startsWith("http")) hosts.set(x.host, [...(hosts.get(x.host) || []), u]); } catch (_) { /* data: and blob: urls */ } };
  const bodies = []; // what was sent to hosts other than the site and the terminology server
  ctx.on("request", (r) => { record(r.url()); try { const h = new URL(r.url()).host; if (h !== new URL(url).host && h !== "tx-nordics.fhir.org") bodies.push((r.postData() || "") + " " + JSON.stringify(r.headers())); } catch (_) { /* not http */ } });
  await page.goto(url, { waitUntil: "networkidle" });
  const site = new URL(url).host;

  // 1. nothing is loaded from a model host before the visitor opts in
  check("no model or library host is contacted before opting in", [...hosts.keys()].every((h) => h === site || h === "tx-nordics.fhir.org"), [...hosts.keys()].join(", "));

  // 1b. a tab that the browser closed during a heavy step: simulate it (the flag and the saved text and list are in the tab's session storage)
  await page.evaluate(async () => {
    const { serializeList } = await import("./listio.js");
    const entry = { finding: { code: "25064002", topic: "pain", site: null }, values: { severity: "24484000" }, duration: null };
    sessionStorage.setItem("penpad-ml-running", "asr");
    sessionStorage.setItem("penpad-ml-saved", JSON.stringify({ text: "ont i magen sedan igår", list: serializeList([entry]) }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !window.__penpad.busy && window.__penpad.chart.length === 1, null, { timeout: 60000 }).catch(() => {});
  const rec = await page.evaluate(() => ({ crashed: window.__penpad.ml.crashed, text: document.querySelector("#text").value, list: window.__penpad.chart.length, mic: document.querySelector("#mic") && document.querySelector("#mic").disabled, flag: sessionStorage.getItem("penpad-ml-running"), note: !!document.querySelector("#crash-note") }));
  check("after a closed tab the text and the list are back and the speech button is off", rec.crashed === "asr" && /magen/.test(rec.text) && rec.list === 1 && rec.mic === true && rec.flag === null && rec.note, JSON.stringify(rec));
  await page.click("#retry-anyway");
  check("'try anyway' turns the speech button on again", (await page.evaluate(() => document.querySelector("#mic").disabled)) === false);
  await page.evaluate(() => { document.querySelector("#clear-list") && document.querySelector("#clear-list").click(); });

  // 2. without the model, a paraphrase finds nothing useful
  const HEAD = "25064002"; // headache
  const search = async (text) => {
    await page.evaluate(() => { window.__penpad.cand = null; window.__penpad.finding = null; });
    await page.fill("#text", text);
    await page.click("#go");
    await page.waitForFunction(() => !window.__penpad.busy && (window.__penpad.cand || window.__penpad.multi), null, { timeout: 90000 });
    return page.evaluate(() => ({ codes: window.__penpad.cand.items.slice(0, 5).map((i) => i.code), low: window.__penpad.cand.low_confidence, finding: window.__penpad.finding && window.__penpad.finding.code }));
  };
  const before = await search("jätteont i huvudet");
  check("without the model 'jätteont i huvudet' does not find headache", !before.codes.includes(HEAD), before.codes.join(","));

  // 3. turn on semantic search
  await page.evaluate(() => { document.querySelector("#ml").open = true; });
  await page.click("#sem-on");
  await page.waitForFunction(() => ["ready", "error"].includes(window.__penpad.ml.sem), null, { timeout: 600000 });
  const sem = await page.evaluate(() => ({ s: window.__penpad.ml.sem, msg: window.__penpad.ml.semMsg, info: window.__penpad.ml.info }));
  check("semantic search becomes ready and covers every finding", sem.s === "ready" && sem.info.concepts > 2000, JSON.stringify(sem));
  const after = await search("jätteont i huvudet");
  check("with the model 'jätteont i huvudet' has headache among the first five", after.codes.includes(HEAD), after.codes.join(","));
  check("a suggestion found by meaning shows its similarity", /emb 0\.\d+/.test(await page.textContent("#cands")));
  const exact = await search("huvudvärk");
  check("a plain word match is still picked first", exact.finding === HEAD, String(exact.finding));

  // 4. speech: the fake microphone plays the recording
  await page.evaluate(() => { window.__penpad.cand = null; window.__penpad.finding = null; window.__penpad.text = ""; });
  await page.click("#mic");
  await page.waitForFunction(() => window.__penpad.ml.mic === "recording", null, { timeout: 20000 });
  await page.waitForTimeout(4500);
  await page.click("#mic");
  await page.waitForFunction(() => ["idle", "error"].includes(window.__penpad.ml.mic), null, { timeout: 600000 });
  const mic = await page.evaluate(() => ({ state: window.__penpad.ml.mic, msg: window.__penpad.ml.micMsg, text: window.__penpad.text }));
  check("speech is turned into text in the browser", mic.state === "idle" && /magen/i.test(mic.text), JSON.stringify(mic));
  await page.waitForFunction(() => !window.__penpad.busy && window.__penpad.cand, null, { timeout: 90000 }).catch(() => {});
  const spoken = await page.evaluate(() => ({ f: window.__penpad.finding && window.__penpad.finding.code, v: window.__penpad.values, box: document.querySelector("#text").value }));
  check("the spoken phrase leads to the stomach ache finding with its pattern", spoken.f === "271681002" && spoken.v.pattern === "7087005", JSON.stringify(spoken));
  check("the transcript is in the text box for the user to check", /magen/i.test(spoken.box));

  // 5. where did requests go, and did any carry what was typed or said?
  const allowed = (h) => h === site || h === "tx-nordics.fhir.org" || h === "cdn.jsdelivr.net" || h === "huggingface.co" || h.endsWith(".huggingface.co") || h.endsWith(".hf.co");
  const others = [...hosts.keys()].filter((h) => !allowed(h));
  check("requests go only to the site, the terminology server, jsDelivr and Hugging Face", others.length === 0, others.join(", "));
  const modelUrls = [...hosts.entries()].filter(([h]) => h !== site && h !== "tx-nordics.fhir.org").flatMap(([, u]) => u);
  const leaks = [...modelUrls.map((u) => decodeURIComponent(u)), ...bodies].filter((u) => /huvud|magen|j%C3%A4tte|jätte/i.test(u));
  check("no request to a model or library host carries the text (addresses, headers and bodies)", leaks.length === 0 && modelUrls.length > 0, `${modelUrls.length} requests`);
  // a double click on the microphone must not start two recorders
  await page.evaluate(() => { document.querySelector("#mic").click(); document.querySelector("#mic").click(); });
  await page.waitForFunction(() => window.__penpad.ml.mic === "recording", null, { timeout: 20000 });
  await page.click("#ml summary"); // closing the panel stops the recording
  const stopped = await page.waitForFunction(() => window.__penpad.ml.mic === "idle", null, { timeout: 5000 }).then(() => true, () => false); // the toggle event comes a moment later
  check("a double click starts one recording, and closing the panel stops it", stopped);
  check("no page errors", errors.length === 0, errors.join(" | "));

  await browser.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})();
