import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
export const cfg = JSON.parse(readFileSync(join(here, "../backend/topics.json"), "utf8"));
export const labels = JSON.parse(readFileSync(join(here, "fixtures/labels.json"), "utf8"));
export const ctx = { cfg, labels };
export const thumbState = (over = {}) => ({
  lang: "sv", mode: "clinician",
  finding: { code: "300955002", en: "thumb ache", sv: "tumvärk", topic: "pain",
    site: { code: "76505004", en: "thumb", sv: "tumme", lateralizable: true } },
  values: { laterality: "7771000", character: "29695002", severity: "6736007", onset: "385315009", progress: "231877006" },
  duration: { n: 2, unit: "day" },
  ...over,
});
