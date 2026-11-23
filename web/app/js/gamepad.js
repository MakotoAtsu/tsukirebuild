// gamepad.js - controller input, button layouts, stick reading, and controller prompt labels.
// Works across web browsers, the Electron desktop app, and Android WebView through the Gamepad API, with a calibrated
// fallback for non-standard mappings where an OS or browser leaves pad.mapping blank.
const STORE = "tsuki.pad";

// Stick thresholds matching the game's own native pad reader (0xb3a18): dead zone 7849 / 32767, direction past 80 / 128.
export const STICK_DEAD_ZONE = 7849 / 32767;
export const STICK_DIR = 80 / 128;
const TRIGGER_ON = 0.5;
const HAT_DIRS = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];
const NON_GAMEPAD_ID = /wheel|steering|pedal|flight|hotas|throttle|rudder|yoke|spacemouse|3dconnexion|accelerometer|gyroscope|sensor|touchpad|trackpad|\bmouse\b|\bkeyboard\b/i;

// Per-pad resting axis baselines for non-standard mappings so a device whose axis rests at -1 or +1 (wheels, flight
// sticks, triggers, weird HIDs) never holds a direction or scrolls forever.
const padBaselines = new Map();

export function resetPadBaselines() {
  padBaselines.clear();
}

function padKeyOf(pad) {
  return `${pad.index ?? 0}:${pad.id ?? ""}`;
}

// Reject disconnected pads and non-gamepad HID peripherals when pad.mapping is not "standard".
export function isLikelyGamepad(pad) {
  if (!pad || pad.connected === false) return false;
  if (pad.mapping === "standard") return true;
  if ((pad.buttons?.length || 0) < 4) return false;
  if (NON_GAMEPAD_ID.test(String(pad.id || ""))) return false;
  return true;
}

function baselineFor(pad) {
  const k = padKeyOf(pad);
  const axes = pad.axes || [];
  let state = padBaselines.get(k);
  if (!state || state.len !== axes.length) {
    state = {
      len: axes.length,
      initial: Array.from(axes, (v) => Number(v) || 0),
      centered: Array.from(axes, (v) => Math.abs(Number(v) || 0) < STICK_DEAD_ZONE),
      hatNeutral: axes.length >= 10 ? Math.abs(Number(axes[9]) || 0) > 1.05 : false,
    };
    padBaselines.set(k, state);
  } else {
    for (let i = 0; i < axes.length; i++) {
      const v = Number(axes[i]) || 0;
      if (!state.centered[i] && Math.abs(v) < STICK_DEAD_ZONE) state.centered[i] = true;
    }
    if (axes.length >= 10 && !state.hatNeutral && Math.abs(Number(axes[9]) || 0) > 1.05) {
      state.hatNeutral = true;
    }
  }
  return state;
}

function pruneBaselines(pads) {
  if (!padBaselines.size) return;
  const alive = new Set();
  for (const pad of pads || []) if (pad && pad.connected !== false && pad.mapping !== "standard") alive.add(padKeyOf(pad));
  for (const k of [...padBaselines.keys()]) if (!alive.has(k)) padBaselines.delete(k);
}

// Face/shoulder button labels by controller family.
export const PAD_GLYPHS = {
  xbox: {
    south: "A", east: "B", west: "X", north: "Y",
    lb: "LB", rb: "RB", lt: "LT", rt: "RT",
    back: "View", start: "Menu", l3: "LS", r3: "RS",
    dpad: "D-Pad", ls: "L-Stick", rs: "R-Stick",
  },
  playstation: {
    south: "\u2715", east: "\u25cb", west: "\u25a1", north: "\u25b3",
    lb: "L1", rb: "R1", lt: "L2", rt: "R2",
    back: "Create", start: "Options", l3: "L3", r3: "R3",
    dpad: "D-Pad", ls: "L-Stick", rs: "R-Stick",
  },
  nintendo: {
    south: "B", east: "A", west: "Y", north: "X",
    lb: "L", rb: "R", lt: "ZL", rt: "ZR",
    back: "-", start: "+", l3: "L-Click", r3: "R-Click",
    dpad: "D-Pad", ls: "L-Stick", rs: "R-Stick",
  },
};

