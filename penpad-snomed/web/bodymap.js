// Body map: our own schematic figure (front, back) with close-ups of hand, foot and head, in the spirit of the
// 1990s PEN&PAD / Clinergy body-system maps. The drawing is original; it contains nothing from the Clinergy demo.
//
// A click gives {region, side}. Regions are body structures; which findings belong to a region is decided by the
// SNOMED CT hierarchy (see snapshot.bodymap). Sides are the PATIENT's side: in the front view the patient's right
// is on the viewer's left, in the back view it is the other way round.

const NS = "http://www.w3.org/2000/svg";
const W = 220;
const mx = (x) => W - x;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v);
  for (const kid of kids.flat()) if (kid) e.append(kid);
  return e;
}

// ---- shapes: each returns {region, side, parts:[svg elements]} ------------------------------------------------
const limb = (x1, y1, x2, y2, w) => [
  el("line", { class: "ol", x1, y1, x2, y2, "stroke-width": w + 2.6, "stroke-linecap": "round" }),
  el("line", { class: "lf", x1, y1, x2, y2, "stroke-width": w, "stroke-linecap": "round" }),
];
const blob = (tag, attrs) => [el(tag, { class: "fill", ...attrs })];

function sideX(viewSide, x) { return viewSide === "viewerLeft" ? x : mx(x); }

/** Shapes for the front/back figure. `back` flips which viewer side is the patient's left. */
function figure(back) {
  const sides = back ? { viewerLeft: "left", viewerRight: "right" } : { viewerLeft: "right", viewerRight: "left" };
  const out = [];
  for (const vs of ["viewerLeft", "viewerRight"]) {
    const side = sides[vs];
    const X = (x) => sideX(vs, x);
    out.push({ region: "thigh", side, parts: limb(X(92), 246, X(88), 322, 30) });
    out.push({ region: "knee", side, parts: blob("circle", { cx: X(88), cy: 334, r: 14 }) });
    out.push({ region: "lowerleg", side, parts: limb(X(88), 350, X(86), 412, 22) });
    out.push({ region: "ankle", side, parts: blob("circle", { cx: X(86), cy: 424, r: 9 }) });
    out.push({ region: "foot", side, parts: blob("ellipse", { cx: X(vs === "viewerLeft" ? 80 : 80), cy: 446, rx: 20, ry: 10 }) });
    out.push({ region: "upperarm", side, parts: limb(X(56), 110, X(44), 166, 20) });
    out.push({ region: "elbow", side, parts: blob("circle", { cx: X(43), cy: 175, r: 11 }) });
    out.push({ region: "forearm", side, parts: limb(X(42), 186, X(34), 232, 17) });
    out.push({ region: "hand", side, parts: blob("ellipse", { cx: X(31), cy: 249, rx: 11, ry: 16 }) });
    out.push({ region: "shoulder", side, parts: blob("circle", { cx: X(62), cy: 97, r: 15 }) });
  }
  if (back) {
    out.push({ region: "back", side: null, parts: blob("path", { d: "M70 90 Q110 82 150 90 L146 202 L74 202 Z" }) });
    out.push({ region: "buttock", side: "right", parts: blob("ellipse", { cx: 92, cy: 232, rx: 21, ry: 24 }) });
    out.push({ region: "buttock", side: "left", parts: blob("ellipse", { cx: 128, cy: 232, rx: 21, ry: 24 }) });
  } else {
    out.push({ region: "chest", side: null, parts: blob("path", { d: "M70 90 Q110 82 150 90 L146 154 L74 154 Z" }) });
    out.push({ region: "abdomen", side: null, parts: blob("path", { d: "M74 154 L146 154 L144 202 L76 202 Z" }) });
    out.push({ region: "pelvis", side: null, parts: blob("path", { d: "M76 202 L144 202 L150 236 Q110 258 70 236 Z" }) });
  }
  out.push({ region: "neck", side: null, parts: blob("rect", { x: 100, y: 66, width: 20, height: 22, rx: 6 }) });
  out.push({ region: "head", side: null, parts: blob("ellipse", { cx: 110, cy: 38, rx: 23, ry: 28 }) });
  return out;
}

