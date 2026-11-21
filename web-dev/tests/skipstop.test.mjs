// Where a run that passes the script at once stops (vm.js loadDeferred, stopWaits, askPictures; main.js drawSkipBlack). Such a run names its
// pictures and loads none (preload.test.mjs); these are what the script does about that at the stop, with the real interpreter going through
// its own loop and a renderer whose pictures come when the test says. Found on 2026-11-21, the day the run stopped loading as it went:
//   - the line an instant run stopped at typed and spoke, and its choice came up, before the stop's pictures were in;
//   - a jump to a point (?pc=) that met a choice showed it over layers with no pictures at all (/?script=01_00_ARC01_4&pc=125);
//   - SPFC / SPRD still loaded their pictures during such a run (31 in a read scene's run through 14_01B_01_CIEL14B_1D).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } };

const { VM } = await import("../../web/app/js/vm.js");
const { Audio } = await import("../../web/app/js/audio.js");
const { withContext } = await import("./fake-audio.mjs");
const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");

// The interpreter with stand-ins: a renderer that hands a picture over only when finish() is called, a text window and a sound that record
// what they were asked for.
function machine(extra = {}) {
  const asked = [], waiting = [], calls = [], voices = [];
  const text = new Proxy({ pageParts: [], typing: false, intro: false, closed: false, rate: 0, history: [], logged: 0 }, {
    get(t, k) { if (k in t) return t[k]; if (k === "then" || typeof k === "symbol") return undefined; return () => { calls.push(String(k)); return undefined; }; } });
  const audio = new Audio();
  withContext(audio);
  audio.playVoice = (name) => { voices.push(name); return Promise.resolve(); };
  const gfx = { images: null, tex: new Map(), hold() {}, beginFade() {},
    load(name) { asked.push(name); return new Promise((r) => waiting.push(() => r({ tex: { name }, name }))); } };
  const vm = new VM({ gfx, audio, text, ...extra });
  vm.snapshot = () => ({ pc: vm.pc, script: 0, name: "T", logged: 0, vars: {} });
  vm.lines = ["zero"];
  const run = (ops, more = {}) => { vm.script = { name: "T", labels: {}, ops, ...more }; vm.running = true; };
  return { vm, asked, calls, voices, run, finish: () => { for (const r of waiting.splice(0)) r(); }, typed: () => calls.filter((c) => c === "log" || c === "add").join(",") };
}
const turns = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const until = async (what, ms = 3000) => { const end = Date.now() + ms; while (!what() && Date.now() < end) await new Promise((r) => setTimeout(r, 5)); return what(); };
const drawn = (vm) => [...vm.layers.values()].map((l) => `${l.id}:${l.image}:${l.ready ? "in" : "out"}`);

test("the line an instant run stops at waits for the stop's pictures: no letters, no voice and no wait for the player before they are in", async () => {
  const { vm, asked, voices, run, finish, typed } = machine();
  vm.fastForwardRead = true;
  run([["STCC", "-1"], ["STCH", "0", "BG_NEW", "240", "136"], ["FADS", "1", "0", "0"], ["VPLY", "A00_01_00_0000_0"], ["MSG", "hello there"], ["WTTM", "10"]], { zm: { 4: (7 << 8) | 1 } });
  vm.beginInstant();
  vm.loop(vm.generation);
  await turns();
  assert.equal(vm.instant, false, "the run stopped at the line not read yet");
  assert.deepEqual(asked, ["BG_NEW"], "and asked for the picture on the layer there");
  assert.equal(vm.holdingFrame, true); assert.equal(vm.loadHold, 1);
  assert.equal(typed(), "", "the line has not been put up");
  assert.deepEqual(voices, [], "nor its voice started");
  assert.equal(!!vm.waitResolve, false, "nor is the player waited for (a press would pass a line whose picture was never shown)");
  finish();
  assert.ok(await until(() => !!vm.waitResolve), "once the picture is in the line goes up and waits for the player");
  assert.equal(typed(), "log,add");
  assert.deepEqual(voices, ["A00_01_00_0000_0"]);
  assert.equal(!!vm.waitResolve, true);
  assert.equal(vm.holdingFrame, false); assert.equal(vm.loadHold, 0); assert.equal(vm.comingIn, null);
  assert.deepEqual(drawn(vm), ["0:BG_NEW:in"]);
  vm.stop();
});

