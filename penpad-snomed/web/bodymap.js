// Body map: front and back figure plus a hand close-up, in the spirit of the 1990s PEN&PAD / Clinergy body-system maps.
// The figure's path data comes from the MIT-licensed react-body-map (see vendor/bodypaths.js and THIRD_PARTY_NOTICES.md);
// nothing here is from the Clinergy demo. Region ids and the SNOMED CT meaning of each region are ours.
//
// A click gives {region, side}. Regions are body structures; which findings belong to a region is decided by the
// SNOMED CT hierarchy, not by the drawing. Sides are the PATIENT's side: in the front view the patient's right is on the
// viewer's left, in the back view the other way round.

import { BODY } from "./vendor/bodypaths.js";
import { ZOOM_BOXES } from "./zoomboxes.js";
import { HEAD_SECTION } from "./headsection.js";

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v);
  for (const kid of kids.flat()) if (kid) e.append(kid);
  return e;
}

// Close-ups. "hand" is also the region id; the others are views of several regions.
const LEG = ["thigh", "knee", "lowerleg", "ankle", "foot"];
const BACKZ = ["neck", "back", "shoulder", "hip", "buttock"];
/** The close-up that opens when a region is clicked in the whole-body figure. */
export const ZOOM_OF = {
  hand: "hand", thigh: "leg", knee: "leg", lowerleg: "leg", ankle: "leg", foot: "leg",
  head: "headsection", neck: "headsection", back: "backzoom", buttock: "backzoom", hip: "backzoom",
};
export const ZOOM_VIEWS = ["hand", "leg", "headsection", "backzoom"];
export const isZoomView = (v) => ZOOM_VIEWS.includes(v);

/** Pure description of what is drawn: {box, outline, anchors, shapes:[{region, side, paths}], leaders, fontScale}. */
export function shapesFor(view, side) {
  const s = side === "left" ? "left" : "right";
  if (view === "hand") {
    const h = BODY.hand[s];
    return {
      box: h.box, outline: [], anchors: h.anchors, fontScale: 0.07,
      shapes: [{ region: "hand", side: s, paths: h.palm }, { region: "thumb", side: s, paths: h.thumb }, { region: "fingers", side: s, paths: h.fingers }],
    };
  }
  if (view === "leg") {
    const z = ZOOM_BOXES.leg[s];
    return { box: z.box.join(" "), outline: [], anchors: z.anchors, fontScale: 0.075, shapes: BODY.front.filter((x) => LEG.includes(x.region) && x.side === s) };
  }
  if (view === "backzoom") {
    const z = ZOOM_BOXES.back;
    return { box: z.box.join(" "), outline: [], anchors: z.anchors, fontScale: 0.04, shapes: BODY.back.filter((x) => BACKZ.includes(x.region)) };
  }
  if (view === "headsection") {
    const z = HEAD_SECTION;
    return { box: z.box, outline: z.outline, anchors: z.anchors, leaders: z.leaders, fontScale: z.fontScale, shapes: z.shapes };
  }
  return { box: BODY.viewBox[view], outline: [BODY.outline[view]], anchors: null, shapes: BODY[view] };
}

// side words in finding names, English and Swedish: a finding that says "left hand" is not an option when the right hand was chosen
const SIDE_WORDS = { left: /(?<![\p{L}])(left|vänster|vänstra)(?![\p{L}])/iu, right: /(?<![\p{L}])(right|höger|högra)(?![\p{L}])/iu };
/** Does any of the names mention the given side ("left" | "right")? */
export function mentionsSide(names, side) {
  const re = SIDE_WORDS[side];
  return !!re && names.some((n) => n && re.test(n));
}

// a region that is not drawn gets its nearest drawn relative highlighted instead
const FALLBACK = { thumb: "hand", fingers: "hand", wrist: "hand", toes: "foot", eye: "head", ear: "head", nose: "head", mouth: "head", throat: "neck", elbow: "upperarm", tongue: "mouth", teeth: "mouth", larynx: "throat", arm: "upperarm", leg: "thigh" };

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
  const { box, outline, shapes, anchors, leaders, fontScale } = shapesFor(state.view, state.side);
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
  // findings already in the list are marked too (the nearest drawn region, like the highlight)
  const marks = (state.chart || []).map((c) => { let r = c.region; while (r && !present.has(r)) r = FALLBACK[r]; return { region: r, side: c.side }; }).filter((c) => c.region);
  for (const s of shapes) {
    const label = state.regionLabel(s.region) + (s.side ? ", " + state.sideLabel(s.side) : "");
    const isSel = state.sel && state.sel.region === s.region && matchSide(state.sel.side, s.side);
    const isHl = state.hl && hlRegion === s.region && matchSide(state.hl.side, s.side);
    const isCh = marks.some((c) => c.region === s.region && matchSide(c.side, s.side));
    const g = el("g", {
      class: "part" + (isSel ? " sel" : "") + (isHl ? " hl" : "") + (isCh ? " ch" : ""), tabindex: "0", role: "button",
      "aria-label": label, "aria-pressed": isSel ? "true" : "false", "data-region": s.region, "data-side": s.side || "",
    }, el("title", {}, label), s.paths.map((d) => el("path", { d })));
    const act = () => on.region(s.region, s.side);
    g.addEventListener("click", act);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
    svg.append(g);
  }
  if (anchors) {
    // close-up: name each part so the picture is readable on its own
    const fs = Number(box.split(" ")[2]) * (fontScale || 0.07);
    for (const l of Object.values(leaders || {})) svg.append(el("line", { class: "leader", x1: l[0], y1: l[1], x2: l[2], y2: l[3] }));
    for (const s of shapes) {
      const at = anchors[`${s.region}:${s.side || ""}`] || anchors[s.region];
      if (!at) continue;
      svg.append(el("text", { class: "lbl", x: at[0], y: at[1], "text-anchor": "middle", "dominant-baseline": "middle",
        style: `font-size:${fs.toFixed(1)}px;stroke-width:${(fs / 4).toFixed(1)}px` }, state.regionLabel(s.region)));
    }
  }
  svgHost.replaceChildren(svg);
}