const Z = 200; // zoom views are 200 wide
function handZoom(side) {
  const thumbLeft = side !== "left"; // anatomical position, palms forward: the thumb points away from the body
  const t = (x) => (thumbLeft ? x : Z - x);
  const fingers = [[74, 128, 58], [93, 124, 38], [112, 124, 34], [131, 128, 52]];
  return [
    { region: "forearm", side, parts: blob("rect", { x: 68, y: 226, width: 64, height: 40, rx: 6 }) },
    { region: "wrist", side, parts: blob("rect", { x: 70, y: 200, width: 60, height: 30, rx: 8 }) },
    { region: "hand", side, parts: blob("rect", { x: 62, y: 118, width: 76, height: 84, rx: 22 }) },
    ...fingers.map(([x, y1, y2]) => ({ region: "fingers", side, parts: limb(x, y1, x, y2 + 0, 17) })),
    { region: "thumb", side, parts: limb(t(64), 172, t(30), 128, 20) },
  ];
}
function footZoom(side) {
  const bigToeLeft = side === "left";
  const t = (x) => (bigToeLeft ? x : Z - x);
  const toes = [[t(66), 56, 12, 16], [t(88), 40, 9, 13], [t(106), 38, 9, 12], [t(122), 44, 8, 11], [t(136), 56, 8, 10]];
  return [
    { region: "ankle", side, parts: blob("circle", { cx: 100, cy: 226, r: 26 }) },
    { region: "foot", side, parts: blob("ellipse", { cx: 100, cy: 150, rx: 46, ry: 70 }) },
    ...toes.map(([cx, cy, rx, ry]) => ({ region: "toes", side, parts: blob("ellipse", { cx, cy, rx, ry }) })),
  ];
}
function headZoom() {
  return [
    { region: "neck", side: null, parts: blob("rect", { x: 74, y: 196, width: 52, height: 58, rx: 10 }) },
    { region: "throat", side: null, parts: blob("ellipse", { cx: 100, cy: 232, rx: 17, ry: 15 }) },
    { region: "head", side: null, parts: blob("ellipse", { cx: 100, cy: 116, rx: 62, ry: 84 }) },
    { region: "ear", side: "right", parts: blob("ellipse", { cx: 34, cy: 118, rx: 10, ry: 22 }) },
    { region: "ear", side: "left", parts: blob("ellipse", { cx: 166, cy: 118, rx: 10, ry: 22 }) },
    { region: "eye", side: "right", parts: blob("ellipse", { cx: 74, cy: 96, rx: 14, ry: 8 }) },
    { region: "eye", side: "left", parts: blob("ellipse", { cx: 126, cy: 96, rx: 14, ry: 8 }) },
    { region: "nose", side: null, parts: blob("path", { d: "M100 104 L88 142 Q100 150 112 142 Z" }) },
    { region: "mouth", side: null, parts: blob("ellipse", { cx: 100, cy: 172, rx: 22, ry: 8 }) },
  ];
}

export const VIEWS = {
  front: { box: `0 0 ${W} 470`, shapes: () => figure(false) },
  back: { box: `0 0 ${W} 470`, shapes: () => figure(true) },
  hand: { box: `0 0 ${Z} 270`, shapes: (side) => handZoom(side) },
  foot: { box: `0 0 ${Z} 270`, shapes: (side) => footZoom(side) },
  head: { box: `0 0 ${Z} 270`, shapes: () => headZoom() },
};
export const ZOOMABLE = new Set(["hand", "foot", "head"]);
// when a region is not drawn in the current view, show its nearest drawn parent
const FALLBACK = { thumb: "hand", fingers: "hand", wrist: "hand", toes: "foot", eye: "head", ear: "head", nose: "head", mouth: "head", throat: "neck", hip: "pelvis" };

export function drawnIn(view, region, side) {
  return VIEWS[view].shapes(side).some((s) => s.region === region);
}
/** Which main view (front/back) draws this region? Prefers `current`. */
export function mainViewFor(region, current) {
  let r = region;
  for (let i = 0; i < 3 && r; i++) {
    for (const v of [current, current === "front" ? "back" : "front"]) if (drawnIn(v, r)) return { view: v, region: r };
    r = FALLBACK[r];
  }
  if (region === "hip") for (const v of [current, "front", "back"]) if (drawnIn(v, "buttock")) return { view: v, region: "buttock" };
  return null;
}

const SIDE_CODE = { "7771000": "left", "24028007": "right" };
export const sideOfCode = (c) => SIDE_CODE[c] || null;

/**
 * Draw the map into `svgHost`.
 * state: {view, side (zoom side), sel:{region,side}|null, hl:{region,side}|null, regionLabel(region)->string, sideLabel(side)->string}
 * on: {region(region, side)}
 */
export function drawBodyMap(svgHost, state, on) {
  const view = VIEWS[state.view];
  const svg = el("svg", { class: "bm", viewBox: view.box, role: "group", "aria-label": "body map", preserveAspectRatio: "xMidYMid meet" });
  // a thin neutral silhouette behind the front/back figure gives it a body-like outline
  const hlRegions = new Set();
  const shapes = view.shapes(state.side);
  const present = new Set(shapes.map((s) => s.region));
  if (state.hl) {
    let r = state.hl.region;
    while (r && !present.has(r)) r = FALLBACK[r];
    if (r) hlRegions.add(r);
  }
  const matchSide = (want, have) => !want || !have || want === have;
  for (const s of shapes) {
    const label = state.regionLabel(s.region) + (s.side ? ", " + state.sideLabel(s.side) : "");
    const isSel = state.sel && state.sel.region === s.region && matchSide(state.sel.side, s.side);
    const isHl = state.hl && hlRegions.has(s.region) && (state.hl.side ? matchSide(state.hl.side, s.side) || !s.side : true);
    const g = el("g", {
      class: "part" + (isSel ? " sel" : "") + (isHl ? " hl" : ""), tabindex: "0", role: "button",
      "aria-label": label, "aria-pressed": isSel ? "true" : "false", "data-region": s.region, "data-side": s.side || "",
    }, el("title", {}, label), ...s.parts);
    const act = () => on.region(s.region, s.side);
    g.addEventListener("click", act);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
    svg.append(g);
  }
  svgHost.replaceChildren(svg);
}