test("a choice an instant run stops at comes up over the stop's pictures, not before them", async () => {
  let rows = 0;
  const { vm, asked, run, finish } = machine({ onChoice: async () => { rows++; return 0; } });
  vm.fastForwardRead = false;
  run([["STCC", "-1"], ["STCH", "0", "BG_NEW", "240", "136"], ["FADS", "1", "0", "0"], ["ATSV", "1"], ["SELR", "one"], ["SELR", "two"], ["SELD", "F100", "1"], ["WTTM", "10"]]);
  vm.beginInstant();
  vm.loop(vm.generation);
  await turns();
  assert.deepEqual(asked, ["BG_NEW"]);
  assert.equal(vm.pc, 4, "the script stands after the ATSV that stopped the run");
  assert.equal(rows, 0, "the rows have not come up");
  finish();
  assert.ok(await until(() => rows === 1), "they do once the picture is in");
  vm.stop();
});

test("a jump to a point that meets a choice loads the pictures under it and asks then; the run goes on to its point after the answer", async () => {
  let rows = 0, answer = null;
  const { vm, asked, run, finish } = machine({ onChoice: () => { rows++; return new Promise((r) => { answer = r; }); } });
  run([["STCC", "-1"], ["STCH", "0", "BG_A", "240", "136"], ["STCH", "5", "SPRITE_B", "240", "136"], ["FADS", "1", "0", "0"], ["SELR", "one"], ["SELR", "two"], ["SELD", "F100", "1"],
    ["STCH", "6", "AFTER_C", "1", "1"], ["FADS", "1", "0", "0"], ["STCH", "7", "LAST_D", "1", "1"], ["FADS", "1", "0", "0"], ["WTTM", "10"], ["WTTM", "10"]]);
  vm.skip = true; vm.forceSkip = true; vm.skipUntil = 11;   // as main.js sets them for ?pc=11
  vm.loop(vm.generation);
  await turns();
  assert.equal(vm.picturesSkipped, true, "the run still passes the script at the choice");
  assert.deepEqual(asked, ["BG_A", "SPRITE_B"], "the pictures on the layers under the choice are asked for all the same");
  assert.equal(rows, 0, "and the choice waits for them");
  assert.equal(vm.holdingFrame, true);
  finish();
  assert.ok(await until(() => rows === 1));
  assert.deepEqual(drawn(vm), ["0:BG_A:in", "5:SPRITE_B:in"], "the choice stands over its pictures");
  answer(0);
  assert.ok(await until(() => vm.skipUntil === 0 && asked.length === 4), "the run went on to its point");
  assert.deepEqual(asked, ["BG_A", "SPRITE_B", "AFTER_C", "LAST_D"], "where it loads what its layers hold, as before");
  finish();
  assert.ok(await until(() => !vm.holdingFrame));
  assert.deepEqual(drawn(vm), ["0:BG_A:in", "5:SPRITE_B:in", "6:AFTER_C:in", "7:LAST_D:in"]);
  vm.stop();
});

test("the tools' runs at full speed load nothing at a choice, and SPFC / SPRD warm no picture in a run that shows nothing", async () => {
  let rows = 0;
  const { vm, asked, run } = machine({ onChoice: async () => { rows++; return 0; } });
  run([["STCH", "0", "BG_A", "240", "136"], ["FADS", "1", "0", "0"], ["SELR", "one"], ["SELD", "F100", "1"], ["SPFC", "1", "WARM_E"], ["SPRD", "2", "WARM_F"], ["END_"]]);
  vm.skip = true; vm.forceSkip = true; vm.skipPaced = false;   // the smoke test, fit.js, make_arcsave.mjs
  vm.loop(vm.generation);
  await turns();
  assert.equal(rows, 1, "the choice is answered by the tool");
  assert.deepEqual(asked, [], "and nothing was loaded for it, nor by SPFC / SPRD");
  vm.stop();
  // an instant run and a jump to a point pass SPFC / SPRD too; ordinary play and a restore still warm the picture
  const m = machine();
  Object.assign(m.vm, { _skip: true, instant: true });
  m.vm.op_SPFC("1", "WARM_E"); m.vm.op_SPRD("2", "WARM_F");
  assert.deepEqual(m.asked, []);
  Object.assign(m.vm, { instant: false, skipUntil: 50 });
  m.vm.op_SPFC("1", "WARM_E");
  assert.deepEqual(m.asked, []);
  Object.assign(m.vm, { _skip: false, skipUntil: 0 });
  m.vm.op_SPFC("1", "WARM_E"); m.vm.op_SPRD("2", "WARM_F");
  assert.deepEqual(m.asked, ["WARM_E", "WARM_F"]);
  Object.assign(m.vm, { _skip: true, instant: true, restoring: true });
  m.vm.op_SPFC("1", "WARM_G");
  assert.deepEqual(m.asked.at(-1), "WARM_G", "a restore is no such run");
});

