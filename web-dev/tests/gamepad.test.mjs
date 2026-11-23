// Controller support (web/app/js/gamepad.js and its hooks in main.js, ui.js, gallery.js, flowchart.js, touch.css,
// and Android MainActivity.java).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  GamepadDriver, PadConfig, STICK_DEAD_ZONE, STICK_DIR,
  detectPadStyle, leftStickScrollY, padControlsList, padHints, readPad, readSticks,
} = await import("../../web/app/js/gamepad.js");

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

function makePad({ id = "Xbox Wireless Controller", mapping = "standard", buttons = {}, axes = [0, 0, 0, 0], count = 16 } = {}) {
  const btns = Array.from({ length: count }, (_, i) => {
    const v = buttons[i];
    if (typeof v === "number") return { pressed: v > 0.9, value: v };
    return { pressed: !!v, value: v ? 1 : 0 };
  });
  return { id, mapping, connected: true, buttons: btns, axes };
}

test("detectPadStyle recognizes Nintendo, PlayStation, and defaults to Xbox", () => {
  assert.equal(detectPadStyle("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"), "nintendo");
  assert.equal(detectPadStyle("Nintendo Switch Joy-Con (L+R)"), "nintendo");
  assert.equal(detectPadStyle("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"), "playstation");
  assert.equal(detectPadStyle("Sony Wireless Controller"), "playstation");
  assert.equal(detectPadStyle("Xbox Wireless Controller (STANDARD GAMEPAD)"), "xbox");
  assert.equal(detectPadStyle("Valve Steam Deck"), "xbox");
});

test("PadConfig defaults to Nintendo East-confirm and Xbox/PS South-confirm, persists overrides, and resets", () => {
  const store = fakeStorage();
  const cfg = new PadConfig(store);
  assert.equal(cfg.confirmEast("nintendo"), true);
  assert.equal(cfg.confirmEast("xbox"), false);
  assert.equal(cfg.confirmEast("playstation"), false);
  assert.equal(cfg.labels("xbox").confirm, "A");
  assert.equal(cfg.labels("xbox").cancel, "B");
  assert.equal(cfg.labels("playstation").confirm, "\u2715");
  assert.equal(cfg.labels("playstation").cancel, "\u25cb");
  assert.equal(cfg.labels("nintendo").confirm, "A");
  assert.equal(cfg.labels("nintendo").cancel, "B");

  assert.equal(cfg.cycleLayout(), "south");
  assert.equal(cfg.confirmEast("nintendo"), false);
  assert.equal(cfg.cycleLayout(), "east");
  assert.equal(cfg.confirmEast("xbox"), true);
  assert.equal(cfg.labels("xbox").confirm, "B");
  assert.equal(cfg.labels("xbox").cancel, "A");

  assert.equal(cfg.cycleStyle(), "xbox");
  assert.equal(cfg.cycleStyle(), "playstation");
  assert.equal(cfg.labels("nintendo").confirm, "\u25cb");

  const reloaded = new PadConfig(store);
  assert.equal(reloaded.layout, "east");
  assert.equal(reloaded.style, "playstation");

  reloaded.reset();
  assert.equal(reloaded.layout, "auto");
  assert.equal(reloaded.style, "auto");
});

test("readPad handles standard pads, analog triggers, and non-standard hat/axis D-pads", () => {
  const xbox = readPad(makePad({ buttons: { 0: true, 7: 0.75, 8: true, 10: true }, axes: [0.1, -0.8, 0.9, 0] }), { confirmEast: false });
  assert.ok(xbox.pressed.has("confirm"));
  assert.ok(xbox.pressed.has("rt"));
  assert.ok(xbox.pressed.has("back"));
  assert.ok(xbox.pressed.has("l3"));
  assert.equal(xbox.ls.x, 0, "inside dead zone");
  assert.equal(xbox.ls.y, -0.8);
  assert.equal(xbox.rs.x, 0.9);

  const nintendo = readPad(makePad({ id: "Nintendo Switch Pro Controller", buttons: { 0: true, 1: false } }), { confirmEast: true });
  assert.ok(nintendo.pressed.has("cancel"));
  assert.ok(!nintendo.pressed.has("confirm"));

  // Non-standard pad with DirectInput hat switch on axes[9] (-1 = up, 0.1428 = down) and triggers on axes[4..5]
  const hatUp = readPad(makePad({ mapping: "", count: 6, axes: [0, -0.5, 0, 0, 0.6, -1, 0, 0, 0, -1] }), { confirmEast: false });
  assert.ok(hatUp.pressed.has("up"));
  assert.ok(hatUp.pressed.has("lt"));
  assert.ok(!hatUp.pressed.has("rt"));

  const axisDpad = readPad(makePad({ mapping: "", count: 12, axes: [0, 0, 0, 0, 0, 0, -1, 1] }), { confirmEast: false });
  assert.ok(axisDpad.pressed.has("left"));
  assert.ok(axisDpad.pressed.has("down"));

  // Non-standard pad still scrolls Config/Flowchart and pans CG viewer via shared stick helpers
  const nonStd = makePad({ mapping: "", axes: [0.5, -0.5, 0, 0.75] });
  assert.equal(leftStickScrollY([nonStd]), 64);
  assert.deepEqual(readSticks([nonStd]), { lx: 0.5, ly: -0.5, rx: 0, ry: 0.75 });
});