export const PAD_LAYOUTS = ["auto", "south", "east"];
export const PAD_STYLES = ["auto", "xbox", "playstation", "nintendo"];

// Guess the controller family from navigator.getGamepads()[i].id.
export function detectPadStyle(id = "") {
  const s = String(id || "").toLowerCase();
  if (/xbox|xinput|045e/.test(s)) return "xbox";
  if (/nintendo|switch|joy-?con|pro controller|057e/.test(s)) return "nintendo";
  if (/playstation|dualshock|dualsense|ps[345]\b|054c|^wireless controller\b|sony.*wireless controller/.test(s)) return "playstation";
  return "xbox";
}

// Persistent controller preferences: confirm/cancel layout ("auto" = Nintendo east, Xbox/PS south) and glyph style.
export class PadConfig {
  constructor(storage = globalThis.localStorage, key = STORE) {
    this.storage = storage;
    this.storageKey = key;
    this.layout = "auto";
    this.style = "auto";
    try {
      const saved = JSON.parse(storage?.getItem(key) || "null");
      if (saved && typeof saved === "object") {
        if (PAD_LAYOUTS.includes(saved.layout)) this.layout = saved.layout;
        if (PAD_STYLES.includes(saved.style)) this.style = saved.style;
      }
    } catch { /* defaults */ }
  }
  save() {
    try { this.storage?.setItem(this.storageKey, JSON.stringify({ layout: this.layout, style: this.style })); } catch { /* not kept */ }
  }
  reset(save = true) {
    this.layout = "auto";
    this.style = "auto";
    if (save) this.save();
  }
  cycleLayout() {
    this.layout = PAD_LAYOUTS[(PAD_LAYOUTS.indexOf(this.layout) + 1) % PAD_LAYOUTS.length];
    this.save();
    return this.layout;
  }
  cycleStyle() {
    this.style = PAD_STYLES[(PAD_STYLES.indexOf(this.style) + 1) % PAD_STYLES.length];
    this.save();
    return this.style;
  }
  resolvedStyle(detected = "xbox") {
    return this.style === "auto" ? (PAD_GLYPHS[detected] ? detected : "xbox") : this.style;
  }
  // Auto confirm/cancel follows the physical controller detected, never the cosmetic Button prompts glyph style.
  confirmEast(detected = "xbox") {
    if (this.layout === "east") return true;
    if (this.layout === "south") return false;
    return detected === "nintendo";
  }
  labels(detected = "xbox") {
    const style = this.resolvedStyle(detected);
    const g = PAD_GLYPHS[style] || PAD_GLYPHS.xbox;
    const east = this.confirmEast(detected);
    return {
      style,
      confirmEast: east,
      confirm: east ? g.east : g.south,
      cancel: east ? g.south : g.east,
      west: g.west,
      north: g.north,
      lb: g.lb,
      rb: g.rb,
      lt: g.lt,
      rt: g.rt,
      back: g.back,
      start: g.start,
      l3: g.l3,
      r3: g.r3,
      dpad: g.dpad,
      ls: g.ls,
      rs: g.rs,
    };
  }
}

