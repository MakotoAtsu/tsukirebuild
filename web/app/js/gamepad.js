// gamepad.js - controller input, button layouts, stick reading, and controller prompt labels.
// Works across web browsers, the Electron desktop app, and Android WebView through the Gamepad API, with a fallback
// for non-standard mappings where an OS or browser leaves pad.mapping blank.
const STORE = "tsuki.pad";

// Stick thresholds matching the game's own native pad reader (0xb3a18): dead zone 7849 / 32767, direction past 80 / 128.
export const STICK_DEAD_ZONE = 7849 / 32767;
export const STICK_DIR = 80 / 128;
const TRIGGER_ON = 0.5;
const HAT_DIRS = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

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
  confirmEast(detected = "xbox") {
    if (this.layout === "east") return true;
    if (this.layout === "south") return false;
    return this.resolvedStyle(detected) === "nintendo";
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

// Button labels for the bottom help bar when a controller is the active input device.
export function padHints(labels) {
  const L = labels || PAD_GLYPHS.xbox;
  const confirm = L.confirm || L.south;
  const cancel = L.cancel || L.east;
  return {
    Start: [confirm],
    Back: [cancel],
    Choose: [confirm],
    Move: [L.dpad, L.ls],
    "Cursor movement": [L.dpad, L.ls],
    "Change page": [L.lb, L.rb],
    Scroll: [L.ls, `${L.lt} / ${L.rt}`],
    "Quick jump": [confirm],
    "Replay voice": [L.west],
    Picture: [L.dpad],
    Zoom: [L.rs, `${L.lb} / ${L.rb}`],
    Fill: [confirm],
    Reset: [L.north],
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

function buttonDown(b, analog = false) {
  if (!b) return false;
  if (typeof b === "number") return b > TRIGGER_ON;
  return !!b.pressed || (analog && (b.value || 0) > TRIGGER_ON);
}

// Read D-pad from standard buttons (12..15), or fall back to hat-switch / axis D-pads on non-standard controllers.
function readDpad(pad, out) {
  const btns = pad.buttons || [];
  if (buttonDown(btns[12])) out.add("up");
  if (buttonDown(btns[13])) out.add("down");
  if (buttonDown(btns[14])) out.add("left");
  if (buttonDown(btns[15])) out.add("right");
  if (pad.mapping === "standard") return;
  const axes = pad.axes || [];
  // Linux/Android non-standard pads often expose D-pad on axes[6]/axes[7] or a single hat axis on axes[9].
  if (axes.length >= 8 && Math.abs(axes[6]) <= 1 && Math.abs(axes[7]) <= 1) {
    if (axes[7] < -0.5) out.add("up");
    if (axes[7] > 0.5) out.add("down");
    if (axes[6] < -0.5) out.add("left");
    if (axes[6] > 0.5) out.add("right");
  }
  if (axes.length >= 10) {
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

// Read normalized buttons and sticks from a single Gamepad object (standard or fallback non-standard).
export function readPad(pad, { confirmEast = false } = {}) {
  if (!pad || pad.connected === false) return null;
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
  readDpad(pad, pressed);
  // Non-standard analog triggers sometimes sit on axes[4]/axes[5] (-1 idle to +1 pressed) when buttons[6]/buttons[7] are absent.
  if (pad.mapping !== "standard" && btns.length < 8 && axes.length >= 6) {
    if (axes[4] > 0.25) pressed.add("lt");
    if (axes[5] > 0.25) pressed.add("rt");
  }
  const ls = { x: deadZone(axes[0]), y: deadZone(axes[1]) };
  const rs = axes.length >= 4 ? { x: deadZone(axes[2]), y: deadZone(axes[3]) } : { x: 0, y: 0 };
  return { pressed, ls, rs, style: detectPadStyle(pad.id) };
}

// Combined left and right sticks across all connected gamepads (clamped to [-1, 1] per axis).
export function readSticks(pads = []) {
  let lx = 0, ly = 0, rx = 0, ry = 0;
  for (const pad of pads) {
    if (!pad || pad.connected === false) continue;
    const axes = pad.axes || [];
    lx += deadZone(axes[0]);
    ly += deadZone(axes[1]);
    if (axes.length >= 4) {
      rx += deadZone(axes[2]);
      ry += deadZone(axes[3]);
    }
  }
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return { lx: clamp(lx), ly: clamp(ly), rx: clamp(rx), ry: clamp(ry) };
}

// Left stick vertical scroll value (-128 .. 128, up positive) matching native 0xb38f4, across standard and non-standard pads.
export function leftStickScrollY(pads = []) {
  let y = 0;
  for (const pad of pads) {
    if (!pad || pad.connected === false || !(pad.axes?.length > 1)) continue;
    const v = deadZone(pad.axes[1]);
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
// left/right stick menu navigation, and active controller tracking.
export class GamepadDriver {
  constructor({ config = new PadConfig(), getPads = () => globalThis.navigator?.getGamepads?.() || [] } = {}) {
    this.config = config;
    this.getPads = getPads;
    this.held = new Map();        // logical button -> { next, keySpec }
    this.active = false;          // true while the player's latest input came from a controller
    this.detectedStyle = "xbox";
    this.connected = false;
    this.onModeChange = null;
  }

  labels() {
    return this.config.labels(this.detectedStyle);
  }

  hints() {
    return padHints(this.labels());
  }

  setMode(padActive) {
    const next = !!padActive;
    if (this.active === next) return;
    this.active = next;
    this.onModeChange?.(next, this.labels());
  }

  // Release every held button cleanly (window blur, all pads disconnected, or mode reset).
  releaseAll(handlers) {
    for (const [btn, state] of [...this.held]) {
      this.held.delete(btn);
      this.emitRelease(btn, state, handlers);
    }
  }

  emitRelease(btn, state, handlers) {
    if (state.fast) handlers.fastForward?.(false);
    if (state.keySpec) handlers.keyUp?.(state.keySpec);
  }

  // Called once per animation frame.
  // ctx: { menus, leftStickScrolls, analogViewer, screen, voiceKey, dispatchKey, keyUp, runAction, cancelStory, fastForward, wakeAudio }
  poll(now, ctx) {
    const pads = this.getPads() || [];
    const pressed = new Set();
    let anyConnected = false;
    let anyStickActivity = false;
    let style = this.detectedStyle;

    for (const pad of pads) {
      if (!pad || pad.connected === false) continue;
      anyConnected = true;
      const detected = detectPadStyle(pad.id);
      const reading = readPad(pad, { confirmEast: this.config.confirmEast(detected) });
      if (!reading) continue;
      if (reading.pressed.size || reading.ls.x || reading.ls.y || reading.rs.x || reading.rs.y) {
        style = reading.style;
        anyStickActivity = true;
      }
      for (const b of reading.pressed) pressed.add(b);
      if (ctx.menus && !ctx.analogViewer) {
        // Right stick always mirrors D-pad in menus; left stick mirrors D-pad too unless this screen uses left stick to scroll.
        const sticks = ctx.leftStickScrolls ? [reading.rs] : [reading.ls, reading.rs];
        for (const st of sticks) {
          if (st.y < -STICK_DIR) pressed.add("up");
          if (st.y > STICK_DIR) pressed.add("down");
          if (st.x < -STICK_DIR) pressed.add("left");
          if (st.x > STICK_DIR) pressed.add("right");
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

    // Handle releases before new presses so context transitions don't leave stale keys down.
    for (const [btn, state] of [...this.held]) {
      if (!pressed.has(btn)) {
        this.held.delete(btn);
        this.emitRelease(btn, state, ctx);
      }
    }

    // Handle presses and hold repeats.
    for (const btn of pressed) {
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
