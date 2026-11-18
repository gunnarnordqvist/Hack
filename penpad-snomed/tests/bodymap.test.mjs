import test from "node:test";
import assert from "node:assert/strict";

// bodymap.js builds SVG elements only when drawing; a tiny stand-in for the DOM is enough for the pure logic.
globalThis.document = {
  createElementNS: (_ns, tag) => ({ tag, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); } }),
};
const { drawnIn, mainViewFor, sideOfCode, ZOOMABLE, VIEWS } = await import("../web/bodymap.js");

test("regions are drawn where the anatomy says", () => {
  assert.equal(drawnIn("front", "chest"), true);
  assert.equal(drawnIn("back", "chest"), false);
  assert.equal(drawnIn("back", "back"), true);
  assert.equal(drawnIn("front", "back"), false);
  assert.equal(drawnIn("hand", "thumb", "left"), true);
  assert.equal(drawnIn("front", "thumb"), false);
});

test("a region that is only in a zoom falls back to its parent on the main figure", () => {
  assert.deepEqual(mainViewFor("thumb", "front"), { view: "front", region: "hand" });
  assert.deepEqual(mainViewFor("toes", "back"), { view: "back", region: "foot" });
  assert.deepEqual(mainViewFor("eye", "front"), { view: "front", region: "head" });
  assert.deepEqual(mainViewFor("throat", "front"), { view: "front", region: "neck" });
});

test("front and back are chosen by where the region is drawn", () => {
  assert.equal(mainViewFor("chest", "back").view, "front");
  assert.equal(mainViewFor("back", "front").view, "back");
  assert.equal(mainViewFor("hand", "back").view, "back");
  assert.equal(mainViewFor("hip", "front").region, "pelvis");
});

test("sides are the patient's: left in front is on the viewer's right, in back on the viewer's left", () => {
  const xOf = (view, side) => {
    const s = VIEWS[view].shapes().find((x) => x.region === "hand" && x.side === side);
    return Number(s.parts[0].attrs.cx);
  };
  assert.ok(xOf("front", "left") > 110 && xOf("front", "right") < 110);
  assert.ok(xOf("back", "left") < 110 && xOf("back", "right") > 110);
});

test("hand, foot and head zoom; side codes map to left and right", () => {
  assert.deepEqual([...ZOOMABLE].sort(), ["foot", "hand", "head"]);
  assert.equal(sideOfCode("7771000"), "left");
  assert.equal(sideOfCode("24028007"), "right");
  assert.equal(sideOfCode("51440002"), null);
});

test("the thumb points away from the body", () => {
  const thumbX = (side) => {
    const t = VIEWS.hand.shapes(side).find((x) => x.region === "thumb");
    return Number(t.parts[1].attrs.x2);
  };
  assert.ok(thumbX("right") < 100);
  assert.ok(thumbX("left") > 100);
});