// Button labels for the bottom help bar when a controller is the active input device, adjusted per screen.
export function padHints(labels, screen = null) {
  const L = labels || PAD_GLYPHS.xbox;
  const confirm = L.confirm || L.south;
  const cancel = L.cancel || L.east;
  const leftScrolls = screen === "flowchart" || screen === "config";
  const move = leftScrolls ? [L.dpad, L.rs] : [L.dpad, L.ls];
  return {
    Start: [confirm],
    Back: [cancel],
    Choose: [confirm],
    Move: move,
    "Cursor movement": move,
    "Change page": [L.lb, L.rb],
    Scroll: screen === "log" ? [`${L.lt} / ${L.rt}`] : [L.ls, `${L.lt} / ${L.rt}`],
    "Quick jump": [confirm],
    "Replay voice": [L.west],
    Picture: [L.dpad],
    Zoom: screen === "flowchart" ? [`${L.lb} / ${L.rb}`] : [L.rs, `${L.lb} / ${L.rb}`],
    Fill: [confirm],
    Reset: screen === "flowchart" ? [L.back] : [L.north],
    "Change key": [confirm],
  };
}

// Summary rows for Config -> Controls (Controller section).
export function padControlsList(labels) {
  const L = labels;
  return [
    ["Advance text, choose", L.confirm],
    ["System menu, back", `${L.west} / ${L.cancel}`],
    ["Log", L.north],
    ["Fast forward (while held)", L.rt],
    ["Skip read text: on / off", L.rb],
    ["Auto mode: on / off", L.lb],
    ["Previous message", L.lt],
    ["Hide text", L.back],
    ["Replay voice", L.l3],
    ["Quick bar", `${L.dpad} \u2191`],
    ["Move", `${L.dpad} / ${L.ls}`],
    ["Change page", `${L.lb} / ${L.rb}`],
    ["Scroll", `${L.ls} / ${L.lt} ${L.rt}`],
    ["CG viewer", `${L.ls} / ${L.rs} / ${L.north}`],
  ];
}

function deadZone(v, zone = STICK_DEAD_ZONE) {
  const n = Number(v) || 0;
  return Math.abs(n) < zone ? 0 : Math.max(-1, Math.min(1, n));
}

function calibratedAxis(axes, idx, base) {
  if (!(idx < axes.length)) return 0;
  if (base && !base.centered[idx]) return 0;
  return deadZone(axes[idx]);
}

function buttonDown(b, analog = false) {
  if (!b) return false;
  if (typeof b === "number") return b > TRIGGER_ON;
  return !!b.pressed || (analog && (b.value || 0) > TRIGGER_ON);
}

// Read D-pad from standard buttons (12..15), or fall back to calibrated hat-switch / axis D-pads on non-standard pads.
function readDpad(pad, base, out) {
  const btns = pad.buttons || [];
  if (buttonDown(btns[12])) out.add("up");
  if (buttonDown(btns[13])) out.add("down");
  if (buttonDown(btns[14])) out.add("left");
  if (buttonDown(btns[15])) out.add("right");
  if (pad.mapping === "standard") return;
  const axes = pad.axes || [];
  // Linux/Android non-standard pads often expose D-pad on axes[6]/axes[7] or a single hat axis on axes[9].
  if (axes.length >= 8 && Math.abs(axes[6]) <= 1 && Math.abs(axes[7]) <= 1) {
    if (!base || base.centered[7]) {
      if (axes[7] < -0.5) out.add("up");
      if (axes[7] > 0.5) out.add("down");
    }
    if (!base || base.centered[6]) {
      if (axes[6] < -0.5) out.add("left");
      if (axes[6] > 0.5) out.add("right");
    }
  }
  if (axes.length >= 10 && (!base || base.hatNeutral)) {
    const h = axes[9];
    // Standard DirectInput hat encoding in Chromium/Firefox maps 8 directions to [-1, +1] in steps of 2/7; centered is > 1.2 (typically 3.2857).
    if (h >= -1.05 && h <= 1.05) {
      const idx = Math.round(((h + 1) / 2) * 7);
      const dir = HAT_DIRS[idx];
      if (dir) {
        if (dir[1] < 0) out.add("up");
        if (dir[1] > 0) out.add("down");
        if (dir[0] < 0) out.add("left");
        if (dir[0] > 0) out.add("right");
      }
    }
  }
}

