// The system menu's large pictures kept drawn by the page in the Android app (web/app/js/kept.js; the Odin Portal report, 2026-11-23).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { KeptArt, KEPT } = await import("../../web/app/js/kept.js");
const source = (name) => readFileSync(new URL(`../../web/app/${name}`, import.meta.url), "utf8");

// Canvases that record what was drawn into them, a fetch that answers or fails by path, and a decode that gives a picture of a set size.
function world({ missing = [] } = {}) {
  const made = [], fetched = [];
  const doc = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const listeners = {};
      const ctx = { drawn: [], lost: false, drawImage(from, x, y) { this.drawn.push([from, x, y]); }, clearRect() { this.drawn = []; }, isContextLost() { return this.lost; } };
      const c = { width: 0, height: 0, className: "", style: {}, isConnected: false, ctx, getContext: () => ctx,
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, fire(type) { for (const fn of listeners[type] || []) fn(); } };
      made.push(c);
      return c;
    },
  };
  const get = async (u) => { fetched.push(u); return { ok: !missing.some((m) => u.includes(m)), status: 404, blob: async () => ({ u }) }; };
  const decode = async (b) => ({ width: b.u.includes("menu_window") ? 312 : 1920, height: 1080, src: b.u, closed: false, close() { this.closed = true; } });
  return { made, fetched, doc, get, decode };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test("off (the site, the desktop app, iPhones): nothing is read and the menu makes its own sprites", async () => {
  const w = world();
  const k = new KeptArt({ on: false, ...w });
  await k.hold();
  assert.equal(w.fetched.length, 0);
  assert.equal(k.take("DISP_PARTS_JA/menuBG01_upscale", 0, 0), null);
});

test("on: each picture read once, drawn once into a canvas of its own size; until then take() gives null", async () => {
  const w = world();
  const k = new KeptArt({ on: true, url: (p) => `/assets/ui/${p}.webp`, ...w });
  assert.equal(k.take("DISP_PARTS_JA/menuBG01_upscale", 0, 0), null);
  const held = k.hold();
  assert.equal(k.take("DISP_PARTS_JA/menuBG01_upscale", 0, 0), null, "not before it has been drawn");
  await held;
  assert.equal(w.fetched.length, KEPT.length);
  assert.ok(w.fetched.includes("/assets/ui/MENU_PARTS_JA/menu_window.webp"));
  const c = k.take("MENU_PARTS_JA/menu_window", 18, 1, "x");
  assert.equal(c.width, 312); assert.equal(c.height, 1080);
  assert.equal(c.className, "sp x");
  assert.equal(c.style.cssText, "left:18px;top:1px;width:312px;height:1080px;");
  assert.equal(c.ctx.drawn.length, 1);
  await k.hold();
  assert.equal(w.fetched.length, KEPT.length, "held again: nothing read again");
});

test("the same canvas comes back once off the page; one still on the page gets a copy drawn from it", async () => {
  const w = world();
  const k = new KeptArt({ on: true, ...w });
  await k.hold(["DISP_PARTS_JA/menuBG01_upscale"]);
  const a = k.take("DISP_PARTS_JA/menuBG01_upscale", 0, 0);
  a.isConnected = true;
  const b = k.take("DISP_PARTS_JA/menuBG01_upscale", 0, 0);
  assert.notEqual(a, b);
  assert.equal(b.ctx.drawn[0][0], a, "copied from the kept canvas, not read again");
  assert.equal(w.fetched.length, 1);
  a.isConnected = false; b.isConnected = true;
  assert.equal(k.take("DISP_PARTS_JA/menuBG01_upscale", 5, 6), a);
  assert.equal(a.style.cssText, "left:5px;top:6px;width:1920px;height:1080px;", "placed afresh");
});

test("a picture that will not come is left to the page's own sprite", async () => {
  const w = world({ missing: ["menuBG04_0"] });
  const k = new KeptArt({ on: true, ...w });
  await k.hold();
  assert.equal(k.take("DISP_PARTS_JA/menuBG04_0_upscale", 0, 0), null);
  assert.ok(k.take("DISP_PARTS_JA/menuBG04_1_upscale", 0, 0));
});

test("a lost context: none handed out while lost; restored, the picture is read and drawn again into its canvases", async () => {
  const w = world();
  const k = new KeptArt({ on: true, ...w });
  await k.hold(["DISP_PARTS_JA/menuBG01_upscale"]);
  const a = k.take("DISP_PARTS_JA/menuBG01_upscale", 0, 0);
  a.ctx.lost = true;
  assert.equal(k.take("DISP_PARTS_JA/menuBG01_upscale", 0, 0), null);
  a.ctx.lost = false;
  a.ctx.drawn = [];
  a.fire("contextrestored");
  assert.equal(k.take("DISP_PARTS_JA/menuBG01_upscale", 0, 0), null, "not while it is being drawn again");
  await settle(); await settle(); await settle();
  assert.equal(w.fetched.length, 2);
  assert.equal(a.ctx.drawn.length, 1);
  assert.equal(k.take("DISP_PARTS_JA/menuBG01_upscale", 0, 0), a);
});

test("only the Android app holds them, and the menu takes them where it drew those sprites", () => {
  const kept = source("js/kept.js"), ui = source("js/ui.js"), main = source("js/main.js");
  assert.match(kept, /on = APP === "android"/);
  for (const [pack, name] of [["DISP_PARTS_JA", "menuBG01_upscale"], ["MENU_PARTS_JA", "system_titlebg"], ["MENU_PARTS_JA", "system_scenebg"], ["MENU_PARTS_JA", "menu_window"]]) {
    assert.ok(KEPT.includes(`${pack}/${name}`));
    assert.match(ui, new RegExp(`picture\\("${pack}", "${name}"`));
  }
  assert.match(ui, /const el = picture\("DISP_PARTS_JA", name, 0, 0, 0, 0\)/);
  assert.match(main, /function holdMenuPictures\(\) \{\n  if \(!menuPictures\.on\) return;/);
  assert.match(main, /await openHome\(ui, \{ started: gameStarted \}\);\n  holdMenuPictures\(\);/);
});
