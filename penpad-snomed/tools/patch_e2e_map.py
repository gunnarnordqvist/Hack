"""One-off helper: insert the body map checks into tests/e2e.cjs (idempotent)."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "tests" / "e2e.cjs"
s = p.read_text(encoding="utf8")
if "6b. body map" in s:
    raise SystemExit("already patched")
marker = "  // 7. another sample: swelling of the right foot (hard)"
block = '''  // 6b. body map
  check("body map is drawn (front view)", (await page.$$(".bm .part")).length > 20);
  const hl = await page.$$eval(".bm .part.hl", (n) => n.map((x) => x.dataset.region + ":" + x.dataset.side));
  check("selected finding is highlighted on the left hand (thumb falls back to hand)", hl.length === 1 && hl[0] === "hand:left", hl.join(","));
  await page.screenshot({ path: path.join(out, "08-map-highlight.png"), fullPage: true });
  await page.click('.bm .part[data-region="knee"][data-side="right"]');
  const kneeItems = await page.$$eval(".mapitem", (n) => n.length);
  check("clicking the right knee lists findings", kneeItems > 0, `items=${kneeItems}`);
  await page.click(".mapitem >> nth=0");
  await page.waitForFunction(() => window.__penpad.finding && window.__penpad.finding.site && /knä|knee/i.test(window.__penpad.finding.site.sv + window.__penpad.finding.site.en));
  const lat = await page.evaluate(() => window.__penpad.values.laterality);
  check("side from the map becomes laterality (right)", lat === "24028007", String(lat));
  check("tag says it came from the body map", (await page.textContent('[data-slot="laterality"] .tag')).includes("kroppskartan"));
  await page.screenshot({ path: path.join(out, "09-map-knee.png"), fullPage: true });
  await page.click('.bm .part[data-region="hand"][data-side="left"]');
  await page.waitForSelector('.bm .part[data-region="thumb"]');
  check("hand zoom shows thumb and fingers", (await page.$$('.bm .part[data-region="fingers"]')).length === 4);
  await page.screenshot({ path: path.join(out, "10-map-hand-zoom.png"), fullPage: true });
  await page.click('.bm .part[data-region="thumb"]');
  await page.waitForSelector('.mapitem[data-code="300955002"]');
  await page.click('.mapitem[data-code="300955002"]');
  await page.waitForFunction(() => window.__penpad.finding && window.__penpad.finding.code === "300955002");
  check("thumb pain via the map, left side prefilled", (await page.evaluate(() => window.__penpad.values.laterality)) === "7771000");
  await page.click("#bm-back");
  await page.click('.segbtn:has-text("Bak")');
  await page.click('.bm .part[data-region="back"]');
  check("back view lists back findings", (await page.$$eval(".mapitem", (n) => n.length)) > 0);
  await page.screenshot({ path: path.join(out, "11-map-back.png"), fullPage: true });
  await page.click(".loc button");
  await page.click('.segbtn:has-text("Fram")');

'''
assert marker in s
p.write_text(s.replace(marker, block + marker), encoding="utf8")
print("patched", p)
