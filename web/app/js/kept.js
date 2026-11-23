// kept.js - the system menu's large pictures, kept drawn by the page itself, in the Android app only.
// The Android System WebView lets go of a picture's decoded copy some 20 to 30 seconds after the picture has left the screen, where Chrome keeps it:
// the menu's pictures (about 35 MB at full size) were decoded again at nearly every opening, and the menu came up late and stuttering, by button or
// by touch (an AYN Odin 2 Portal, 2026-11-23; the Android 17 emulator's WebView, the menu opened again after 30 s: 19 pictures decoded, against none
// in its Chrome). There the large ones are canvases, each drawn once from the picture decoded away from the page's thread, and the same canvas is
// put back at the next opening: nothing is decoded or uploaded again. Everywhere else (the site, the desktop app, iPhones) nothing here is used.
import { APP } from "./apphost.js";

// Pictures the menus show whole and never shift: the sky and its eight bands (ui.js menuBackground), the header's two bands and the column's window.
// The buttons and the cursor change which part of their sheet shows (background-position) and stay as they were.
export const KEPT = [
  "DISP_PARTS_JA/menuBG01_upscale",
  ...["04_0", "04_1", "04_2", "04_3", "05_0", "05_1", "05_2", "05_3"].map((n) => `DISP_PARTS_JA/menuBG${n}_upscale`),
  "MENU_PARTS_JA/system_titlebg", "MENU_PARTS_JA/system_scenebg", "MENU_PARTS_JA/menu_window",
];

export class KeptArt {
  // url(path): the address of a picture; get, decode, doc: for tests.
  constructor({ on = APP === "android", url = (p) => `/assets/ui/${p}.webp`, get = (u) => fetch(u), decode = (b) => createImageBitmap(b), doc = globalThis.document } = {}) {
    this.on = on;
    this.url = url;
    this.get = get;
    this.decode = decode;
    this.doc = doc;
    this.pool = new Map();   // path -> { w, h, canvases, ready, filling }
  }

  // Reads each picture and draws it once. Resolves when all have been tried; one that will not come is left to the page's own picture.
  hold(paths = KEPT) {
    if (!this.on) return Promise.resolve();
    return Promise.all(paths.map((p) => this.holdOne(p)));
  }

  holdOne(path) {
    if (this.pool.has(path)) return this.pool.get(path).ready;
    const e = { w: 0, h: 0, canvases: [], ready: null, filling: true };
    this.pool.set(path, e);
    e.ready = this.read(path).then((bmp) => {
      e.w = bmp.width; e.h = bmp.height;
      e.canvases.push(this.canvas(path, e, bmp));
      bmp.close?.();
      e.filling = false;
    }).catch(() => { this.pool.delete(path); });
    return e.ready;
  }

  async read(path) {
    const r = await this.get(this.url(path));
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return this.decode(await r.blob());
  }

  canvas(path, e, from) {
    const c = this.doc.createElement("canvas");
    c.width = e.w; c.height = e.h;
    c.getContext("2d").drawImage(from, 0, 0);
    // A lost GPU context comes back with the canvas blank: the picture is read and drawn into its canvases again, and none is handed out meanwhile.
    c.addEventListener?.("contextrestored", () => this.refill(path));
    return c;
  }

  refill(path) {
    const e = this.pool.get(path);
    if (!e || e.filling) return;
    e.filling = true;
    this.read(path).then((bmp) => {
      for (const c of e.canvases) { const g = c.getContext("2d"); g.clearRect(0, 0, e.w, e.h); g.drawImage(bmp, 0, 0); }
      bmp.close?.();
      e.filling = false;
    }).catch(() => { this.pool.delete(path); });
  }

  // A canvas with the picture, at (x, y) on the stage at its own size, with the sprite's class and `cls`; null where the picture is not held (the
  // caller makes its own sprite, as before). One already on the page (two backgrounds at once: the gallery's over the title's) gets a copy.
  take(path, x, y, cls = "") {
    const e = this.on ? this.pool.get(path) : null;
    if (!e || e.filling || !e.canvases.length) return null;
    const lost = (k) => !!k.getContext("2d").isContextLost?.();
    if (e.canvases.every(lost)) return null;
    let c = e.canvases.find((k) => !k.isConnected && !lost(k));
    if (!c) {
      c = this.canvas(path, e, e.canvases.find((k) => !lost(k)));
      e.canvases.push(c);
    }
    c.className = `sp ${cls}`;
    c.style.cssText = `left:${x}px;top:${y}px;width:${e.w}px;height:${e.h}px;`;
    return c;
  }
}
