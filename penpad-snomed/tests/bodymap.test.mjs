import test from "node:test";
import assert from "node:assert/strict";
import { shapesFor, drawnIn, mainViewFor, sideOfCode, mentionsSide, ZOOM_OF, ZOOM_VIEWS } from "../web/bodymap.js";
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

test("hand, leg, head-and-neck and back have a close-up; the trunk and arms do not", () => {
  assert.deepEqual([...ZOOM_VIEWS].sort(), ["backzoom", "hand", "headsection", "leg"]);
  assert.equal(ZOOM_OF.knee, "leg");
  assert.equal(ZOOM_OF.head, "headsection");
  assert.equal(ZOOM_OF.buttock, "backzoom");
  for (const r of ["chest", "abdomen", "shoulder", "upperarm", "forearm"]) assert.equal(ZOOM_OF[r], undefined, r);
});

test("every close-up draws the regions it promises, and only valid ones", () => {
  const regs = (v, side) => shapesFor(v, side).shapes.map((s) => s.region);
  assert.deepEqual(regs("leg", "right"), ["thigh", "knee", "lowerleg", "ankle", "foot"]);
  assert.ok(shapesFor("leg", "left").shapes.every((s) => s.side === "left"));
  assert.ok(shapesFor("leg", "left").box.split(" ").length === 4);
  assert.deepEqual(regs("headsection"), ["head", "nose", "mouth", "teeth", "tongue", "throat", "larynx"]);
  assert.ok(regs("backzoom").includes("buttock") && regs("backzoom").includes("back"));
  for (const v of ZOOM_VIEWS) for (const s of shapesFor(v, "right").shapes) assert.ok(s.paths.length && s.paths.every((d) => /^M/.test(d)), `${v}/${s.region}`);
});

test("a region only drawn in a close-up falls back to a drawn relative on the whole body", () => {
  assert.equal(drawnIn("headsection", "tongue"), true);
  assert.equal(drawnIn("front", "tongue"), false);
  assert.equal(mainViewFor("tongue", "front").region, "head");
  assert.equal(mainViewFor("larynx", "front").region, "neck");
});

test("side codes map to left and right", () => {
  assert.equal(sideOfCode("7771000"), "left");
  assert.equal(sideOfCode("24028007"), "right");
  assert.equal(sideOfCode("51440002"), null);
});

test("a finding that names the other side is recognised, in English and Swedish", () => {
  assert.equal(mentionsSide(["Joint pain in left hand", null], "left"), true);
  assert.equal(mentionsSide(["Joint pain in left hand", null], "right"), false);
  assert.equal(mentionsSide([null, "smärta i höger tumme"], "right"), true);
  assert.equal(mentionsSide(["Pain in thumb", "smärta i tumme"], "left"), false);
  assert.equal(mentionsSide(["Bilateral pain of joint of hands"], "left"), false);
  assert.equal(mentionsSide(["Copyleft notice"], "left"), false, "only whole words");
});
