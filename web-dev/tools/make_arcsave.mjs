#!/usr/bin/env node
// make_arcsave.mjs: writes web/app/js/arcsave.js, the progress of a game in which Arcueid's route has been played to its end, for SAVE DATA's
// "Start Ciel route" (home.js). Ciel's route opens once Arcueid's has been finished: 14_00_ARC14_1, the route's last scene, sets G003, and
// 03_00_ARC03_5B's last choice keeps its second row ("No... this is the reality I have wrought.", into 03_01_CIEL03_3_2) locked until it is set.
//
// Nobody had such a save, so this one is made by playing the route: the port's own engine (web/app/js/vm.js) runs the story with nothing drawn or
// heard, from a new profile, as a first-time player would: the opening (00_01), the title's first launch, then the story (START_SCRIPT) to the end
// of Arcueid's route and the Ciel-sensei episode it leads to, and back to the title. Whatever the game records on the way is recorded as it is in
// play: the scenes started and completed and the chart's lines (the globals), the pictures seen, the music heard, the opening movie, the read marks,
// the voices' rows. A choice takes its first row that is not locked; a row that ends in a bad end (the story reaching QACALL, the Ciel-sensei
// corner, from any script but the route's last) is taken back and the next tried. The rows taken are printed and checked against ROUTE below,
// so that a change in the engine that sends the run elsewhere is noticed.
//
// The progress is turned into the game's own save file by gamesave.js (writeSystem: the game's first config, no records), and its system data
// alone (0x1740 bytes) is kept, as fullsave.js keeps the 100% save's. It is checked to be part of the 100% save (data/tsuki/reference-saves:
// nothing a full game does not have), and G003 to be set.
//
//   node web-dev/tools/make_arcsave.mjs            (from the port's root; about a minute)
//   node web-dev/tools/make_arcsave.mjs --search   (ignore ROUTE and find the rows again)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(ROOT, "web");
const FULL = path.join(ROOT, "data/tsuki/reference-saves/discord-2026-11-07/savedata000");
const OUT = path.join(WEB, "app/js/arcsave.js");
// The rows taken at each choice of the run, in order (found with --search on 2026-11-21: six tries, the first five ending in bad ends on days 4,
// 5 and 10). Mostly each choice's first row; 16, 20, 21, 23 and 45 take their second.
const ROUTE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0];

