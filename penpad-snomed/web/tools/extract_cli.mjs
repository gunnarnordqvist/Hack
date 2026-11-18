// stdin: JSON array of texts. stdout: JSON array of extract() results. Used by the snapshot builder so that
// the samples go through exactly the same free-text reader as the browser.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extract } from "../extract.js";
const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, "../../backend/topics.json"), "utf8"));
const labels = JSON.parse(readFileSync(process.argv[2], "utf8"));
const texts = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(texts.map((t) => extract(t, cfg, labels))));