test("GamepadDriver dispatches matching keydown and keyup in menus so sliders and CG viewer never stick", () => {
  let pads = [];
  const driver = new GamepadDriver({ config: new PadConfig(fakeStorage()), getPads: () => pads });
  const events = [];
  const baseCtx = {
    menus: true,
    screen: "config",
    leftStickScrolls: true,
    analogViewer: false,
    voiceKey: "V",
    keyDown: (spec, repeat) => events.push(["down", spec.key, !!spec.shiftKey, !!repeat]),
    keyUp: (spec) => events.push(["up", spec.key, !!spec.shiftKey]),
    runAction: () => {},
    cancelStory: () => {},
    fastForward: () => {},
    wakeAudio: () => {},
  };

  // Hold confirm (A on Xbox) then release -> must emit Enter keydown then Enter keyup
  pads = [makePad({ buttons: { 0: true } })];
  driver.poll(100, baseCtx);
  pads = [makePad({})];
  driver.poll(150, baseCtx);
  assert.deepEqual(events, [["down", "Enter", false, false], ["up", "Enter", false]]);

  // Hold D-pad Up in CG viewer then release -> must emit ArrowUp keydown then ArrowUp keyup
  events.length = 0;
  const viewerCtx = { ...baseCtx, screen: "gallery", leftStickScrolls: false, analogViewer: true };
  pads = [makePad({ buttons: { 12: true } })];
  driver.poll(200, viewerCtx);
  pads = [makePad({})];
  driver.poll(250, viewerCtx);
  assert.deepEqual(events, [["down", "ArrowUp", false, false], ["up", "ArrowUp", false]]);
});