// Read normalized buttons and sticks from a single Gamepad object (standard or calibrated non-standard gamepad).
export function readPad(pad, { confirmEast = false } = {}) {
  if (!isLikelyGamepad(pad)) return null;
  const base = pad.mapping === "standard" ? null : baselineFor(pad);
  const btns = pad.buttons || [];
  const axes = pad.axes || [];
  const pressed = new Set();
  if (buttonDown(btns[0])) pressed.add(confirmEast ? "cancel" : "confirm");
  if (buttonDown(btns[1])) pressed.add(confirmEast ? "confirm" : "cancel");
  if (buttonDown(btns[2])) pressed.add("west");
  if (buttonDown(btns[3])) pressed.add("north");
  if (buttonDown(btns[4])) pressed.add("lb");
  if (buttonDown(btns[5])) pressed.add("rb");
  if (buttonDown(btns[6], true)) pressed.add("lt");
  if (buttonDown(btns[7], true)) pressed.add("rt");
  if (buttonDown(btns[8])) pressed.add("back");
  if (buttonDown(btns[9])) pressed.add("start");
  if (buttonDown(btns[10])) pressed.add("l3");
  if (buttonDown(btns[11])) pressed.add("r3");
  readDpad(pad, base, pressed);
  // Non-standard analog triggers sometimes sit on axes[4]/axes[5] (-1 idle to +1 pressed) when buttons[6]/buttons[7] are absent;
  // only treat an axis as a trigger if it rested near -1 (so an axis resting at +1 cannot stick LT/RT on).
  if (pad.mapping !== "standard" && btns.length < 8 && axes.length >= 6 && base) {
    if (base.initial[4] < -0.5 && axes[4] > 0.25) pressed.add("lt");
    if (base.initial[5] < -0.5 && axes[5] > 0.25) pressed.add("rt");
  }
  const ls = { x: calibratedAxis(axes, 0, base), y: calibratedAxis(axes, 1, base) };
  const rs = axes.length >= 4 ? { x: calibratedAxis(axes, 2, base), y: calibratedAxis(axes, 3, base) } : { x: 0, y: 0 };
  return { pressed, ls, rs, style: detectPadStyle(pad.id) };
}

// Combined left and right sticks across all connected gamepads (clamped to [-1, 1] per axis).
export function readSticks(pads = []) {
  pruneBaselines(pads);
  let lx = 0, ly = 0, rx = 0, ry = 0;
  for (const pad of pads) {
    if (!isLikelyGamepad(pad)) continue;
    const base = pad.mapping === "standard" ? null : baselineFor(pad);
    const axes = pad.axes || [];
    lx += calibratedAxis(axes, 0, base);
    ly += calibratedAxis(axes, 1, base);
    if (axes.length >= 4) {
      rx += calibratedAxis(axes, 2, base);
      ry += calibratedAxis(axes, 3, base);
    }
  }
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return { lx: clamp(lx), ly: clamp(ly), rx: clamp(rx), ry: clamp(ry) };
}

// Left stick vertical scroll value (-128 .. 128, up positive) matching native 0xb38f4, across standard and calibrated non-standard pads.
export function leftStickScrollY(pads = []) {
  pruneBaselines(pads);
  let y = 0;
  for (const pad of pads) {
    if (!isLikelyGamepad(pad) || !(pad.axes?.length > 1)) continue;
    const base = pad.mapping === "standard" ? null : baselineFor(pad);
    const v = calibratedAxis(pad.axes, 1, base);
    if (v) y += Math.trunc(-v * 128);
  }
  return Math.max(-128, Math.min(128, y));
}

// Menu key synthesis table: logical pad button -> KeyboardEvent spec.
export const PAD_MENU_KEYS = {
  confirm: { key: "Enter" },
  cancel: { key: "Escape" },
  up: { key: "ArrowUp" },
  down: { key: "ArrowDown" },
  left: { key: "ArrowLeft" },
  right: { key: "ArrowRight" },
  lb: { key: "Tab", shiftKey: true },
  rb: { key: "Tab", shiftKey: false },
  lt: { key: "PageUp" },
  rt: { key: "PageDown" },
  north: { key: "Home" },
};