// ---- a browser with nothing in it ----
class Memory {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
const storage = new Memory();
const el = () => ({ innerHTML: "", textContent: "", style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {}, append() {}, remove() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
globalThis.document = { getElementById: el, createElement: el, querySelector: el, querySelectorAll: () => [], body: el(), documentElement: el(), addEventListener() {} };
globalThis.localStorage = storage;
globalThis.sessionStorage = new Memory();
globalThis.window = globalThis;
globalThis.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 0);
const files = new Map();
globalThis.fetch = async (url) => {
  const p = path.join(WEB, String(url).split("?")[0]);
  if (!files.has(p)) files.set(p, fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
  const body = files.get(p);
  return { ok: body !== null, status: body === null ? 404 : 200, json: async () => JSON.parse(body), text: async () => body };
};

const { VM } = await import(path.join(WEB, "app/js/vm.js"));
const { Audio } = await import(path.join(WEB, "app/js/audio.js"));
const { STORY_MOVIES, nextTitleStage } = await import(path.join(WEB, "app/js/uifx.js"));
const { exportSaves, importSaves } = await import(path.join(WEB, "app/js/savefile.js"));
const { GAME, readSystem } = await import(path.join(WEB, "app/js/gamesave.js"));

const noop = () => {};
const stub = (base) => new Proxy(base, {
  get(t, k) { if (k in t) return t[k]; if (typeof k === "symbol") return undefined; return noop; },
  set(t, k, v) { t[k] = v; return true; },
});
// the voice rows: the game's own lookup (audio.js), which VPLY's "heard" bit needs
const voices = { speakerOf: Audio.prototype.speakerOf, rowOf: Audio.prototype.rowOf, characterOf: Audio.prototype.characterOf };

class DeadEnd extends Error {}
class Stop extends Error { constructor(at, locked) { super(`stopped at ${at}`); this.at = at; this.locked = locked; } }

// One play. rows: the rows to take at the first choices; past them, each choice takes its first row that is not locked. From a new profile,
// or with seed (a save's system data as gamesave.js reads it) loaded as SAVE DATA loads one, and then New Game. pick(script, list): a row of
// its own for a choice, or undefined; it may throw Stop to end the play there.
// Resolves with { ok, failed, stopped, choices: [{ at, rows, locked, took }], vm }.
async function play(rows, { seed = null, pick = () => undefined } = {}) {
  storage.clear();
  if (seed) importSaves(seed, storage, { keepSettings: true });
  const text = stub({ typing: false, pageParts: [], intro: false, rate: 0, pagePending: false, closed: false, speed: 0,
    logged: 0, history: [], charFade: 0, clear() { this.pageParts = []; } });
  const audio = stub({ voicePlaying: false, voices: null, seLoops: {}, musicLoops: {}, table: null, ctx: null, vol: { bgm: 1 },
    snapshot: () => ({}), voiceDone: () => Promise.resolve(), ...voices });
  const gfx = stub({ load: async () => ({ tex: null, w: 2, h: 2, nw: 2, nh: 2 }), tex: new Map(), images: null, hazes: undefined,
    hazeTable: null, effects: null, focusLines: null, split: null, lines: null, shake: null, textShake: null, fade: null });
  const vm = new VM({ gfx, text, audio });
  await vm.init();
  // full speed, through text not read yet, as the smoke test runs (fast forward on "Full")
  vm.skip = true; vm.skipPaced = false; vm.fastForwardRead = false;
  const QACALL = vm.index.names.indexOf("QACALL"), LAST = vm.index.names.indexOf("14_00_ARC14_1");
  const choices = [];
  let failed = null, stopped = null;
  vm.onChoice = async (list) => {
    const n = choices.length, open = list.map((r, i) => (r.locked ? -1 : i)).filter((i) => i >= 0);
    const took = pick(vm.script.name, list) ?? (n < rows.length ? rows[n] : open[0]);
    if (list[took]?.locked || took === undefined) throw new DeadEnd(`row ${took} of choice ${n} cannot be taken`);
    choices.push({ at: `${vm.script.name}:${vm.pc - 1}`, rows: list.length, locked: list.map((r) => !!r.locked), took });
    return took;
  };
  vm.onConfirm = async () => true;   // the Ciel-sensei corner after the ending: watched
  vm.onAskSave = null;
  // a story movie counts as seen once it has played (main.js playMovie's finish): G005's bit for the opening songs, and the gallery's list
  vm.playMovie = (name, opts = {}) => {
    const rule = opts.story ? STORY_MOVIES[opts.number] : null;
    if (rule) vm.setVar("G005", vm.getVar("G005") | (1 << rule[0]));
    if (opts.story) { vm.unlocks.watched(name); vm.unlocks.save(); }
    return Promise.resolve();
  };
  const jump = vm.op_JUMP;
  vm.op_JUMP = async function (id, label) {
    if (this.index.jump[id] === QACALL && this.scriptIndex !== LAST) throw new DeadEnd(`bad end in ${this.script.name}`);
    return jump.call(this, id, label);
  };
  // a script's end goes back to the title (main.js vm.onEnd); main.js startAt's setup for each start
  const run = (i) => new Promise((done, fail) => {
    const original = console.error;
    console.error = (...a) => {
      const end = a.find((x) => x instanceof DeadEnd || x instanceof Stop);
      if (!end) { original(...a); return; }
      if (end instanceof Stop) stopped = end; else failed = end.message;
      console.error = original;
      vm.stop();
      done();
    };
    vm.onEnd = () => { console.error = original; done(); };
    vm.flow.resetPath();
    vm.layers.clear(); vm.pending.clear(); vm.removed.clear();
    vm.vars = {};
    if (i !== vm.index.start) { vm.vars.F026 = 1; vm.vars.F822 = 1; }
    vm.start(i).catch(fail);
  });
  // the opening (00_01), then the first launch's title (ui.js title: G002 = 0, G010 = 1), then the story; with a save loaded, New Game
  if (!seed) {
    await run(vm.index.names.indexOf("00_01"));
    vm.setVar("G002", 0);
    vm.setVar("G010", 1);
  }
  if (!failed) await run(vm.index.start);
  if (stopped) return { ok: false, stopped, choices, vm };
  // back on the title, which moves its stage on (ui.js titleStageNow): 1 once Arcueid's ending (560) has started
  vm.setVar("G002", nextTitleStage(vm.getVar("G002"), vm.flow.started));
  vm.saveRead(); vm.unlocks.save(); vm.flow.save(); vm.saveGlobals();
  return { ok: !failed && vm.getVar("G003") === 1, failed, choices, vm };
}

// Depth first: the rows taken so far, the last choice with a row left to try moved on after a dead end.
async function search(start = []) {
  let rows = start;
  for (let tries = 1; tries < 400; tries++) {
    const r = await play(rows);
    const taken = r.choices.map((c) => c.took);
    console.log(`try ${tries}: ${r.ok ? "finished" : r.failed || "ended without G003"} after ${r.choices.length} choices`);
    if (r.ok) return r;
    let k = r.choices.length - 1;
    for (; k >= 0; k--) {
      const c = r.choices[k];
      const next = c.locked.findIndex((l, i) => i > c.took && !l);
      if (next >= 0) { rows = [...taken.slice(0, k), next]; break; }
    }
    if (k < 0) throw Error("no row of any choice reaches the end of Arcueid's route");
  }
  throw Error("too many tries");
}

const searching = process.argv.includes("--search") || !ROUTE;
const result = searching ? await search() : await play(ROUTE);
if (!result.ok) throw Error(`the route did not finish: ${result.failed || "G003 not set"}`);
const took = result.choices.map((c) => c.took);
console.log("rows taken:", JSON.stringify(took));
for (const c of result.choices) console.log(`  ${c.at}: row ${c.took} of ${c.rows}${c.locked.some(Boolean) ? ` (locked: ${c.locked.map((l, i) => (l ? i : null)).filter((i) => i !== null)})` : ""}`);
if (ROUTE && JSON.stringify(ROUTE) !== JSON.stringify(took)) throw Error(`the run took other rows than ROUTE: ${JSON.stringify(took)}`);

// ---- the save ----
const vm = result.vm;
const file = exportSaves(storage, null, vm.gallery?.seen || null);
const sys = readSystem(file);
const system = file.slice(0, GAME.system);
// part of the 100% save: every bit it sets is set there too, and no read mark is higher
if (fs.existsSync(FULL)) {
  const full = readSystem(new Uint8Array(fs.readFileSync(FULL)));
  const extra = (k) => sys.flow[k].filter((n) => !full.flow[k].includes(n));
  const problems = [];
  for (const k of ["started", "completed", "secondary"]) if (extra(k).length) problems.push(`${k}: ${extra(k).join(" ")}`);
  const seenExtra = sys.seen.filter((b) => !full.seen.includes(b)), musicExtra = sys.music.filter((n) => !full.music.includes(n));
  if (seenExtra.length) problems.push(`pictures: ${seenExtra.join(" ")}`);
  if (musicExtra.length) problems.push(`music: ${musicExtra.join(" ")}`);
  // G002 is the title's stage, which a finished game has moved further; G010 the first launch's flag, which the port's title and 00_00 set (the
  // 100% save has it clear)
  for (const [g, v] of Object.entries(sys.globals)) if (g !== "G002" && g !== "G010" && ((full.globals[g] || 0) & v) !== v) problems.push(`${g} = ${v} (100% save: ${full.globals[g] || 0})`);
  if (problems.length) throw Error("not in the 100% save:\n  " + problems.join("\n  "));
  console.log("its scenes, chart lines, pictures, music and globals are all in the 100% save too");
  // The read marks are not compared as a rule: that save numbers some messages' blocks two lower than the port's scripts do (its 00_00 read to
  // 255 / 133 in blocks 22 / 23, the port's 00_00 to 255 / 132 in blocks 24 / 25), so about 45 blocks are higher here. The native PC build,
  // run on this folder's own game files, numbers them as the port does (data/tsuki/user/savedata000.before-100-percent.2026-11-08 has 00_00 at
  // 255 / 132 in blocks 24 / 25), so the difference is that save's game's, not the port's. (Japanese's own scripts, which Chinese shares: every
  // message of the 70 the route read whole counts as read with this save too.)
  const readHigher = [...sys.readBlocks.keys()].filter((i) => sys.readBlocks[i] > full.readBlocks[i]);
  console.log(`read marks: ${readHigher.length} blocks higher than the 100% save's (block numbering, see above)`);
}
if (sys.globals.G003 !== 1) throw Error("G003 is not set");
const blocks = sys.readBlocks.filter((b) => b).length;
console.log(`scenes started ${sys.flow.started.length}, completed ${sys.flow.completed.length}, chart lines ${sys.flow.secondary.length}, pictures ${sys.seen.length}, ` +
  `music ${sys.music.length}, movies ${sys.movies.join(" ") || "none"}, read blocks ${blocks}, globals ${JSON.stringify(sys.globals)}`);

// It opens Ciel's route: a New Game from it, lunch on day 3 in the tea ceremony room (03_00_ARC03_4's third row, which sets F057 in
// 03_01_CIEL03_2_3), comes to 03_00_ARC03_5B's last choice with its second row ("No... this is the reality I have wrought.") open; from a new
// profile the same play finds it locked.
const toCiel = (name, list) => {
  if (name === "03_00_ARC03_4") return 2;
  if (name === "03_00_ARC03_5B") throw new Stop(name, list.map((r) => !!r.locked));
  return undefined;
};
const withSave = await play([], { seed: sys, pick: toCiel }), without = await play([], { pick: toCiel });
for (const [r, what] of [[withSave, "with the save"], [without, "from a new profile"]]) if (!r.stopped) throw Error(`${what}, the play did not reach 03_00_ARC03_5B's choice: ${r.failed || "it ended"}`);
if (withSave.stopped.locked[1] || !without.stopped.locked[1]) throw Error(`Ciel's row: locked ${withSave.stopped.locked[1]} with the save, ${without.stopped.locked[1]} without`);
console.log("Ciel's route: 03_00_ARC03_5B's second row is open with the save, locked from a new profile");

const b64 = Buffer.from(system).toString("base64");
const lines = [];
for (let i = 0; i < b64.length; i += 160) lines.push(`  "${b64.slice(i, i + 160)}",`);
fs.writeFileSync(OUT, `// arcsave.js - a game with Arcueid's route finished, for SAVE DATA's "Start Ciel route" (home.js). Written by web-dev/tools/make_arcsave.mjs, which
// plays the route through the port's engine from a new profile (no bad ends) and keeps what that leaves in the save's system data: the globals with
// G003 (Arcueid's route finished, which opens Ciel's) and the flowchart's bits, the pictures seen and music heard, the read marks; the game's first
// config, no records.
import { GAME } from "./gamesave.js";

const SYSTEM = [
${lines.join("\n")}
].join("");

// The save as a file of the game's size: the system data, and 140 empty records.
export function arcSaveFile() {
  const file = new Uint8Array(GAME.size), system = atob(SYSTEM);
  for (let i = 0; i < system.length; i++) file[i] = system.charCodeAt(i);
  return file;
}
`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${b64.length} characters of base64 for ${system.length} bytes)`);
process.exit(0);