test("GamepadDriver routes left/right sticks per screen, story actions, fast-forward hold, and screen shortcuts", () => {
  let pads = [];
  const driver = new GamepadDriver({ config: new PadConfig(fakeStorage()), getPads: () => pads });
  const actions = [], keys = [], ff = [];
  let cancels = 0, modeChanges = [];
  driver.onModeChange = (on, labels) => modeChanges.push([on, labels.style]);

  const makeCtx = (extra = {}) => ({
    menus: false,
    screen: null,
    leftStickScrolls: false,
    analogViewer: false,
    voiceKey: "V",
    keyDown: (spec, repeat) => keys.push(["down", spec.key, !!spec.shiftKey, !!repeat]),
    keyUp: (spec) => keys.push(["up", spec.key, !!spec.shiftKey]),
    runAction: (a, o) => actions.push([a, !!o?.repeat]),
    cancelStory: () => cancels++,
    fastForward: (on) => ff.push(on),
    wakeAudio: () => {},
    ...extra,
  });

  // Story screen: Select/View hides text, L3 replays voice, RT holds fast-forward, B cancels
  pads = [makePad({ buttons: { 8: true, 10: true, 7: true, 1: true } })];
  driver.poll(100, makeCtx());
  assert.deepEqual(actions, [["hide", false], ["voice", false]]);
  assert.deepEqual(ff, [true]);
  assert.equal(cancels, 1);
  assert.equal(driver.active, true);
  assert.deepEqual(modeChanges, [[true, "xbox"]]);

  // Release RT (or blur/disconnect) cleanly stops fast-forward
  driver.releaseAll(makeCtx());
  assert.deepEqual(ff, [true, false]);

  // Standard menu: left stick navigates D-pad directions with repeat
  keys.length = 0;
  pads = [makePad({ axes: [0, 0.9, 0, 0] })];
  driver.poll(200, makeCtx({ menus: true, screen: "titlemenu" }));
  driver.poll(460, makeCtx({ menus: true, screen: "titlemenu" }));
  assert.deepEqual(keys, [["down", "ArrowDown", false, false], ["down", "ArrowDown", false, true]]);

  // Config / Flowchart (leftStickScrolls): left stick does NOT fire menu ArrowDown, right stick does
  keys.length = 0;
  driver.releaseAll(makeCtx({ menus: true }));
  keys.length = 0;
  pads = [makePad({ axes: [0, 0.9, 0, 0] })];
  driver.poll(600, makeCtx({ menus: true, screen: "config", leftStickScrolls: true }));
  assert.deepEqual(keys, []);
  pads = [makePad({ axes: [0, 0, 0, 0.9] })];
  driver.poll(620, makeCtx({ menus: true, screen: "config", leftStickScrolls: true }));
  assert.deepEqual(keys, [["down", "ArrowDown", false, false]]);

  // Backlog screen: West replays voice, North closes
  keys.length = 0;
  driver.releaseAll(makeCtx({ menus: true }));
  keys.length = 0;
  pads = [makePad({ buttons: { 2: true } })];
  driver.poll(700, makeCtx({ menus: true, screen: "log", voiceKey: "Q" }));
  assert.deepEqual(keys, [["down", "Q", false, false]]);

  // Flowchart screen: LB/RB zoom out/in, Back resets zoom
  keys.length = 0;
  driver.releaseAll(makeCtx({ menus: true }));
  keys.length = 0;
  pads = [makePad({ buttons: { 4: true, 5: true, 8: true } })];
  driver.poll(800, makeCtx({ menus: true, screen: "flowchart", leftStickScrolls: true }));
  assert.deepEqual(keys, [["down", "-", false, false], ["down", "+", false, false], ["down", "0", false, false]]);

  // CG viewer (analogViewer): sticks don't fire Arrow keys; North resets via Home
  keys.length = 0;
  driver.releaseAll(makeCtx({ menus: true }));
  keys.length = 0;
  pads = [makePad({ buttons: { 3: true }, axes: [0.9, 0.9, 0.9, 0.9] })];
  driver.poll(900, makeCtx({ menus: true, screen: "gallery", analogViewer: true }));
  assert.deepEqual(keys, [["down", "Home", false, false]]);
});

test("padHints and padControlsList reflect the active controller style and layout", () => {
  const cfg = new PadConfig(fakeStorage());
  const psHints = padHints(cfg.labels("playstation"));
  assert.deepEqual(psHints.Choose, ["\u2715"]);
  assert.deepEqual(psHints.Back, ["\u25cb"]);
  assert.deepEqual(psHints["Change page"], ["L1", "R1"]);

  const nRows = padControlsList(cfg.labels("nintendo"));
  assert.ok(nRows.some(([label, what]) => label === "Hide text" && what === "-"));
  assert.ok(nRows.some(([label, what]) => label === "Replay voice" && what === "L-Click"));
});

test("web, touch, Chinese Controls labels, and Android wrapper wire controller support cleanly", async () => {
  const main = read("web/app/js/main.js");
  const gallery = read("web/app/js/gallery.js");
  const android = read("web-dev/android/src/date/arcueid/tsukirebuild/MainActivity.java");
  const touchCss = read("web/app/touch.css");
  const { CONTROLS_ZH } = await import("../../web/app/js/words.js");

  assert.match(main, /new GamepadDriver\(/);
  assert.match(main, /new KeyboardEvent\("keyup"/);
  assert.match(main, /gamepaddisconnected/);
  assert.match(main, /e\.isTrusted/);
  assert.match(gallery, /readSticks\(/);
  assert.match(gallery, /ui\.analogViewer = true/);
  assert.match(android, /dispatchKeyEvent\(KeyEvent event\)/);
  assert.match(android, /dispatchGenericMotionEvent\(MotionEvent event\)/);
  assert.match(android, /setDefaultFocusHighlightEnabled\(false\)/);
  assert.match(android, /web\.requestFocus\(\)/);
  assert.match(android, /KEYCODE_VOLUME_UP/);
  assert.match(android, /SOURCE_GAMEPAD/);
  assert.match(touchCss, /html\.touch\[data-input="pad"\] \.helpbar/);
  assert.match(touchCss, /html\.touch #stage :focus \{ outline: none; \}/);

  for (const w of ["Controller", "Confirm / Cancel", "Button prompts", "Auto", "South (A / \u2715)", "East (A / \u25cb)"]) {
    assert.ok(CONTROLS_ZH[w] && /[\u4e00-\u9fff]/.test(CONTROLS_ZH[w]), `Chinese label for ${w}`);
  }
});