test("a chain of read scenes does not wait at each stop: the RDAS after the stop runs first, and the next run starts with those pictures still out", async () => {
  const { vm, asked, run, finish } = machine();
  vm.fastForwardRead = false; vm.skipRead = true; vm.skipConfirm = false;
  vm.flow.completed.add(5);
  run([["STCC", "-1"], ["STCH", "0", "BG_ONE", "240", "136"], ["FADS", "1", "0", "0"], ["ATSV", "1"], ["RDAS", "5"], ["WTTM", "10"],
    ["STCH", "0", "BG_TWO", "240", "136"], ["FADS", "1", "0", "0"], ["ATSV", "1"], ["WTTM", "10"], ["WTTM", "10"]]);
  vm.beginInstant();
  vm.loop(vm.generation);
  // No picture is handed over until the end of this test: whatever the script gets to before then, it got to without waiting for one.
  assert.ok(await until(() => vm.pc >= 5), "the RDAS after the first stop has run with that stop's picture still out");
  assert.equal(asked[0], "BG_ONE");
  // the countdown (4 frames) and the next run, to the next stop
  assert.ok(await until(() => asked.length === 2 && !vm.instant && vm.pc === 9), "the next run went to its stop, the first stop's picture still out");
  assert.deepEqual(asked, ["BG_ONE", "BG_TWO"]);
  await turns();
  assert.equal(vm.pc, 9, "where the script now waits: this stop is one the player sees");
  assert.equal(vm.stopWaits, true);
  assert.equal(vm.holdingFrame, true);
  finish();
  assert.ok(await until(() => !vm.running), "and goes on once its pictures are in");
  assert.equal(vm.comingIn, null); assert.equal(vm.holdingFrame, false);
  vm.stop();
});

