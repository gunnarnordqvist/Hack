// Measure bounding boxes of SVG paths with a real browser: node tools/bbox_parts.cjs parts.json bboxes.json
// parts.json: {front:[{slug,paths}], back:[...]} -> bboxes.json: {front:{slug:[{x,y,w,h}...]}, back:{...}}
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const parts = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1448 1448' width='100' height='100'></svg>");
  const out = await page.evaluate((parts) => {
    const svg = document.querySelector("svg");
    const res = {};
    for (const view of ["front", "back"]) {
      res[view] = {};
      for (const p of parts[view]) {
        res[view][p.slug] = p.paths.map((d) => {
          const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
          el.setAttribute("d", d);
          svg.appendChild(el);
          const b = el.getBBox();
          svg.removeChild(el);
          return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
        });
      }
    }
    return res;
  }, parts);
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
  await browser.close();
})();
