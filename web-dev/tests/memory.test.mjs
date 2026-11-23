// What an iPhone or an iPad is spared (web/app/js/memory.js, GitHub issue 16): which devices, the address's switch, and each part:
// a stopped sound letting go of its samples (audio.js), one large picture decoded at a time with room made first and the story's own
// pictures ahead of those read ahead (renderer.js), the blurred copies held to their share and the targets let go, the text window's styles
// read for the scene that shows them (preload.js), and the pictures kept (pictureBudget). Nothing of it on any other device.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { memoryPlan, PARTS } = await import("../../web/app/js/memory.js");
const { Audio } = await import("../../web/app/js/audio.js");
const { withContext } = await import("./fake-audio.mjs");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const win = (ua, search = "", extra = {}) => ({ navigator: { userAgent: ua, vendor: "", maxTouchPoints: 0, ...extra }, location: { search } });
const all = (v) => Object.fromEntries(PARTS.map((p) => [p, v]));
const tick = () => new Promise((r) => setTimeout(r, 5));

// ---- which devices ---------------------------------------------------------------------------------------------------
test("an iPhone or an iPad takes every part; a desktop and an Android phone take none", () => {
  assert.deepEqual(memoryPlan(win(IPHONE)), all(true));
  assert.deepEqual(memoryPlan(win("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "", { vendor: "Apple Computer, Inc.", maxTouchPoints: 5 })), all(true), "an iPad that calls itself a Mac");
  assert.deepEqual(memoryPlan(win("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "", { vendor: "Apple Computer, Inc." })), all(false), "a Mac");
  assert.deepEqual(memoryPlan(win("Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140 Mobile")), all(false));
  assert.deepEqual(memoryPlan(win("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140")), all(false));
  assert.deepEqual(memoryPlan({}), all(false), "no browser at all (the tests, the replay)");
});

test("the address switches it off on an iPhone, on anywhere, or names the parts", () => {
  assert.deepEqual(memoryPlan(win(IPHONE, "?mem=off")), all(false));
  assert.deepEqual(memoryPlan(win("Mozilla/5.0 (Windows NT 10.0)", "?script=3&mem=on")), all(true));
  assert.deepEqual(memoryPlan(win("Mozilla/5.0 (Windows NT 10.0)", "?mem=queue,sounds")), { ...all(false), queue: true, sounds: true });
  assert.deepEqual(memoryPlan(win(IPHONE, "?mem=windows")), { ...all(false), windows: true });
  assert.deepEqual(PARTS, ["queue", "count", "windows", "sounds"], "(fewer pictures kept was a fifth: measured and taken out)");
});

// ---- sounds ----------------------------------------------------------------------------------------------------------
function player(release = true) {
  const audio = new Audio();
  const h = withContext(audio);
  audio.release = release;
  return { audio, ctx: h.ctx };
}
const buf = (duration = 2, numberOfChannels = 2) => ({ duration, numberOfChannels });

test("a sound that has ended is taken out of the graph and gives up its samples, after its own end handler has run", async () => {
  const { audio, ctx } = player();
  const n = audio.node(buf(), "se");
  const s = ctx.sources[0];
  let seen = "none";
  n.s.onended = () => { seen = s.buffer ? "with its buffer" : "without"; };
  assert.equal(audio.live.size, 1);
  s.end();
  assert.equal(seen, "with its buffer", "whoever plays the sound still reads it in its end handler");
  assert.ok(s.buffer, "not yet: the handlers come first");
  await tick();
  assert.equal(s.buffer, null);
  assert.equal(s.cut, true);
  assert.equal(n.g.cut, true, "its gain too");
  assert.equal(audio.live.size, 0);
});

test("every node made for a placed sound goes with it (the splitter, the gains, the merger)", async () => {
  const { audio, ctx } = player();
  const before = [];
  const make = ctx.createGain.bind(ctx), split = ctx.createChannelSplitter.bind(ctx), merge = ctx.createChannelMerger.bind(ctx);
  ctx.createGain = () => { const g = make(); before.push(g); return g; };
  ctx.createChannelSplitter = (c) => { const g = split(c); before.push(g); return g; };
  ctx.createChannelMerger = (c) => { const g = merge(c); before.push(g); return g; };
  audio.node(buf(), "se", { pan: 40 });   // off centre: each channel's share of each side
  assert.ok(before.length >= 4, `a splitter, gains and a merger: ${before.length}`);
  ctx.sources[0].end();
  await tick();
  assert.ok(before.every((p) => p.cut), "all of them disconnected");
});

test("stopped while the sound system runs, it waits for its end; stopped while it does not, it lets go at once", async () => {
  const { audio, ctx } = player();
  const a = audio.node(buf(), "se");
  audio.stopNode(a);
  assert.equal(a.s.stopped, true);
  assert.ok(a.s.buffer, "running: the context ends it, and a fade's tail is not cut by this");
  a.s.end();
  await tick();
  assert.equal(a.s.buffer, null);

  ctx.state = "suspended";
  const b = audio.node(buf(), "bgm", { loop: true });
  audio.stopNode(b);
  assert.equal(b.s.buffer, null, "no end will come from a context that is not running");
  assert.equal(b.s.cut, true);
  ctx.state = "interrupted";   // (an iPhone: a call, another app's sound)
  const c = audio.node(buf(), "voice", { stream: true });
  audio.stopNode(c);
  assert.equal(c.s.buffer, null);
  assert.equal(audio.live.size, 0);
});

test("nothing ends a sound by the clock: a line's voice in a context that stands still is left alone, and goes on in the new one", () => {
  const { audio, ctx } = player();
  const real = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    const voice = audio.node(buf(8, 1), "voice", { stream: true }), effect = audio.node(buf(2), "se");
    let ended = 0;
    voice.s.onended = effect.s.onended = () => { ended++; };
    ctx.currentTime = 3;                 // three seconds into the line
    ctx.state = "interrupted";           // the player switches apps for ten minutes
    now += 600000;
    audio.node(buf(1), "sys");           // (a new sound and a trim look at nothing)
    audio.trim();
    assert.ok(voice.s.buffer && effect.s.buffer, "both still hold their samples");
    assert.equal(voice.s.stopped, false);
    assert.equal(ended, 0, "no end was made up for either");
    const old = voice.s;
    assert.equal(audio.moveNode(voice, 3), true, "renew carries the line on");
    assert.deepEqual(voice.s.started, { when: 0, offset: 3 }, "from where it was");
    assert.equal(old.buffer, null);
    assert.equal(audio.moveNode(effect, 3), false, "the two-second effect was over: it gets its end, as before");
    assert.equal(ended, 1);
  } finally { performance.now = real; }
  assert.doesNotMatch(readFileSync(new URL("../../web/app/js/audio.js", import.meta.url), "utf8"), /sweep/);
});

test("a sound moved to a new context: the old source lets go once the new one has the samples, and what was not moved goes too", () => {
  const { audio, ctx } = player();
  const n = audio.node(buf(30), "bgm", { loop: true });
  const old = n.s, samples = old.buffer;
  const stray = audio.node(buf(30), "se");
  ctx.currentTime = 5;
  assert.equal(audio.moveNode(n, 5), true);
  assert.notEqual(n.s, old);
  assert.equal(n.s.buffer, samples, "the same samples play on");
  assert.equal(old.buffer, null);
  assert.equal(old.cut, true);
  assert.ok(audio.live.has(n.s) && !audio.live.has(old));
  // renew lets go of what the old context still had (here the same fake context stands for both)
  for (const [s, kept] of [...audio.live]) if (kept.ctx === ctx && s !== n.s) audio.letGo(s);
  assert.equal(stray.s.buffer, null);
});

test("off (every other device): no source is tracked or touched", async () => {
  const { audio, ctx } = player(false);
  const n = audio.node(buf(), "se");
  assert.equal(audio.live.size, 0);
  ctx.state = "suspended";
  audio.stopNode(n);
  n.s.end();
  await tick();
  assert.ok(n.s.buffer, "as before");
  assert.equal(n.s.cut, undefined);
  assert.equal(n.s.listeners.length, 0, "not even a listener");
});

// ---- pictures: one large one at a time ---------------------------------------------------------------------------------
const { Renderer } = await import("../../web/app/js/renderer.js");
const { Preloader, GL_ART, RANK } = await import("../../web/app/js/preload.js");
const json = (path) => JSON.parse(readFileSync(new URL(`../../web/assets/${path}`, import.meta.url), "utf8"));
const MB = 1048576;

// A renderer with no GPU: pictures of given sizes, uploads that end when the test says so, and a record of what happened in order.
function painter({ queue = true, count = true, limit = 400 * MB, sizes = {} } = {}) {
  const log = [], pending = new Map();
  const images = Object.fromEntries(Object.entries(sizes).map(([k, mb]) => [k, [4096, Math.round((mb * MB) / 4 / 4096), 1]]));   // (no side over the GPU's limit)
  const gl = { deleteTexture() {}, deleteFramebuffer() {}, flush() { log.push("flush"); }, isContextLost: () => false };
  const r = Object.assign(Object.create(Renderer.prototype), {
    gl, images, maxSide: 16384, limit, bytes: 0, tex: new Map(), files: new Map(), blurCache: new Map(), blurRefused: new Set(), blurBytes: 0, ui: new Map(),
    plan: { queue, count }, queueRoom: 48 * MB, groupState: { first: true },
    file: async () => ({}),
    upload(e, blob, key, alive = null) {
      log.push(`decode ${key}`);
      return new Promise((res, rej) => pending.set(key, { res: () => { if (alive && !alive()) return res(false); e.tex = {}; e.w = images[key][0]; e.h = images[key][1]; res(); }, rej }));
    },
  });
  const real = r.evict.bind(r);
  r.evict = (all, incoming = 0) => { if (incoming) log.push(`room for ${Math.round(incoming / MB)}`); return real(all, incoming); };
  const finish = async (key, fail = false) => { const p = pending.get(key); pending.delete(key); if (fail) p.rej(new Error("no")); else p.res(); await tick(); };
  return { r, log, finish, decoding: () => log.filter((l) => l.startsWith("decode")).map((l) => l.slice(7)) };
}

test("what a picture will take is known before it is decoded: its stored size, or the size the GPU's limit makes it", () => {
  const { r } = painter({ sizes: {} });
  r.images = { BIG: [5000, 5482, 1], TALL: [841, 4128, 1] };
  assert.equal(r.sizeOf("BIG"), 5000 * 5482 * 4);
  r.maxSide = 4096;
  assert.equal(r.sizeOf("BIG"), Math.floor(5000 / (5482 / 4096)) * 4096 * 4);
  assert.equal(r.sizeOf("TALL"), Math.floor(841 / (4128 / 4096)) * 4096 * 4);
  assert.equal(r.sizeOf("NONE"), 0);
});

test("a large picture is decoded alone, small ones together; the next goes when one is a texture", async () => {
  const { r, finish, decoding } = painter({ sizes: { A: 105, B: 105, S1: 10, S2: 10, S3: 30 } });
  for (const k of ["A", "B", "S1", "S2", "S3"]) r.load(k, true);
  await tick();
  assert.deepEqual(decoding(), ["A"], "105 MiB: alone, whatever was asked with it");
  await finish("A");
  assert.deepEqual(decoding(), ["A", "B"], "the next in the order asked, though the small ones would fit: none waits behind later ones");
  await finish("B");
  assert.deepEqual(decoding(), ["A", "B", "S1", "S2"], "10 + 10 fit together; 30 more would pass 48");
  await finish("S1");
  assert.deepEqual(decoding().at(-1), "S3", "10 + 30 fit");
  await finish("S2"); await finish("S3");
  assert.equal(r.decoding, 0);
  assert.equal(r.bytes, (105 + 105 + 10 + 10 + 30) * MB);
});

test("the story's own pictures go before those read ahead, and one the story comes to moves up", async () => {
  const { r, finish, decoding } = painter({ sizes: { A1: 60, A2: 60, A3: 60, WANT: 60 } });
  r.load("A1", true); r.load("A2", true); r.load("A3", true);
  await tick();
  r.load("WANT");            // the story asks for a picture nobody read ahead
  await tick();
  assert.deepEqual(decoding(), ["A1"]);
  await finish("A1");
  assert.deepEqual(decoding(), ["A1", "WANT"], "ahead of the two still waiting");
  const same = r.load("A3"); // the story has come to one the look-ahead asked for: the same promise, moved up
  assert.equal(same, r.tex.get("A3").promise);
  await finish("WANT");
  assert.deepEqual(decoding(), ["A1", "WANT", "A3"]);
  await finish("A3"); await finish("A2");
  assert.equal(r.waiting.length, 0);
  assert.equal(r.waits.n, 2, "the story's two waits were timed (WANT, and A3 from when it asked)");
});

test("room is made before a picture is decoded: the ones used longest ago go first, counting what is on its way", async () => {
  const { r, log, finish } = painter({ limit: 400 * MB, sizes: { NEW: 105 } });
  let t = 0;
  for (const k of ["OLD1", "OLD2", "OLD3", "OLD4"]) r.tex.set(k, { tex: {}, w: 1024, h: (90 * MB) / 4 / 1024, used: t++ });
  r.bytes = 360 * MB;
  r.load("NEW", true);
  await tick();
  assert.deepEqual(log.slice(0, 3), ["room for 105", "flush", "decode NEW"], "let go first, then decoded");
  assert.equal(r.bytes, 180 * MB, "360 + 105 is over 400: down to four fifths of the limit with the new one counted (180 + 105 < 320)");
  assert.ok(!r.tex.has("OLD1") && !r.tex.has("OLD2") && r.tex.has("OLD3") && r.tex.has("OLD4"));
  await finish("NEW");
  assert.equal(r.bytes, 285 * MB);
});

test("a picture that fails gives its turn up; a lost context's pictures come back through the same queue", async () => {
  const { r, finish, decoding } = painter({ sizes: { A: 105, B: 105 } });
  const a = r.load("A"); r.load("B");
  a.catch(() => {});
  await tick();
  await finish("A", true);
  assert.deepEqual(decoding(), ["A", "B"]);
  assert.equal(r.tex.has("A"), false);
  await finish("B");
  assert.equal(r.decoding, 0);
  // restore: the two a layer holds are uploaded one after the other
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  const restore = src.slice(src.indexOf("  restore() {"), src.indexOf("  // The pictures layers hold"));
  assert.match(restore, /done = await this\.turn\(key, false\)/);
});

test("the story asks for a picture whose file the look-ahead is still fetching: it goes with the story's own all the same", async () => {
  const { r, finish, decoding } = painter({ sizes: { A1: 60, A2: 60, LATE: 60 } });
  const files = new Map();
  r.file = (key) => new Promise((res) => files.set(key, () => res({})));
  r.load("A1", true); r.load("A2", true); r.load("LATE", true);
  files.get("A1")(); files.get("A2")();
  await tick();
  assert.deepEqual(decoding(), ["A1"]);
  r.load("LATE");              // the story comes to it: nothing of it is waiting a turn yet
  assert.equal(r.waiting.some((w) => w.key === "LATE"), false);
  files.get("LATE")();
  await tick();
  await finish("A1");
  assert.deepEqual(decoding(), ["A1", "LATE"], "before A2, which was asked first but only read ahead");
  await finish("LATE"); await finish("A2");
});

test("a context lost while pictures wait their turn: those loads make no texture and count nothing; a layer's picture comes back once", async () => {
  const { r, finish, decoding } = painter({ sizes: { HELD: 60, AHEAD1: 60, AHEAD2: 60 } });
  Object.assign(r, { setup() {}, invalidate() {}, menu: null, groupState: { first: true }, windowReady: false, targetUsed: new Map(), inUse: () => [{ image: "held" }] });
  const held = r.load("HELD"), a1 = r.load("AHEAD1", true), a2 = r.load("AHEAD2", true);
  await tick();
  assert.deepEqual(decoding(), ["HELD"], "one at a time: the other two wait");
  const entry = r.tex.get("HELD");
  const back = r.restore();    // the context is lost and made again while HELD is being decoded
  assert.equal(r.tex.has("AHEAD1"), false, "no layer holds them: let go");
  assert.equal(r.bytes, 0);
  await finish("HELD");        // the old load's pixels arrive: its upload is asked whether it is still its own, and is not
  await tick();
  assert.deepEqual(decoding(), ["HELD", "HELD"], "the two that were let go never decode; the held one is read again, by restore");
  assert.equal(r.bytes, 0, "the old load counted nothing");
  await finish("HELD");
  await back;
  assert.equal(r.bytes, 60 * MB, "counted once");
  assert.equal(await held, entry, "whoever waited on the old load gets the entry as restore made it again");
  assert.ok(entry.tex);
  assert.equal((await a1).tex, null);
  assert.equal((await a2).tex, null);
  assert.equal(r.decoding, 0);
  assert.equal(r.waiting.length, 0);
  // the check sits between the pixels and the texture, where nothing else can come between
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  const upload = src.slice(src.indexOf("  async upload(e, blob, key, alive = null) {"), src.indexOf("  // incoming: the bytes"));
  assert.ok(upload.indexOf("if (alive && !alive()) { bmp.close(); return false; }") < upload.indexOf("tex = gl.createTexture();"));
  assert.ok(upload.lastIndexOf("await ") < upload.indexOf("if (alive && !alive())"), "no wait after it");
});

test("without the queue (every other device) every picture is decoded as it is asked for, and room is made afterwards, as before", async () => {
  const { r, log, finish, decoding } = painter({ queue: false, sizes: { A: 105, B: 105, C: 105 } });
  r.load("A", true); r.load("B", true); r.load("C");
  await tick();
  assert.deepEqual(decoding(), ["A", "B", "C"]);
  assert.ok(!log.some((l) => l.startsWith("room")), "no room made ahead");
  await finish("A"); await finish("B"); await finish("C");
  assert.equal(r.bytes, 315 * MB);
});

// ---- pictures: the blurred copies, the reduced copies, the targets ------------------------------------------------------
function blurry(plan, extra = {}) {
  const freed = [];
  const gl = { deleteTexture: (t) => freed.push(t), deleteFramebuffer() {}, isContextLost: () => false };
  const r = Object.assign(Object.create(Renderer.prototype), { gl, limit: 400 * MB, bytes: 0, tex: new Map(), blurCache: new Map(), blurRefused: new Set(), blurBytes: 0,
    ui: new Map(), plan, frameNo: 10, groupState: { first: true }, ...extra });
  const copy = (key, mb, frame, used) => { r.blurCache.set(key, { target: { tex: key, fbo: key }, bytes: mb * MB, frame, used }); r.blurBytes += mb * MB; };
  return { r, freed, copy };
}

test("the blurred copies that stay over their share are those the last two frames drew, not those of the last half second", () => {
  const now = performance.now();
  const { r, copy } = blurry({ count: true });
  copy("cut1", 60, 6, now - 100); copy("cut2", 60, 8, now - 50); copy("shown", 60, 9, now - 10); copy("now", 60, 10, now);
  r.dropBlurred(100 * MB);
  assert.deepEqual([...r.blurCache.keys()], ["shown", "now"], "fast cuts: the copies of frames gone by go, though drawn a moment ago");
  assert.equal(r.blurBytes, 120 * MB, "what is on screen stays, over the share if it must");
  // by the clock, as every other device keeps them: all four were drawn within the half second
  const old = blurry({ count: false });
  old.copy("cut1", 60, 6, now - 100); old.copy("cut2", 60, 8, now - 50); old.copy("shown", 60, 9, now - 10); old.copy("now", 60, 10, now);
  old.r.dropBlurred(100 * MB);
  assert.equal(old.r.blurCache.size, 4);
  // and with nothing to stay (the page out of sight, no room on the GPU) every copy goes, on either
  r.dropBlurred(0, 0);
  assert.equal(r.blurBytes, 0);
});

test("the reduced copies a wide blur makes of a picture are counted with it, once, and go with it", () => {
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  const blurred = src.slice(src.indexOf("  blurred(e, name, rx, ry) {"), src.indexOf("  // layers: what is on screen"));
  assert.match(blurred, /if \(this\.plan\?\.count && !e\.extra && this\.tex\.get\(name\) === e\) \{ e\.extra = Math\.floor\(\(e\.w \* e\.h \* 4\) \/ 3\); this\.bytes \+= e\.extra; grew = true; \}/);
  // ... and room is made for them once the copy is done, as after a load (not in the middle of making it)
  assert.match(blurred, /if \(grew\) this\.evict\(\);[^\n]*\n    return out;/);
  const { r } = blurry({ count: true }, { limit: 100 * MB });
  r.tex.set("P", { tex: {}, w: 1024, h: (90 * MB) / 4 / 1024, extra: 30 * MB, used: 0 });
  r.tex.set("Q", { tex: {}, w: 1024, h: (60 * MB) / 4 / 1024, used: 1 });
  r.bytes = 180 * MB;
  r.evict();
  assert.equal(r.tex.has("P"), false);
  assert.equal(r.bytes, 60 * MB, "the picture and its reduced copies");
});

test("a target no frame has drawn through for two seconds is let go; the group's stays while a group is adding to it, the menu's pair while a menu is up", () => {
  const { r, freed } = blurry({ count: true });
  r.target = (w, h) => ({ tex: `t${freed.length}`, fbo: `f${Math.random()}`, w, h });
  r.scene = { tex: "scene", fbo: "sceneFbo", w: 1920, h: 1080 };
  const real = performance.now;
  let now = 5000;
  performance.now = () => now;
  try {
    for (const k of ["panelTarget", "groupTarget", "groupCopy", "ownerTarget", "fadeBuffer"]) r.lazy(k);
    r.menuA = r.target(1920, 1080); r.menuB = r.target(1920, 1080);
    r.menu = { frame: 1 };
    r.drawFbo = r.panelTarget.fbo;
    now += 1500;
    r.lazy("ownerTarget");          // drawn through again
    r.tidyTargets(now);
    assert.ok(r.panelTarget && r.menuA, "not two seconds yet");
    now += 600;
    r.groupState.first = false;     // a group left open: its target is not cleared before the next layer is added
    r.tidyTargets(now);
    assert.equal(r.panelTarget, null);
    assert.equal(r.groupCopy, null);
    assert.equal(r.fadeBuffer, null);
    assert.ok(r.groupTarget, "still being added to");
    assert.ok(r.ownerTarget, "used 600 ms ago");
    assert.ok(r.menuA && r.menuB, "the menu is up");
    assert.equal(r.drawFbo, "sceneFbo", "nothing is left bound to a target that has gone");
    r.groupState.first = true;
    r.menu = null;
    now += 2100;
    r.tidyTargets(now);
    assert.equal(r.groupTarget, null);
    assert.equal(r.ownerTarget, null);
    assert.equal(r.menuA, null);
    assert.equal(r.menuB, null);
    // made again when next needed
    assert.ok(r.lazy("panelTarget"));
  } finally { performance.now = real; }
  // every other device keeps them
  const keep = blurry({ count: false });
  keep.r.panelTarget = { tex: 1, fbo: 2, w: 1920, h: 1080 };
  keep.r.tidyTargets(performance.now() + 60000);
  assert.ok(keep.r.panelTarget);
});

test("what the renderer holds is added up by kind", () => {
  const { r, copy } = blurry({ count: true });
  r.bytes = 300 * MB;
  copy("b", 40, 10, 0);
  r.ui.set("DISP_PARTS_JA/txtwindow01-1920", { tex: {}, w: 1920, h: 1080 });
  r.scene = r.prev = { w: 1920, h: 1080 };
  const m = r.memStats();
  assert.equal(m.pictures, 300 * MB);
  assert.equal(m.blur, 40 * MB);
  assert.equal(m.ui, 1920 * 1080 * 4);
  assert.equal(m.targets, 2 * 1920 * 1080 * 4);
  assert.equal(m.total, m.pictures + m.blur + m.ui + m.targets);
});

// ---- the text window's styles ------------------------------------------------------------------------------------------
const system = json("system.json"), index = json("scripts/index.json"), tables = json("audio_tables.json");
const stylePath = (n) => `DISP_PARTS_JA/${system.windows.styles[n][0]}`;
function stage({ windows = true, vars = {}, auto = false } = {}) {
  const asked = [], dropped = [], loads = new Map();
  const vm = { index, movies: tables.movies, system, skip: false, skipUntil: 0, instant: false, voiceOn: true, soundsSkipped: false, script: { name: "" },
    getVar: (k) => vars[k] ?? 0, getScript: async (i) => json(`scripts/${i}.json`), movieFor: () => null };
  const gfx = { images: {}, tex: new Map(), ui: new Map(), files: new Map(), plan: { windows },
    load: () => Promise.resolve(), file: async () => ({}), hasFile: () => true, keepFiles() {},
    uiTexture(path) {
      const hit = gfx.ui.get(path);
      if (hit) return hit.tex;
      asked.push(path);
      const e = { tex: null };
      e.loaded = new Promise((res) => loads.set(path, () => { e.tex = {}; res(); }));
      gfx.ui.set(path, e);
      if (auto) loads.get(path)();
      return null;
    },
    uiDrop(path) { dropped.push(path); gfx.ui.delete(path); } };
  const audio = { table: tables, buffers: new Map(), muted: false, buffer: () => Promise.resolve() };
  class Picture { set src(v) {} decode() { return Promise.resolve(); } }
  const pre = new Preloader({ vm, gfx, audio, page: null, Picture, fonts: { story: [], menus: [] } });
  const arrive = async (path) => { loads.get(path)(); await tick(); };
  return { pre, vm, gfx, asked, dropped, arrive, vars };
}
const script = (ops) => ({ name: "t", ops, labels: {} });

test("every write to the window's style in the game's scripts names its number, so a scene's styles are known before it starts", () => {
  let writes = 0;
  for (let i = 0; i < index.names.length; i++) {
    for (const o of json(`scripts/${i}.json`).ops) {
      if (!o.slice(1).some((a) => a === "F1105" || a === "F1111")) continue;
      assert.equal(o[0], "WKST", `${index.names[i]}: ${o.join(" ")}`);
      assert.equal(o[2], "eq");
      assert.match(o[3], /^\d+$/);
      assert.ok(Number(o[3]) < system.windows.styles.length);
      writes++;
    }
  }
  assert.ok(writes > 500, `${writes} writes`);
});

test("a scene's window styles: the one it starts with, a second balloon's, and those its commands name from where it starts", () => {
  const { pre, vars } = stage({ vars: { F1105: 5, F1111: 0 } });
  const s = script([["WKST", "F1105", "eq", "7"], ["MSG", "$1"], ["WKST", "F1111", "eq", "4"], ["WKST", "F1105", "eq", "0"], ["WKST", "F1106", "eq", "12"]]);
  assert.deepEqual([...pre.sceneWindows(s)].sort(), [stylePath(0), stylePath(4), stylePath(5), stylePath(7)].sort());
  assert.deepEqual([...pre.sceneWindows(s, 2)].sort(), [stylePath(0), stylePath(4), stylePath(5)].sort(), "from command 2 on: 7 is behind it");
  vars.F1105 = 99;
  assert.deepEqual([...pre.sceneWindows(script([]))], [stylePath(0)], "no such style: only the second variable's");
});

test("the scene does not start until its styles are textures; the other styles' are let go, the story's own window never", async () => {
  const { pre, gfx, asked, dropped, arrive } = stage({ vars: { F1105: 0 } });
  // as a device that read every style at start would have them
  for (let n = 0; n < system.windows.styles.length; n++) gfx.ui.set(stylePath(n), { tex: {}, loaded: Promise.resolve() });
  const s = script([["WKST", "F1105", "eq", "5"], ["MSG", "$1"]]);
  assert.equal(pre.scene(s), null, "both are in: nothing to wait for");
  assert.equal(dropped.length, system.windows.styles.length - 2 - 0, "all but the scene's two");
  assert.ok(!dropped.includes(stylePath(0)) && !dropped.includes(stylePath(5)));
  assert.ok(GL_ART.story.includes(stylePath(0)), "(style 0 is the window the story's screen always has)");
  // a scene that names a style not read yet waits for the texture
  let started = false;
  const wait = pre.scene(script([["WKST", "F1105", "eq", "9"], ["WKST", "F1111", "eq", "11"]]));
  assert.ok(wait, "a promise");
  wait.then(() => { started = true; });
  assert.deepEqual(asked, [stylePath(9), stylePath(11)]);
  await arrive(stylePath(9));
  assert.equal(started, false, "one of two");
  await arrive(stylePath(11));
  assert.equal(started, true);
  assert.ok(dropped.includes(stylePath(5)), "the scene before's balloon");
  assert.ok(gfx.ui.has(stylePath(0)), "never the story's own window");
});

test("the scenes after this one: a style or two is read ahead, a Ciel-sensei corner's many are not held through the scene before it", async () => {
  const { pre, gfx, vm, asked } = stage({ vars: { F1105: 0 }, auto: true });
  gfx.ui.set(stylePath(0), { tex: {}, loaded: Promise.resolve() });
  const jumpTo = (i) => Object.keys(index.jump).find((k) => index.jump[k] === i);
  const corner = index.names.indexOf("QA_01"), story = index.names.indexOf("13_01_02_CIEL13_6_2");
  const cornerStyles = pre.sceneWindows(json(`scripts/${corner}.json`));
  assert.ok(cornerStyles.size > 2, `the corner names ${cornerStyles.size}`);
  vm.getScript = async (i) => (i === story ? { name: "next", labels: {}, ops: [["WKST", "F1105", "eq", "1"], ["MSG", "$1"]] } : json(`scripts/${i}.json`));
  pre.scene({ name: "t", labels: {}, ops: [["MSG", "$1"], ["JUMP", jumpTo(corner)], ["JUMP", jumpTo(story)]] });
  for (let k = 0; k < 40; k++) await tick();
  assert.deepEqual(asked, [stylePath(1)], "the story scene's one style; none of the corner's");
  assert.doesNotMatch(readFileSync(new URL("../../web/app/js/preload.js", import.meta.url), "utf8"), /windowKeep/);
});

test("at start an iPhone reads no style's texture but the story's own window; every other device reads all 33 as before", async () => {
  const count = async (windows) => {
    const { pre, asked } = stage({ windows, auto: true });
    pre.startup({ scene: true });
    for (let k = 0; k < 5; k++) { await tick(); await pre.idle(); }
    return asked.filter((p) => system.windows.styles.some((st) => p === `DISP_PARTS_JA/${st[0]}`));
  };
  assert.deepEqual(await count(true), [stylePath(0)]);
  assert.equal((await count(false)).length, 33);
});

test("a style let go while it was being read does not come back as a texture nobody holds", () => {
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  const ui = src.slice(src.indexOf("  uiTexture(path) {"), src.indexOf("  // A picture softened"));
  assert.match(ui, /if \(this\.ui\.get\(path\) !== e\) \{ bmp\.close\(\); return; \}/);
  const freed = [];
  const r = Object.assign(Object.create(Renderer.prototype), { gl: { deleteTexture: (t) => freed.push(t), isContextLost: () => false }, ui: new Map([["A", { tex: "texA" }]]), uiGen: 3 });
  r.uiDrop("A");
  assert.deepEqual(freed, ["texA"]);
  assert.equal(r.ui.has("A"), false);
  assert.equal(r.uiGen, 4, "a frame drawn with it is not the frame drawn without");
  r.uiDrop("A");
  assert.equal(r.uiGen, 4);
});

// ---- the pictures kept ---------------------------------------------------------------------------------------------------
test("the pictures kept are as they were on every device, an iPhone's 400 MB too (a lower limit was measured and not taken)", async () => {
  const { pictureBudget, PHONE_PICTURES } = await import("../../web/app/js/renderer.js");
  const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140 Mobile";
  assert.equal(pictureBudget(16384, win(IPHONE)), 400 * MB);
  assert.equal(pictureBudget(16384, win(IPHONE, "?mem=off")), 400 * MB);
  assert.equal(pictureBudget(8192, win(android, "", { deviceMemory: 8 })), PHONE_PICTURES * MB);
  assert.equal(pictureBudget(8192, win(android, "", { deviceMemory: 2 })), 400 * MB);
  assert.equal(pictureBudget(4096, win("Mozilla/5.0 (Windows NT 10.0)")), 400 * MB, "a desktop with a small GPU");
  assert.equal(pictureBudget(16384, win("Mozilla/5.0 (Windows NT 10.0)")), 1400 * MB);
  assert.equal(pictureBudget(16384, win("Mozilla/5.0 (Windows NT 10.0)", "?mem=on")), 1400 * MB, "switching the parts on for measuring moves no limit");
  const src = readFileSync(new URL("../../web/app/js/renderer.js", import.meta.url), "utf8");
  assert.match(src, /this\.dropBlurred\(this\.limit \/ 4\);/, "the blurred copies' share: a quarter of the limit");
  assert.doesNotMatch(src, /SPARED_PICTURES|plan\?\.limit/);
});