test("the script waits for a stop's pictures only where the stop is seen", () => {
  const { vm } = machine();
  assert.equal(vm.stopWaits, false, "ordinary play: nothing to wait for");
  vm.deferredPictures = true;
  assert.equal(vm.stopWaits, true, "a run has stopped with pictures still to load");
  vm.deferredPictures = false; vm.comingIn = Promise.resolve();
  assert.equal(vm.stopWaits, true, "or with pictures on their way");
  vm.sceneSkip = Promise.resolve();
  assert.equal(vm.stopWaits, false, "not while a read scene's skip counts down to the next run");
  vm.sceneSkip = null;
  Object.assign(vm, { _skip: true, instant: true });
  assert.equal(vm.stopWaits, false, "nor while a run that shows nothing goes on");
  Object.assign(vm, { instant: false, skipUntil: 40 });
  assert.equal(vm.stopWaits, false, "a jump to a point is such a run");
  // and the loop lets an RDAS straight after the stop go first (it may be about to pass this scene too)
  assert.equal((source("js/vm.js").match(/if \(this\.stopWaits && ops\[this\.pc\]\[0\] !== "RDAS"\) \{ await this\.loadDeferred\(\);/g) || []).length, 2, "before a command, and after a label's Z command");
});

test("with the question on, a read scene's \"Jump to Next Scene?\" is asked over the picture the last run stopped on", async () => {
  let asks = 0;
  const { vm, asked, run, finish } = machine({ onSceneSkip: async () => { asks++; return false; } });
  vm.fastForwardRead = false; vm.skipRead = true; vm.skipConfirm = true;
  vm.flow.completed.add(5);
  run([["STCC", "-1"], ["STCH", "0", "BG_ONE", "240", "136"], ["FADS", "1", "0", "0"], ["ATSV", "1"], ["RDAS", "5"], ["WTTM", "10"], ["WTTM", "10"]]);
  vm.beginInstant();
  vm.loop(vm.generation);
  await new Promise((r) => setTimeout(r, 120));   // (more than the frame the question waits before it comes up)
  assert.deepEqual(asked, ["BG_ONE"]);
  assert.equal(asks, 0, "not asked while the picture is out");
  finish();
  assert.ok(await until(() => asks === 1), "asked once it is in");
  vm.stop();
});

test("a story that stops in the middle of such a run leaves nothing to be loaded for it", () => {
  const { vm, asked } = machine();
  Object.assign(vm, { _skip: true, instant: true });
  const l = { id: 0, image: null, ready: null, promise: null };
  vm.setImage(l, "LEFT_BEHIND");
  vm.layers.set(0, l);
  assert.equal(vm.deferredPictures, true);
  vm.stop();              // a load, a rewind or Return to Title while the run goes on (restore() and toTitle() begin with it)
  vm.endInstant(false);   // restore()'s next line: it used to load the abandoned run's layers and hold the frame for them
  assert.deepEqual(asked, []);
  assert.equal(vm.holdingFrame, false); assert.equal(vm.comingIn, null); assert.equal(vm.stopWaits, false);
});

// The scene skip's black (main.js): the game lifts it 12 frames after the run, off a stop that is whole. Here the stop's pictures take what the
// device needs, so it stays until the run is over and they are in; lifting on its own count it showed the frame from before the run.
test("the scene skip's black does not lift while the run goes on or its stop's pictures are coming, and lifts as the game's does after", () => {
  const src = source("js/main.js");
  const body = src.slice(src.indexOf("let skipBlack = 0;"), src.indexOf("// A countdown of n frames"));
  const make = (vm) => {
    const black = { style: {} }, mode = { className: "", dataset: {}, classList: { contains: (c) => mode.className.includes(c), add: (...c) => { mode.className += ` ${c.join(" ")}`; } } };
    const api = new Function("$", "stage", "vm", "document", "moviesDone", `${body}\nreturn { countdownFrame, drawSkipBlack, level: () => skipBlack };`)(
      (id) => (id === "skip-black" ? black : id === "mode-skip" ? mode : null), { insertBefore() {} }, vm, { createElement: () => black }, vm.movie ? () => {} : null);
    return { ...api, black, frames: (n) => { for (let i = 0; i < n; i++) api.drawSkipBlack(); } };
  };
  // the game's own count, with nothing held: opaque 12 frames after the countdown's last, gone 25 later
  const plain = make({ instant: false, holdingFrame: false });
  plain.countdownFrame(0);
  assert.equal(plain.level(), 1.5);
  plain.frames(13);
  assert.equal(plain.black.style.opacity, "1", "still whole on the 13th frame");
  plain.frames(1);
  assert.ok(Number(plain.black.style.opacity) < 1, "lifting from the 14th");
  plain.frames(25);
  assert.equal(plain.level(), 0);
  // a run that goes on, then pictures that take 60 frames
  const vm = { instant: true, holdingFrame: false };
  const held = make(vm);
  held.countdownFrame(0);
  held.frames(40);
  assert.equal(held.level(), 1, "whole while the run goes on, however long");
  vm.instant = false; vm.holdingFrame = true;
  held.frames(60);
  assert.equal(held.level(), 1, "and while the stop's pictures are coming");
  assert.equal(held.black.style.opacity, "1");
  vm.holdingFrame = false;
  held.frames(1);
  assert.ok(Math.abs(held.level() - 0.96) < 1e-9, "then it lifts, 0.04 a frame");
  held.frames(25);
  assert.equal(held.level(), 0);
  // a run that stopped at a movie (TOMP): the black keeps the game's count, the movie is not kept waiting for the pictures under it
  const film = make({ instant: false, holdingFrame: true, movie: true });
  film.countdownFrame(0);
  film.frames(14);
  assert.ok(film.level() < 1, "lifting on the 14th frame as with nothing held");
  // a black already lifting is not brought back by a hold that starts then (a commit's pictures, a later stop)
  const late = make(vm);
  late.countdownFrame(0);
  late.frames(20);
  const at = late.level();
  assert.ok(at < 1 && at > 0);
  vm.holdingFrame = true;
  late.frames(1);
  assert.ok(late.level() < at);
  vm.holdingFrame = false;
});
