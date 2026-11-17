// A picture larger than the GPU takes is made smaller in a worker, not on the page's thread (web/app/js/shrink.js, renderer.js upload).
import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";

const { Shrinker, SOURCE } = await import("../../web/app/js/shrink.js");
const { Renderer } = await import("../../web/app/js/renderer.js");

const OPTS = { premultiplyAlpha: "premultiply", colorSpaceConversion: "none", resizeWidth: 834, resizeHeight: 4096, resizeQuality: "high" };
const bitmap = (w, h, from) => ({ width: w, height: h, from, closed: false, close() { this.closed = true; } });
// A worker as the page sees it. answer(msg, w): what it does with a message (default: a bitmap of the size asked, as the worker's lines give).
function worker(answer) {
  const w = { got: [], ended: false, postMessage(msg) { w.got.push(msg); (answer || ((m) => w.say({ id: m.id, bmp: bitmap(m.opts.resizeWidth, m.opts.resizeHeight, "worker") })))(msg, w); },
    say(data) { queueMicrotask(() => w.onmessage?.({ data })); }, terminate() { w.ended = true; } };
  return w;
}
const page = () => { const calls = []; return { calls, here: async (blob, o) => { calls.push(blob); return bitmap(o.resizeWidth, o.resizeHeight, "page"); } }; };

test("the picture comes from the worker, at the size asked, and nothing is made on the page", async () => {
  const w = worker(), p = page();
  let made = 0;
  const s = new Shrinker({ make: () => { made++; return w; }, here: p.here });
  const a = await s.bitmap("blob A", OPTS), b = await s.bitmap("blob B", { ...OPTS, resizeWidth: 4096, resizeHeight: 2993 });
  assert.deepEqual([a.from, a.width, a.height, b.from, b.width, b.height], ["worker", 834, 4096, "worker", 4096, 2993]);
  assert.deepEqual(w.got.map((m) => [m.blob, m.opts.resizeWidth, m.opts.resizeQuality, m.opts.premultiplyAlpha, m.opts.colorSpaceConversion]),
    [["blob A", 834, "high", "premultiply", "none"], ["blob B", 4096, "high", "premultiply", "none"]], "the file and the same options the page would give");
  assert.deepEqual([made, p.calls.length, s.jobs.size], [1, 0, 0], "one worker for the page, made at the first picture");
});

test("no worker in this browser, or one that cannot be made: on the page, and it is not tried again", async () => {
  for (const make of [() => null, () => { throw new Error("blocked"); }]) {
    let tries = 0;
    const p = page(), s = new Shrinker({ make: () => { tries++; return make(); }, here: p.here });
    assert.equal((await s.bitmap("a", OPTS)).from, "page");
    assert.equal((await s.bitmap("b", OPTS)).from, "page");
    assert.deepEqual([tries, p.calls], [1, ["a", "b"]]);
  }
});

test("a picture the worker could not make is made on the page; the worker is still used for the next", async () => {
  const w = worker((m, self) => self.say(m.blob === "bad" ? { id: m.id, error: "The source image could not be decoded." } : { id: m.id, bmp: bitmap(m.opts.resizeWidth, m.opts.resizeHeight, "worker") }));
  const p = page(), s = new Shrinker({ make: () => w, here: p.here });
  assert.equal((await s.bitmap("bad", OPTS)).from, "page");
  assert.equal((await s.bitmap("good", OPTS)).from, "worker");
  assert.deepEqual([p.calls, s.off, w.ended], [["bad"], false, false]);
});

test("a worker that gives another size than asked is given up: its bitmap is closed and every picture is made on the page", async () => {
  const wrong = bitmap(841, 4128, "worker");
  const w = worker((m, self) => self.say({ id: m.id, bmp: wrong }));
  const p = page(), s = new Shrinker({ make: () => w, here: p.here });
  const a = await s.bitmap("a", OPTS), b = await s.bitmap("b", OPTS);
  assert.deepEqual([a.from, a.width, b.from, wrong.closed, w.ended, s.off, w.got.length], ["page", 834, "page", true, true, true, 1]);
});

