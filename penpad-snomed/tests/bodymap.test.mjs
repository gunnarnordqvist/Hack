import test from "node:test";
import assert from "node:assert/strict";
import { shapesFor, drawnIn, mainViewFor, sideOfCode, ZOOMABLE } from "../web/bodymap.js";
import { BODY } from "../web/vendor/bodypaths.js";

test("regions are drawn where the anatomy says", () => {
  assert.equal(drawnIn("front", "chest"), true);
  assert.equal(drawnIn("back", "chest"), false);
  assert.equal(drawnIn("back", "back"), true);
  assert.equal(drawnIn("front", "back"), false);
  assert.equal(drawnIn("front", "buttock"), false);
  assert.equal(drawnIn("back", "buttock", "left"), true);
  assert.equal(drawnIn("front", "thumb"), false);
  assert.equal(drawnIn("hand", "thumb", "left"), true);
});

test("a region that is not drawn falls back to its nearest drawn relative", () => {
  assert.deepEqual(mainViewFor("thumb", "front"), { view: "front", region: "hand" });
  assert.deepEqual(mainViewFor("toes", "back"), { view: "back", region: "foot" });
  assert.deepEqual(mainViewFor("eye", "front"), { view: "front", region: "head" });
  assert.deepEqual(mainViewFor("throat", "front"), { view: "front", region: "neck" });
  assert.deepEqual(mainViewFor("elbow", "back"), { view: "back", region: "upperarm" });
});

test("front and back are chosen by where the region is drawn", () => {
  assert.equal(mainViewFor("chest", "back").view, "front");
  assert.equal(mainViewFor("back", "front").view, "back");
  assert.equal(mainViewFor("hand", "back").view, "back");
  assert.equal(mainViewFor("hip", "front").view, "back");
});

test("paired regions come in left and right, unpaired ones do not", () => {
  const sides = (view, region) => BODY[view].filter((s) => s.region === region).map((s) => s.side).sort();
  assert.deepEqual(sides("front", "knee"), ["left", "right"]);
  assert.deepEqual(sides("front", "chest"), [null]);
  assert.deepEqual(sides("back", "back"), [null]);
  assert.deepEqual(sides("back", "buttock"), ["left", "right"]);
});

test("side names follow the patient: left in the front view is on the viewer's right", () => {
  const x = (view, region, side) => Number(BODY[view].find((s) => s.region === region && s.side === side).paths[0].match(/^M\s*([\d.]+)/)[1]);
  assert.ok(x("front", "knee", "left") > 362 && x("front", "knee", "right") < 362);
  assert.ok(x("back", "buttock", "left") < 1086 && x("back", "buttock", "right") > 1086);
});

test("the hand close-up has a palm, a thumb and four fingers, for either hand", () => {
  for (const side of ["left", "right"]) {
    const { shapes, box } = shapesFor("hand", side);
    assert.equal(shapes.find((s) => s.region === "hand").paths.length, 1);
    assert.equal(shapes.find((s) => s.region === "thumb").paths.length, 1);
    assert.equal(shapes.find((s) => s.region === "fingers").paths.length, 4);
    assert.equal(box.split(" ").length, 4);
  }
});

test("each main view draws only its own outline", () => {
  assert.equal(shapesFor("front").outline.length, 1);
  assert.equal(shapesFor("back").outline.length, 1);
  assert.notEqual(shapesFor("front").outline[0], shapesFor("back").outline[0]);
  assert.ok(shapesFor("hand", "left").anchors.thumb.length === 2);
});

test("only the hand zooms; side codes map to left and right", () => {
  assert.deepEqual([...ZOOMABLE], ["hand"]);
  assert.equal(sideOfCode("7771000"), "left");
  assert.equal(sideOfCode("24028007"), "right");
  assert.equal(sideOfCode("51440002"), null);
});
