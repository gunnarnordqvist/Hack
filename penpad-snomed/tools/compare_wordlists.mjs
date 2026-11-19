// How well does a word list (backend/topics.json, or an older copy of it) read the answers (side, severity, character, onset, pattern, progress,
// consistency) out of the phrases of a gold file?
//   node tools/compare_wordlists.mjs GOLD.json NEW_TOPICS.json [OLD_TOPICS.json]
// Prints precision, recall and F1 over all answers. Gold files hold codes only (tests/fixtures/gold-*.json).
import { readFileSync } from "node:fs";
import { extract } from "../web/extract.js";

const SLOTS = ["laterality", "severity", "character", "onset", "pattern", "progress", "consistency"];
const labels = JSON.parse(readFileSync(new URL("../tests/fixtures/labels.json", import.meta.url), "utf8"));
const [goldFile, ...cfgFiles] = process.argv.slice(2);
const gold = JSON.parse(readFileSync(goldFile, "utf8")).items;

for (const file of cfgFiles) {
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  let tp = 0, fp = 0, fn = 0;
  for (const g of gold) {
    const got = extract(g.text, cfg, labels).values;
    for (const s of SLOTS) {
      const want = g.slots[s], have = got[s];
      if (have !== undefined && have === want) tp++;
      else { if (have !== undefined) fp++; if (want !== undefined) fn++; }
    }
  }
  const p = tp / (tp + fp || 1), r = tp / (tp + fn || 1);
  console.log(`${file.split("/").pop()}: ${gold.length} phrases, precision ${Math.round(100 * p)}, recall ${Math.round(100 * r)}, F1 ${Math.round(100 * 2 * p * r / (p + r || 1))} (tp ${tp}, fp ${fp}, fn ${fn})`);
}