test("a worker whose lines fail, or that does not answer, is given up, and what it owed is made on the page", async () => {
  // it fails while two pictures wait
  const silent = worker(() => {}), p1 = page(), s1 = new Shrinker({ make: () => silent, here: p1.here });
  const both = Promise.all([s1.bitmap("a", OPTS), s1.bitmap("b", OPTS)]);
  let stopped = false;
  silent.onerror({ preventDefault() { stopped = true; } });
  assert.deepEqual((await both).map((b) => b.from), ["page", "page"]);
  assert.deepEqual([stopped, silent.ended, s1.off, s1.jobs.size, p1.calls], [true, true, true, 0, ["a", "b"]]);
  assert.equal((await s1.bitmap("c", OPTS)).from, "page");
  assert.equal(silent.got.length, 2, "nothing more is sent to it");
  // it never answers: given up after `patience`
  const mute = worker(() => {}), p2 = page(), s2 = new Shrinker({ make: () => mute, here: p2.here, patience: 20 });
  const t0 = Date.now();
  assert.equal((await s2.bitmap("a", OPTS)).from, "page");
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual([mute.ended, s2.off], [true, true]);
  // a message it cannot take
  const deaf = worker(() => { throw new Error("DataCloneError"); }), p3 = page(), s3 = new Shrinker({ make: () => deaf, here: p3.here });
  assert.equal((await s3.bitmap("a", OPTS)).from, "page");
  assert.equal(s3.off, true);
  // an answer after it was given up changes nothing
  mute.onmessage?.({ data: { id: 1, bmp: bitmap(834, 4096, "worker") } });
  assert.equal(s2.jobs.size, 0);
});

test("the worker's own lines: the browser's createImageBitmap with the options given, the bitmap handed over, a failure said", async () => {
  const posted = [], asked = [];
  const scope = { createImageBitmap: async (blob, o) => { asked.push([blob, o]); if (blob === "bad") throw new Error("could not be decoded"); return { width: o.resizeWidth, height: o.resizeHeight }; },
    postMessage: (msg, transfer) => posted.push([msg, transfer]) };
  runInNewContext(SOURCE, scope);
  await scope.onmessage({ data: { id: 7, blob: "file", opts: OPTS } });
  await scope.onmessage({ data: { id: 8, blob: "bad", opts: OPTS } });
  assert.deepEqual(asked[0], ["file", OPTS]);
  assert.deepEqual([posted[0][0].id, posted[0][0].bmp.width, posted[0][1].length, posted[0][1][0] === posted[0][0].bmp], [7, 834, 1, true], "transferred, not copied");
  assert.deepEqual([posted[1][0].id, posted[1][0].error, posted[1][0].bmp, posted[1][1]], [8, "could not be decoded", undefined, undefined]);
});

test("renderer.js upload: a picture over the GPU's limit is made smaller through the worker; one within it never is", async (t) => {
  t.after(() => { delete globalThis.createImageBitmap; });
  const gl = { NO_ERROR: 0, isContextLost: () => false, getError: () => 0, createTexture: () => ({}), bindTexture() {}, pixelStorei() {}, texParameteri() {}, deleteTexture() {}, texImage2D() {} };
  const asked = [];
  const shrink = { bitmap: async (blob, o) => { asked.push([blob, o.resizeWidth, o.resizeHeight, o.resizeQuality, o.premultiplyAlpha, o.colorSpaceConversion]); return bitmap(o.resizeWidth, o.resizeHeight, "worker"); } };
  const r = Object.assign(Object.create(Renderer.prototype), { gl, maxSide: 4096, limit: 400 * 1048576, bytes: 0, tex: new Map(), files: new Map(), evict() {}, shrink });
  const full = [];
  globalThis.createImageBitmap = async (blob, o = {}) => { assert.equal(o.resizeWidth, undefined, "no resize is asked of the page"); const b = bitmap(blob.w, blob.h, "page"); full.push(b); return b; };
  const sprite = {}, wide = {}, small = {};
  await r.upload(sprite, { w: 841, h: 4128 }, "SIE_A_00_00_N00");
  await r.upload(wide, { w: 5927, h: 4332 }, "VRV_A_12_00_A01");
  await r.upload(small, { w: 1920, h: 1080 }, "IMG0001");
  assert.deepEqual(asked.map((a) => a.slice(1)), [[834, 4096, "high", "premultiply", "none"], [4096, 2993, "high", "premultiply", "none"]]);
  assert.deepEqual([[sprite.w, sprite.h], [wide.w, wide.h], [small.w, small.h]], [[834, 4096], [4096, 2993], [1920, 1080]]);
  assert.deepEqual(full.map((b) => b.closed), [true, true, true], "the full-size bitmaps are let go (the small one after its upload)");
  // without one given, the renderer makes its own (here: no worker in node, so the page's createImageBitmap)
  const own = Object.assign(Object.create(Renderer.prototype), { gl, maxSide: 4096, limit: 400 * 1048576, bytes: 0, tex: new Map(), files: new Map(), evict() {} });
  globalThis.createImageBitmap = async (blob, o = {}) => bitmap(o.resizeWidth || blob.w, o.resizeHeight || blob.h, "page");
  const e = {};
  await own.upload(e, { w: 841, h: 4128 }, "SIE_A_00_00_N00");
  assert.deepEqual([e.w, e.h, own.shrink instanceof Shrinker, own.shrink.off], [834, 4096, true, true]);
});
