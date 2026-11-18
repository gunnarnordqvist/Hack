// Save and open the list of findings as a file. The file holds codes and answers only (no names, no SNOMED CT text); names are fetched again
// from the terminology server when a list is opened. Nothing is stored by the page itself: the file is the user's.

export const FORMAT = "penpad-list/1";
const CODE = /^\d{5,18}$/;
export const MAX_ENTRIES = 50;
export const MAX_BYTES = 200_000;

export function serializeList(chart) {
  return JSON.stringify({
    format: FORMAT,
    note: "Codes and answers only, no names. Demo data: made-up examples, not a patient record.",
    entries: chart.map((e) => ({ finding: e.finding.code, topic: e.finding.topic, values: e.values || {}, duration: e.duration || null })),
  }, null, 2);
}

/**
 * Check and read a saved list. Anything unexpected is a problem and the entry is left out: the file is data, not instructions.
 * @returns {{entries: Array<{code, topic, values, duration}>, problems: string[]}}
 */
export function parseList(text, cfg) {
  const out = { entries: [], problems: [] };
  if (typeof text !== "string" || text.length > MAX_BYTES) { out.problems.push("the file is too large"); return out; }
  let j;
  try { j = JSON.parse(text); } catch (_) { out.problems.push("not a JSON file"); return out; }
  if (!j || j.format !== FORMAT || !Array.isArray(j.entries)) { out.problems.push("not a saved list from this page"); return out; }
  const topics = new Set(cfg.topics.map((t) => t.id));
  const units = new Set(cfg.units.map((u) => u.key));
  j.entries.slice(0, MAX_ENTRIES).forEach((e, i) => {
    const bad = (why) => out.problems.push(`entry ${i + 1}: ${why}`);
    if (!e || typeof e !== "object") return bad("not an object");
    if (!CODE.test(String(e.finding))) return bad("no valid finding code");
    if (!topics.has(e.topic)) return bad("unknown topic");
    const values = {};
    for (const [slot, c] of Object.entries(e.values && typeof e.values === "object" ? e.values : {})) {
      if (!cfg.slots[slot] || slot === "duration" || !CODE.test(String(c))) return bad(`invalid answer for ${slot}`);
      values[slot] = String(c);
    }
    let duration = null;
    if (e.duration != null) {
      const d = e.duration;
      if (!d || !Number.isInteger(d.n) || d.n < 1 || d.n > 10000 || !units.has(d.unit)) return bad("invalid duration");
      duration = { n: d.n, unit: d.unit };
    }
    out.entries.push({ code: String(e.finding), topic: e.topic, values, duration });
  });
  if (j.entries.length > MAX_ENTRIES) out.problems.push(`only the first ${MAX_ENTRIES} entries were read`);
  return out;
}