// Subset used when only a lightweight story overlay (keyboard Quick Bar or Choices) is up, so PageUp/Tab/Home never fall
// through into the story screen's own keybindings (e.g. PageUp -> Log).
const OVERLAY_KEYS = {
  confirm: PAD_MENU_KEYS.confirm,
  cancel: PAD_MENU_KEYS.cancel,
  up: PAD_MENU_KEYS.up,
  down: PAD_MENU_KEYS.down,
  left: PAD_MENU_KEYS.left,
  right: PAD_MENU_KEYS.right,
};

// Story action table: logical pad button -> keys.js action id.
export const PAD_STORY_ACTIONS = {
  confirm: "advance",
  down: "advance",
  west: "menu",
  start: "menu",
  north: "log",
  up: "bar",
  rb: "skip",
  lb: "auto",
  lt: "rewind",
  back: "hide",
  l3: "voice",
};

const REPEAT_BTNS = new Set(["up", "down", "left", "right", "lt", "rt"]);

// Stateful controller poller: handles press, hold-repeat, release (including synthetic keyup so sliders/viewers never stick),
// left/right stick menu navigation, blur suppression, and active controller tracking.
export class GamepadDriver {
  constructor({ config = new PadConfig(), getPads = () => globalThis.navigator?.getGamepads?.() || [] } = {}) {
    this.config = config;
    this.getPads = getPads;
    this.held = new Map();        // logical button -> { next, keySpec, fast }
    this.suppressed = new Set();  // buttons released via blur/disconnect that must be physically released before firing again
    this.active = false;          // true while the player's latest input came from a controller
    this.detectedStyle = "xbox";
    this.connected = false;
    this.onModeChange = null;
  }

  labels() {
    return this.config.labels(this.detectedStyle);
  }

  hints(screen = null) {
    return padHints(this.labels(), screen);
  }

  setMode(padActive) {
    const next = !!padActive;
    if (this.active === next) return;
    this.active = next;
    this.onModeChange?.(next, this.labels());
  }

  // Release every held button cleanly (window blur or disconnect) and suppress re-triggering until physically released.
  releaseAll(handlers) {
    for (const [btn, state] of [...this.held]) {
      this.held.delete(btn);
      this.suppressed.add(btn);
      this.emitRelease(btn, state, handlers);
    }
  }

  emitRelease(btn, state, handlers) {
    if (state.fast) handlers.fastForward?.(false);
    if (state.keySpec) handlers.keyUp?.(state.keySpec);
  }

