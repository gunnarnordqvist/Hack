// Body map: front and back figure plus a hand close-up, in the spirit of the 1990s PEN&PAD / Clinergy body-system maps.
// The figure's path data comes from the MIT-licensed react-body-map (see vendor/bodypaths.js and THIRD_PARTY_NOTICES.md);
// nothing here is from the Clinergy demo. Region ids and the SNOMED CT meaning of each region are ours.
//
// A click gives {region, side}. Regions are body structures; which findings belong to a region is decided by the
// SNOMED CT hierarchy, not by the drawing. Sides are the PATIENT's side: in the front view the patient's right is on the
// viewer's left, in the back view the other way round.

import { BODY } from "./vendor/bodypaths.js";

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v);
  for (const kid of kids.flat()) if (kid) e.append(kid);
  return e;
}

/** Pure description of what is drawn: [{region, side, paths:[d,...]}] and the viewBox. */
export function shapesFor(view, side) {
  if (view === "hand") {
    const h = BODY.hand[side === "left" ? "left" : "right"];
    const s = side === "left" ? "left" : "right";
    return {
      box: h.box, outline: [], anchors: h.anchors,
      shapes: [{ region: "hand", side: s, paths: h.palm }, { region: "thumb", side: s, paths: h.thumb }, { region: "fingers", side: s, paths: h.fingers }],
    };
  }
  return { box: BODY.viewBox[view], outline: [BODY.outline[view]], anchors: null, shapes: BODY[view] };
}

export const ZOOMABLE = new Set(["hand"]);
// a region that is not drawn gets its nearest drawn relative highlighted instead
const FALLBACK = { thumb: "hand", fingers: "hand", wrist: "hand", toes: "foot", eye: "head", ear: "head", nose: "head", mouth: "head", throat: "neck", elbow: "upperarm" };

export function drawnIn(view, region, side) {
  return shapesFor(view, side).shapes.some((s) => s.region === region);
}

/** Which main view (front/back) draws this region (or its nearest drawn relative)? Prefers `current`. */
export function mainViewFor(region, current) {
  let r = region;
  for (let i = 0; i < 3 && r; i++) {
    for (const v of [current, current === "front" ? "back" : "front"]) if (drawnIn(v, r)) return { view: v, region: r };
    r = FALLBACK[r];
  }
  return null;
}

const SIDE_CODE = { "7771000": "left", "24028007": "right" };
export const sideOfCode = (c) => SIDE_CODE[c] || null;

/**
 * Draw the map into `svgHost`.
 * state: {view, side (for the hand close-up), sel:{region,side}|null, hl:{region,side}|null, regionLabel(r), sideLabel(s)}
 * on: {region(region, side)}
 */
export function drawBodyMap(svgHost, state, on) {
  const { box, outline, shapes, anchors } = shapesFor(state.view, state.side);
  const svg = el("svg", { class: "bm", viewBox: box, role: "group", "aria-label": "body map", preserveAspectRatio: "xMidYMid meet" });
  for (const d of outline) svg.append(el("path", { class: "outline", d }));
  const present = new Set(shapes.map((s) => s.region));
  let hlRegion = null;
  if (state.hl) {
    let r = state.hl.region;
    while (r && !present.has(r)) r = FALLBACK[r];
    hlRegion = r;
  }
  const matchSide = (want, have) => !want || !have || want === have;
  for (const s of shapes) {
    const label = state.regionLabel(s.region) + (s.side ? ", " + state.sideLabel(s.side) : "");
    const isSel = state.sel && state.sel.region === s.region && matchSide(state.sel.side, s.side);
    const isHl = state.hl && hlRegion === s.region && matchSide(state.hl.side, s.side);
    const g = el("g", {
      class: "part" + (isSel ? " sel" : "") + (isHl ? " hl" : ""), tabindex: "0", role: "button",
      "aria-label": label, "aria-pressed": isSel ? "true" : "false", "data-region": s.region, "data-side": s.side || "",
    }, el("title", {}, label), s.paths.map((d) => el("path", { d })));
    const act = () => on.region(s.region, s.side);
    g.addEventListener("click", act);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
    svg.append(g);
  }
  if (anchors) {
    // close-up: name each part so the picture is readable on its own
    const fs = Number(box.split(" ")[2]) * 0.07; // scale the type to the close-up
    for (const s of shapes) {
      svg.append(el("text", { class: "lbl", x: anchors[s.region][0], y: anchors[s.region][1], "text-anchor": "middle", "dominant-baseline": "middle",
        style: `font-size:${fs.toFixed(1)}px;stroke-width:${(fs / 4).toFixed(1)}px` }, state.regionLabel(s.region)));
    }
  }
  svgHost.replaceChildren(svg);
}
