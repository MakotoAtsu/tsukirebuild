// Replays every script headless (as the 2026-11-07 replay harness does) with the page's own look-ahead (preload.js), and runs the
// renderer's picture cache (load / evict) and audio.js's decoded-sound cache (buffer / trim) on simulated sizes, at one budget pair.
// node web-dev/tools/cachesim.mjs <pictureMB> <soundMB> [maxSide] -> one JSON line last on stdout (about 75 s; FIXES.md, 2026-11-21)
import fs from "node:fs";
const WEB = decodeURIComponent(new URL("../../web", import.meta.url).pathname);   // (needs web/assets: images.json, the sounds and packs)
const JS = `${WEB}/app/js`;
const PIC_MB = Number(process.argv[2]), SND_MB = Number(process.argv[3]), MAX_SIDE = Number(process.argv[4] || 8192);
const MB = 1024 * 1024;
const PIC_LIMIT = PIC_MB * MB, SND_LIMIT = SND_MB * MB;

const el = () => ({ innerHTML: "", textContent: "", style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
globalThis.document = { getElementById: el, createElement: el, querySelector: el, querySelectorAll: () => [], body: el(), addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
globalThis.fetch = async (url) => {
  const p = WEB + String(url).split("?")[0];
  const ok = fs.existsSync(p);
  return { ok, json: async () => JSON.parse(fs.readFileSync(p, "utf8")), text: async () => fs.readFileSync(p, "utf8") };
};
const { VM, WAITS } = await import(`${JS}/vm.js`);
const { Preloader } = await import(`${JS}/preload.js`);
const { streamOf } = await import(`${JS}/audio.js`);
const { FlowProgress } = await import(`${JS}/flowchart-model.js`);
const { Unlocks } = await import(`${JS}/unlocks.js`);

// ---- decoded sound sizes, from the files: samples x channels x 4 at 48 kHz (decodeAudioData resamples to the context's rate) ----
const packIdx = (() => {
  const top = JSON.parse(fs.readFileSync(`${WEB}/assets/pack/index.json`, "utf8"));
  const list = JSON.parse(fs.readFileSync(`${WEB}/assets/pack/${top.index}`, "utf8")), files = new Map();
  for (const [pack, items] of list.packs) { let at = 0; for (let i = 0; i < items.length; i += 2) { files.set(items[i], [pack, at, items[i + 1]]); at += items[i + 1]; } }
  return files;
})();
function oggBytes(buf) {
  let ch = 2, rate = 48000, opus = false, preskip = 0;
  const v = buf.indexOf("\x01vorbis", 0, "latin1");
  if (v >= 0 && v < 4096) { ch = buf[v + 11]; rate = buf.readUInt32LE(v + 12); }
  else { const o = buf.indexOf("OpusHead", 0, "latin1"); if (o >= 0) { opus = true; ch = buf[o + 9]; preskip = buf.readUInt16LE(o + 10); rate = 48000; } }
  let g = 0;
  for (let i = buf.length - 27; i >= 0; i--) {
    if (buf[i] === 0x4f && buf[i + 1] === 0x67 && buf[i + 2] === 0x67 && buf[i + 3] === 0x53) { g = Number(buf.readBigUInt64LE(i + 6)); break; }
  }
  const samples = opus ? g - preskip : g;
  return Math.ceil((samples * 48000) / rate) * ch * 4;
}
const sizeCache = new Map();
function soundSize(url) {
  if (sizeCache.has(url)) return sizeCache.get(url);
  const rel = decodeURIComponent(url.slice(8, -4));
  let buf = null;
  const loose = `${WEB}/assets/${rel}.ogg`;
  if (fs.existsSync(loose)) buf = fs.readFileSync(loose);
  else {
    const hit = packIdx.get(rel);
    if (hit) { const fd = fs.openSync(`${WEB}/assets/pack/${hit[0]}`, "r"); buf = Buffer.alloc(hit[2]); fs.readSync(fd, buf, 0, hit[2], hit[1]); fs.closeSync(fd); }
  }
  const n = buf ? oggBytes(buf) : null;
  sizeCache.set(url, n);
  return n;
}

// ---- the picture cache: renderer.js load / evict, uploads at once ----
let clock = 0;
const P = { misses: 0, hits: 0, decodedBytes: 0, peak: 0, livePeak: 0, perScript: {}, withinRe: 0, withinReBytes: 0, fill: {} };
let curScript = "", seenHere = new Set(), elapsed = 0, msgs = 0, T = 1000;
const gfx = new Proxy({
  images: null, tex: new Map(), bytes: 0, ui: new Map(), uiTexture() {}, ruleSlot: null,
  load(name) {
    const key = String(name).toUpperCase();
    const hit = this.tex.get(key);
    if (hit) { hit.used = ++clock; P.hits++; return Promise.resolve(hit); }
    const info = this.images?.[key];
    if (!info) return Promise.reject(new Error(`no image ${key}`));
    const by = Math.max(1, info[0] / MAX_SIDE, info[1] / MAX_SIDE);
    const w = Math.max(1, Math.floor(info[0] / by)), h = Math.max(1, Math.floor(info[1] / by));
    const e = { used: ++clock, tex: {}, w, h, nw: info[0], nh: info[1], bytes: w * h * 4 };
    this.tex.set(key, e);
    this.bytes += e.bytes;
    P.misses++; P.decodedBytes += e.bytes;
    (P.perScript[curScript] ||= { m: 0, b: 0, re: 0 }).m++; P.perScript[curScript].b += e.bytes;
    if (seenHere.has(key)) { P.withinRe++; P.perScript[curScript].re++; P.withinReBytes += e.bytes; }
    seenHere.add(key);
    P.peak = Math.max(P.peak, this.bytes);
    const now = elapsed + (T - 1000);
    for (const th of [300, 500, 700, 1000, 1400]) if (this.bytes >= th * MB && P.fill[th] === undefined) P.fill[th] = { min: Math.round(now / 600) / 100, msgs };
    const live = this.liveNames();
    let lb = 0; for (const k of live) lb += this.tex.get(k)?.bytes || 0;
    P.livePeak = Math.max(P.livePeak, lb);
    this.evict();
    return Promise.resolve(e);
  },
  liveNames() {
    const live = new Set();
    for (const l of this.inUse?.() || []) { if (l.image) live.add(String(l.image).toUpperCase()); if (l.rule?.name) live.add(l.rule.name); }
    if (this.ruleSlot) live.add(this.ruleSlot);
    return live;
  },
  evict() {
    if (this.bytes < PIC_LIMIT) return;
    const live = this.liveNames();
    const old = [...this.tex.entries()].filter(([k]) => !live.has(k)).sort((a, b) => a[1].used - b[1].used);
    for (const [k, v] of old) { if (this.bytes < PIC_LIMIT * 0.8) break; this.bytes -= v.bytes; this.tex.delete(k); }
  },
  hazes: undefined, hazeTable: null, effects: null, focusLines: null, split: null, lines: null, shake: null, textShake: null, fade: null,
}, { get(t, k) { if (k in t) return t[k]; if (typeof k === "symbol") return undefined; return () => {}; }, set(t, k, v) { t[k] = v; return true; } });

// ---- the sound cache: audio.js buffer / trim; what plays stays (the music, the one fading out, looping effects, the voice) ----
const S = { misses: 0, hits: 0, decodedBytes: 0, peak: 0, bgmMisses: 0, bgmRe: 0, seen: new Set(), unknown: 0 };
const SOUNDS_KEPT = 80;
const audio = new Proxy({
  muted: false, buffers: new Map(), sizes: new Map(), ctx: null, table: null, seLoops: {}, musicLoops: {}, voices: {},
  bgm: null, bgmOld: null, bgmState: null, loopsOn: new Map(), voiceNow: null, voicePlaying: false,
  buffer(url) {
    if (this.buffers.has(url)) { this.buffers.delete(url); this.buffers.set(url, true); S.hits++; return Promise.resolve({}); }
    const n = soundSize(url);
    if (n == null) { S.unknown++; return Promise.reject(new Error(`no audio ${url}`)); }
    this.buffers.set(url, true); this.sizes.set(url, n);
    S.misses++; S.decodedBytes += n;
    if (url.startsWith("/assets/bgm/")) { S.bgmMisses++; if (S.seen.has(url)) S.bgmRe++; }
    S.seen.add(url);
    this.trim();
    let b = 0; for (const v of this.sizes.values()) b += v; S.peak = Math.max(S.peak, b);
    return Promise.resolve({});
  },
  trim(budget = SND_LIMIT) {
    let bytes = 0; for (const v of this.sizes.values()) bytes += v;
    if (bytes <= budget && this.buffers.size <= SOUNDS_KEPT) return;
    const playing = new Set([this.bgm, this.bgmOld, this.voiceNow, ...this.loopsOn.values()].filter(Boolean));
    for (const url of [...this.buffers.keys()]) {
      if (bytes <= budget && this.buffers.size <= SOUNDS_KEPT) break;
      if (playing.has(url)) continue;
      this.buffers.delete(url); bytes -= this.sizes.get(url); this.sizes.delete(url);
    }
  },
  playBGM(n) {
    n = Number(n);
    if (n < 0) { this.bgmOld = this.bgm; this.bgm = null; this.bgmState = null; return; }
    if (this.bgmState && this.bgmState.n === n) return;
    const name = streamOf(this.table, n);
    if (!name) return;
    this.bgmOld = this.bgm;
    this.bgm = `/assets/bgm/${name}.ogg`;
    this.bgmState = { n };
    return this.buffer(this.bgm).catch(() => {});
  },
  stopBGM() { this.bgmOld = this.bgm; this.bgm = null; this.bgmState = null; },
  fadeBGM() {},
  playSE(ch, loop, name) {
    if (!name) return;
    const url = `/assets/se/${encodeURIComponent(String(name).toUpperCase())}.ogg`;
    if (loop) this.loopsOn.set(ch, url); else this.loopsOn.delete(ch);
    return this.buffer(url).catch(() => {});
  },
  stopSE(ch) { this.loopsOn.delete(ch); },
  playVoice(name) { this.voiceNow = `/assets/voice/${encodeURIComponent(name)}.ogg`; this.buffer(this.voiceNow).catch(() => {}); return Promise.resolve(); },
  stopVoice() { this.voiceNow = null; },
  voiceDone: () => Promise.resolve(), snapshot: () => ({}), characterOf: () => -1, voiceOff: () => false,
}, { get(t, k) { if (k in t) return t[k]; if (typeof k === "symbol") return undefined; return () => {}; }, set(t, k, v) { t[k] = v; return true; } });

const text = new Proxy({ typing: false, pageParts: [], intro: false, rate: 0, pagePending: false, closed: false, windows: [], state: {}, speed: 0,
  logged: [], charFade: 0, clear() { this.pageParts = []; } }, { get(t, k) { if (k in t) return t[k]; if (typeof k === "symbol") return undefined; return () => {}; }, set(t, k, v) { t[k] = v; return true; } });

const vm = new VM({ gfx, text, audio });
await vm.init();
vm.saveGlobals = () => {};
vm.flow = new FlowProgress(null);
vm.unlocks = new Unlocks(null);
vm.onChoice = async () => 0;
vm.onAskSave = null;
vm.clock.now = () => T;
vm.clock.pause = () => {};
vm.sleep = async (ms) => { if (ms > 0) T += ms; };
const GLOBALS0 = JSON.stringify(vm.globals || {});
const pre = new Preloader({ vm, gfx, audio, page: null, Picture: null, fonts: { story: [], menus: [] } });
vm.ahead = (script, pc) => pre.ahead(script, pc);
const settle = () => new Promise((r) => setTimeout(r, 0));
vm.op_MSG = async function () { this.preloadFrom(this.pc); this.startPendingVoice?.(); T += 3000; msgs++; await settle(); };
vm.op_MSAD = vm.op_MSG;
vm.op_WTTM = async function (ms) { T += Number(ms) || 0; await settle(); };
for (const k of ["VCWT", "TOMW", "RDAS", "SELA", "MVPL", "MVP2"]) vm[`op_${k}`] = async function () {};

const names = vm.index.names;
const errors = {};
async function runScript(i) {
  T = 1000;
  vm.layers.clear(); vm.pending.clear(); vm.removed.clear();
  vm.ghosts?.clear?.();
  vm.clearAnimations?.();
  for (const h of vm.hazes || []) if (h) { h.n = 0; h.next = 0; }
  vm.staged = false;
  vm.motions?.clear?.();
  vm.vars = { F026: 1 };
  vm.globals = JSON.parse(GLOBALS0);
  pre.last = null;
  await vm.enter(i);
  let steps = 0;
  const start = vm.script;
  while (vm.script === start && vm.pc < vm.script.ops.length && steps < 200000) {
    const op = vm.script.ops[vm.pc++];
    steps++;
    T += 1;
    const fn = vm[`op_${op[0]}`];
    if (!fn) continue;
    try {
      if (WAITS.has(op[0])) await vm.settle();
      const r = fn.apply(vm, op.slice(1));
      if (r && r.then) {
        let timer;
        const hung = new Promise((res) => { timer = setTimeout(() => res("hung"), 3000); });
        const w = await Promise.race([r.then(() => "ok"), hung]);
        clearTimeout(timer);
        if (w === "hung") { const k = `hung ${op[0]}`; errors[k] = (errors[k] || 0) + 1; }
      }
    } catch (e) { const k = `${op[0]} ${e.message}`.slice(0, 80); errors[k] = (errors[k] || 0) + 1; }
  }
  await vm.settle();
  await pre.idle();
  elapsed += T - 1000;
}
const t0 = Date.now();
for (let i = 0; i < names.length; i++) { curScript = names[i]; seenHere = new Set(); await runScript(i); }
console.log(JSON.stringify({ pic: PIC_MB, snd: SND_MB, maxSide: MAX_SIDE, secs: (Date.now() - t0) / 1000,
  P: { ...P, perScript: undefined }, perScript: P.perScript,
  S: { misses: S.misses, hits: S.hits, decodedMB: S.decodedBytes / MB, peakMB: S.peak / MB, bgmMisses: S.bgmMisses, bgmRe: S.bgmRe, unknown: S.unknown, unique: S.seen.size },
  errors: Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 12) }));
process.exit(0);
