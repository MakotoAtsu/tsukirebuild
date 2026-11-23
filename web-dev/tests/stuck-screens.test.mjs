// Faults reported 2026-11-23 and reproduced in the browser: a window or a notice that left the screen under it without its keys,
// its items or its Back, and a sound system left closed. (The version's part is in app-update.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeContext, withContext } from "./fake-audio.mjs";

const ui = readFileSync(new URL("../../web/app/js/ui.js", import.meta.url), "utf8");

test("the system's question over an open screen gives the screen its items and its Back again (the gallery's movie skip)", () => {
  // ui.dialog hands its callbacks the way back to what was under it; the two here used to ignore it, and the gallery's Back
  // (right click, the touch Back button) stayed the closed window's from then on
  assert.match(ui, /if \(this\.open\) \{ this\.dialog\(question, \(back\) => \{ back\(\); res\(true\); \}, \(back\) => \{ back\(\); res\(false\); \}, opts\); return; \}/);
  assert.match(ui, /const restore = \(\) => \{ Object\.assign\(this, prev\); if \(prev\.sel >= 0\) this\.select\(prev\.sel\); \};/);
  assert.match(ui, /fn\(restore\);/);
});

test("a save that is not made after Overwrite? leaves the list with its rows and its Back, and shows what storage has", () => {
  assert.match(ui, /const write = \(back\) => \{\n\s+const made = this\.env\.makeSave\(\);\n\s+if \(!made\) \{ back\?\.\(\); this\.sound\(2\); return; \}/);
  // the record goes into the list only once it is stored
  assert.match(ui, /const next = \{ \.\.\.saves, \[i\]: made \};/);
  assert.match(ui, /localStorage\.setItem\(this\.saveKey, JSON\.stringify\(next\)\);\n\s+saves\[i\] = made;/);
  assert.match(ui, /console\.warn\(e\);\n\s+back\?\.\(\);\n\s+this\.notify\(this\.vm\.system\?\.messages\?\.\["186"\]/);
  assert.doesNotMatch(ui, /saves\[i\] = made;\n[^\n]*\n[^\n]*\n[^\n]*\n\s+try \{/);
});

test("a notice that takes over from one still closing keeps the keys that one was keeping, not its own", () => {
  // The keys' part of ui.notify, as it is written there, run for two notices one after the other.
  const src = ui.slice(ui.indexOf("  notify(text, {"));
  assert.match(src, /let keep = this\.keyFn;\n\s+while \(keep\?\.under !== undefined\) keep = keep\.under;/);
  assert.match(src, /keys\.under = keep;/);
  assert.match(src, /if \(this\.keyFn === keys\) this\.keyFn = keep;/);
  const screen = () => false, host = { keyFn: screen };
  const open = () => {
    let keep = host.keyFn;
    while (keep?.under !== undefined) keep = keep.under;
    const keys = () => true;
    keys.under = keep;
    host.keyFn = keys;
    return () => { if (host.keyFn === keys) host.keyFn = keep; };
  };
  const release1 = open(), release2 = open();   // the second made while the first has not given its keys back
  release1();
  assert.notEqual(host.keyFn, screen, "the second has the keys");
  release2();
  assert.equal(host.keyFn, screen, "the screen's keys are back, not the first notice's");
  const a = open(), b = open(), c = open();
  c(); b(); a();
  assert.equal(host.keyFn, screen);
});

test("the config takes no click while it fades out, and a wait for a key ends with its screen", () => {
  assert.match(ui, /state = "out";\n\s+page\.style\.pointerEvents = "none";/);
  assert.match(ui, /this\.binding = false;\n\s+if \(this\.keyFn === capture\) this\.keyFn = keep;/);
  assert.match(ui, /this\.keyFn = capture;\n\s+setTimeout\(\(\) => \{ if \(this\.binding\) addEventListener\("pointerdown", cancel, true\); \}\);/);
  // begin and close both end it
  assert.equal([...ui.matchAll(/this\.analogViewer = false;\n\s+this\.binding = false;/g)].length, 2);
});

test("a press starts the sound again in a new context when the old one was closed (a page shown again by Back)", async () => {
  const { Audio } = await import("../../web/app/js/audio.js");
  const a = new Audio();
  const { ctx: old } = withContext(a);
  await a.playSE(3, true, "SE_A", {});
  const loop = a.se.get(3);
  old.currentTime = 10;
  old.state = "closed";   // what main.js's pagehide leaves
  old.close = () => Promise.reject(new Error("closed already"));
  let resumed = 0;
  old.resume = () => { resumed++; return Promise.resolve(); };
  const made = [];
  const saved = globalThis.window;
  globalThis.window = { AudioContext: function () { const c = fakeContext(); c.currentTime = 2; made.push(c); return c; } };
  try { a.start(); } finally { globalThis.window = saved; }
  assert.equal(made.length, 1, "a new context");
  assert.equal(a.ctx, made[0]);
  assert.equal(resumed, 0, "a closed context is not asked to resume");
  assert.equal(a.se.get(3), loop, "what was playing goes on");
  assert.equal(made[0].sources.length, 1, "in the new context");
  // one that is only held is resumed as before, and one that runs is left alone
  const b = new Audio();
  const { ctx } = withContext(b);
  let asked = 0;
  ctx.resume = () => { asked++; return Promise.resolve(); };
  ctx.state = "suspended"; b.start();
  ctx.state = "interrupted"; b.start();
  ctx.state = "running"; b.start();
  assert.equal(asked, 2);
  assert.equal(b.ctx, ctx);
});