  // Called once per animation frame.
  // ctx: { menus, panelOpen, choosing, binding, leftStickScrolls, analogViewer, screen, voiceKey, keyDown, keyUp, runAction, cancelStory, fastForward, wakeAudio }
  poll(now, ctx) {
    const pads = this.getPads() || [];
    pruneBaselines(pads);
    const pressed = new Set();
    let anyConnected = false;
    let anyStickActivity = false;
    let style = this.detectedStyle;

    for (const pad of pads) {
      if (!isLikelyGamepad(pad)) continue;
      anyConnected = true;
      const detected = detectPadStyle(pad.id);
      const reading = readPad(pad, { confirmEast: this.config.confirmEast(detected) });
      if (!reading) continue;
      if (reading.pressed.size || reading.ls.x || reading.ls.y || reading.rs.x || reading.rs.y) {
        style = reading.style;
        anyStickActivity = true;
      }
      for (const b of reading.pressed) pressed.add(b);
      if (ctx.menus && !ctx.analogViewer && !ctx.binding) {
        // Right stick always mirrors D-pad in menus; left stick mirrors D-pad too unless this screen uses left stick to scroll.
        // In the backlog ("log"), ignore horizontal stick tilts so diagonal thumb movement never jumps to the top/end.
        const sticks = ctx.leftStickScrolls ? [reading.rs] : [reading.ls, reading.rs];
        const allowHoriz = ctx.screen !== "log";
        for (const st of sticks) {
          if (st.y < -STICK_DIR) pressed.add("up");
          if (st.y > STICK_DIR) pressed.add("down");
          if (allowHoriz && st.x < -STICK_DIR) pressed.add("left");
          if (allowHoriz && st.x > STICK_DIR) pressed.add("right");
        }
      }
    }

    this.connected = anyConnected;
    const styleChanged = style !== this.detectedStyle;
    this.detectedStyle = style;
    if (pressed.size > 0 || anyStickActivity) {
      if (!this.active) this.setMode(true);
      else if (styleChanged) this.onModeChange?.(true, this.labels());
    }

    // Clear suppression only once a button has been physically released.
    for (const btn of [...this.suppressed]) {
      if (!pressed.has(btn)) this.suppressed.delete(btn);
    }

    // Handle releases before new presses so context transitions don't leave stale keys down.
    for (const [btn, state] of [...this.held]) {
      if (!pressed.has(btn)) {
        this.held.delete(btn);
        this.emitRelease(btn, state, ctx);
      }
    }

    // Handle presses and hold repeats.
    for (const btn of pressed) {
      if (this.suppressed.has(btn)) continue;
      const state = this.held.get(btn);
      const isDir = btn === "up" || btn === "down" || btn === "left" || btn === "right";
      if (!state) {
        const entry = { next: now + (isDir ? 250 : 400), keySpec: null, fast: false };
        this.held.set(btn, entry);
        ctx.wakeAudio?.();
        this.fire(btn, entry, false, ctx);
      } else if (REPEAT_BTNS.has(btn)) {
        // Only repeat rt in menu mode (where it is PageDown); on the story screen rt is hold-to-fast-forward.
        if (btn === "rt" && state.fast) continue;
        if (now >= state.next) {
          state.next = now + (isDir ? 1000 / 12 : 250);
          this.fire(btn, state, true, ctx);
        }
      }
    }
  }

  menuKeyFor(btn, ctx) {
    // While Config -> Controls waits for a keyboard key to bind, only Cancel (Escape) acts; no other pad button can rebind a key.
    if (ctx.binding) return btn === "cancel" ? { key: "Escape" } : null;
    if (!ctx.screen && (ctx.panelOpen || ctx.choosing)) return OVERLAY_KEYS[btn] || null;
    if (ctx.screen === "log") {
      if (btn === "west") return { key: ctx.voiceKey || "V" };
      if (btn === "north") return { key: "Escape" };
    }
    if (ctx.screen === "flowchart") {
      if (btn === "lb") return { key: "-" };
      if (btn === "rb") return { key: "+" };
      if (btn === "back") return { key: "0" };
    }
    if (ctx.analogViewer) {
      // In the CG viewer, LB/RB also step zoom cleanly alongside right-stick smooth zoom, and North/Back reset.
      if (btn === "lb") return { key: "-" };
      if (btn === "rb") return { key: "+" };
      if (btn === "north" || btn === "back") return { key: "Home" };
    }
    return PAD_MENU_KEYS[btn] || null;
  }

  fire(btn, entry, repeat, ctx) {
    if (btn === "rt" && !ctx.menus) {
      entry.fast = true;
      ctx.fastForward?.(true);
      return;
    }
    if (ctx.menus) {
      const spec = this.menuKeyFor(btn, ctx);
      if (spec) {
        entry.keySpec = spec;
        ctx.keyDown?.(spec, repeat);
      }
      return;
    }
    if (btn === "cancel") {
      ctx.cancelStory?.();
      return;
    }
    const action = PAD_STORY_ACTIONS[btn];
    if (action) ctx.runAction?.(action, { repeat });
  }
}
