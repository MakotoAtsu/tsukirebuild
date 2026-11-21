// A frame is not drawn again when nothing it is drawn from has changed (renderer.js frameKey, present): the Find X8's lag from Ciel's train on
// (2026-11-21), where 80 to 100 % of the frames drawn while reading were the frame before, each with two full-screen copies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");
const { Renderer, keyOf, texId } = await import("../../web/app/js/renderer.js");
const { Value } = await import("../../web/app/js/animation.js");

const layer = (id, extra = {}) => ({ id, image: `img${id}`, ready: null, promise: null, x: new Value(240), y: new Value(136), alpha: new Value(255), z: 1000,
  blend: 0, blurX: 0, blurY: 0, tint: null, effect: 0, grain: 0, rule: null, link: -1, parent: -1, clip: null, border: 0, frame: 0, motion: null, effects: {}, ...extra });

test("a frame's key: every value it is drawn from, a texture by its number, another layer by its; tweens and tracks left out", () => {
  const tex = {}, other = {};
  const a = layer(1, { ready: { tex } }), b = layer(1, { ready: { tex } });
  assert.equal(keyOf(a), keyOf(b), "the same layer, the same key");
  assert.notEqual(keyOf(a), keyOf({ ...b, blend: 2 }), "a value that changes, another key");
  assert.notEqual(keyOf(a), keyOf({ ...b, ready: { tex: other } }), "another texture, another key");
  assert.notEqual(keyOf(layer(1)), keyOf(a), "no texture yet, then one: another key");
  assert.equal(keyOf({ ...a, x: new Value(900), motion: { track: [1, 2, 3] }, promise: Promise.resolve() }), keyOf(a), "tweens, the track and the promise left out (their values are in the state)");
  const owner = layer(7);
  const placed = { x: 1, clip: { rect: [0, 0, 10, 10], group: owner } };
  assert.match(keyOf(placed), /group:L7;/, "a layer met inside is its number");
  const loop = { a: 1 }; loop.self = loop;
  assert.doesNotThrow(() => keyOf(loop), "a loop does not run away");
  const view = Object.create(a); view.z = 5;
  assert.match(keyOf(view), /z:5;/); assert.match(keyOf(view), /image:img1;/, "a view counts its layer's values too");
  assert.equal(texId(null), 0);
  assert.equal(texId(tex), texId(tex));
  assert.notEqual(texId(tex), texId(other));
});

test("a frame's key is none (drawn every frame) when something in it changes with the frame's own time", () => {
  const r = Object.assign(Object.create(Renderer.prototype), { tex: new Map(), hazes: [], hazeTable: [null, { n: 1 }], lines: null, split: null, noSplit: false, ruleSlot: undefined, uiGen: 0 });
  const st = (l) => new Map([[l, { x: 1, y: 2, alpha: 255 }]]);
  const one = (l) => r.frameKey([l], st(l), new Map([[l, { x: 1 }]]), new Map([[l.id, l]]), 1000, 0, 0);
  const plain = layer(3, { ready: { tex: {} } });
  assert.equal(typeof one(plain), "string");
  assert.equal(one(plain), one(plain), "the same frame, the same key");
  assert.equal(one(layer(3, { grain: 4 })), null, "film grain");
  r.hazes[3] = { n: 1 };
  assert.equal(one(plain), null, "a haze");
  r.hazes[3] = null;
  r.lines = {};
  assert.equal(one(plain), null, "the speed lines");
  r.lines = null; r.split = {};
  assert.equal(one(plain), null, "the split");
  r.split = null;
  const before = one(plain);
  r.uiGen++;
  assert.notEqual(one(plain), before, "interface art that came since (a panel's edge gradation): another key");
  assert.notEqual(r.frameKey([plain], st(plain), new Map([[plain, { x: 1 }]]), new Map([[3, plain]]), 1000, 2, 0), one(plain), "the shake: another key");
});

test("present: nothing drawn when the scene and what is laid over it are as last time", () => {
  let calls = 0;
  const gl = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => { calls++; return null; }) });
  const prog = { p: {}, u: new Proxy({}, { get: () => ({}) }) };
  const r = Object.assign(Object.create(Renderer.prototype), { gl, menu: null, fade: null, windowPics: [], ui: new Map(), uiGen: 0,
    displayTarget: { fbo: {}, tex: {} }, scene: { tex: {} }, prev: { tex: {} }, copyProg: prog, displayProg: prog, windowProg: prog, lineProg: prog, fadeProg: prog });
  const drawn = (f) => { const n = calls; f(); return calls > n; };
  r.sceneSame = false;
  assert.equal(drawn(() => r.present(1)), true, "the first frame");
  r.sceneSame = true;
  assert.equal(drawn(() => r.present(2)), false, "the same scene and window: nothing drawn");
  assert.equal(r.presentSame, true);
  r.windowPics = [{ path: "DISP_PARTS_JA/txtwindow01-1920", full: true, alpha: 0.5, dx: 0, dy: 0 }];
  assert.equal(drawn(() => r.present(3)), true, "the window fading in");
  assert.equal(drawn(() => r.present(4)), false);
  r.uiGen++;
  assert.equal(drawn(() => r.present(5)), true, "interface art that came since");
  r.fade = { start: 0, ms: 1000, rule: null };
  assert.equal(drawn(() => r.present(6)), true, "a transition draws every frame");
  r.fade = null;
  r.present(7);
  r.sceneSame = false;
  assert.equal(drawn(() => r.present(8)), true, "a scene drawn again");
  r.sceneSame = true;
  assert.equal(drawn(() => r.present(9, false)), true, "a save's picture (no window): drawn");
  assert.equal(drawn(() => r.present(10)), true, "and the frame after, with the window again");
  r.invalidate();
  assert.equal(drawn(() => r.present(11)), true, "after invalidate");
});

test("the skip's other ends: no GL before the key, a transition and a new context draw again, the page back in sight too", () => {
  const src = source("js/renderer.js");
  const body = src.slice(src.indexOf("  drawLayers(layers, now, all) {"), src.indexOf("    const moved = new Map();"));
  assert.ok(body.indexOf("if (same && !this.verifySkip) return;") < body.indexOf("gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);"), "nothing is bound or cleared before the key");
  assert.doesNotMatch(body.slice(0, body.indexOf("const key = this.frameKey")), /gl\.(bindFramebuffer|clear|useProgram)/);
  assert.match(src, /this\.scene = t;\n\s*this\.sceneKey = null;/, "a transition draws into the older buffer: drawn again");
  assert.match(src, /restore\(\) \{\n\s*this\.setup\(\);\n\s*this\.invalidate\(\);/);
  assert.match(src, /this\.uiGen = \(this\.uiGen \|\| 0\) \+ 1;/);
  assert.match(source("js/main.js"), /else gfx\.invalidate\?\.\(\);/);
});
