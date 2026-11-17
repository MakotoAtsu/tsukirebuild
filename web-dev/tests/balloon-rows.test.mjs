// Ciel-sensei's balloons keep their rows on the balloon's picture (2026-11-17, from the page-fit reports of the translator tool's Stage 0):
//   - text laid over the English (Aniplex, Portuguese, later translations) wraps at the balloon's inside, textbox.js BALLOON_INSIDE, where the game's
//     table width runs past the picture; the original's and Tsukihimates' own rows are set as before;
//   - Aniplex's corner lines that the official scripts break ("$a^$b", the port's scripts glue b to a) end in a row break (build_aniplex.py).
// The tests that read the game's files or the fit reports skip where those are not there.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); } };
const { TextBox, BALLOON_INSIDE } = await import("../../web/app/js/textbox.js");

const at = (rel) => new URL(`../../${rel}`, import.meta.url);
const json = (rel) => JSON.parse(readFileSync(at(rel), "utf8"));
const there = (rel) => existsSync(at(rel));
const report = (name) => { const r = json(`web-dev/audit/fit-${name}.json`); return typeof r === "string" ? JSON.parse(r) : r; };

// A stand-in for the few DOM calls setWindow makes.
function dom() {
  const make = () => {
    const n = { className: "", style: {}, children: [], dataset: {}, after() {}, appendChild(c) { this.children.push(c); return c; } };
    n.classList = {
      add: (c) => { n.className = [...new Set([...n.className.split(" ").filter(Boolean), c])].join(" "); },
      remove: (c) => { n.className = n.className.split(" ").filter((x) => x && x !== c).join(" "); },
      contains: (c) => n.className.split(" ").includes(c),
    };
    return n;
  };
  const els = { text: make(), panel: make(), note: make() };
  globalThis.document = { getElementById: (id) => els[id] || null, createElement: make, createTextNode: (t) => ({ textContent: t }) };
  return els;
}
// the game's table entry for balloon style 3 (system.json windows), and a full window
const WINDOWS = { styles: [["txtwindow01-1920", 0, 0, 0, 0, 0], ["txtwindow02-1920", 0, 0, 0, 0, 0], ["txtwindow03-1920", 0, 0, 0, 0, 0], ["tw_t_L___V13_E__-39", 525, 414, 98, 80, 299.833]], x: [0], y: [0] };

test("a balloon's rows wrap inside its picture for text laid over the English, and at the game's table width for the English's own", () => {
  const els = dom();
  try {
    const fan = new TextBox();
    assert.equal(fan.insideBalloons, false);   // (the tests run in English: Tsukihimates, no layer)
    fan.windows = WINDOWS;
    fan.setWindow({ style: 3, x: 0, y: 0, style2: 0, x2: 0, y2: 0 });
    assert.equal(parseFloat(els.text.style.width), 299.833 * 3);
    assert.equal(fan.first.width, 299.833 * 3);

    dom();
    const layered = new TextBox();
    layered.insideBalloons = true;   // as for Aniplex (OFFICIAL) or Portuguese (PT): lang.js LAYERS has a layer
    layered.windows = WINDOWS;
    layered.setWindow({ style: 3, x: 0, y: 0, style2: 0, x2: 0, y2: 0 });
    assert.equal(document.getElementById("text").style.width, `${BALLOON_INSIDE[3]}px`);
    assert.equal(layered.first.width, BALLOON_INSIDE[3]);
    assert.ok(BALLOON_INSIDE[3] < 299.833 * 3);
    // a full window is not a balloon: the rule leaves it alone
    layered.setWindow({ style: 0, x: 0, y: 0, style2: 0, x2: 0, y2: 0 });
    assert.equal(document.getElementById("text").style.width, "");
    assert.equal(layered.first, null);
  } finally { delete globalThis.document; }
});

test("BALLOON_INSIDE covers every balloon of the game's table and lies inside its text width", { skip: !there("web/assets/system.json") && "no web/assets" }, () => {
  const styles = json("web/assets/system.json").windows.styles;
  const balloons = styles.map((st, i) => [st, i]).filter(([st, i]) => i >= 3 && st && st[0]);
  assert.equal(balloons.length, 30);
  assert.deepEqual(Object.keys(BALLOON_INSIDE).map(Number).sort((a, b) => a - b), balloons.map(([, i]) => i));
  for (const [st, i] of balloons) {
    assert.ok(BALLOON_INSIDE[i] < st[5] * 3, `style ${i}`);
    assert.ok(BALLOON_INSIDE[i] > st[5] * 3 * 0.8, `style ${i}`);
  }
});

test("every Tsukihimates balloon row is narrower than its balloon's inside, so the rule would move none of them", { skip: !(there("web-dev/audit/fit-en.json") && there("web/assets/system.json")) && "no English fit report" }, () => {
  const styles = json("web/assets/system.json").windows.styles;
  const style = new Map(styles.map((st, i) => [st?.[0], i]));
  const r = report("en");
  assert.equal(r.balloons.length, 649);
  for (const b of r.balloons) {
    if (b.art.length !== 1 || b.width === null) continue;
    assert.ok(b.width <= BALLOON_INSIDE[style.get(b.art[0])], `page ${b.page}: ${b.width} px in ${b.art[0]}`);
  }
});

test("Aniplex: the 512 corner lines the official scripts break from the next line end in a row break; no other line has one", { skip: !(there("web/assets/aniplex/text.json") && there("web-dev/data/line_map.json")) && "no Aniplex text or line map" }, () => {
  const lines = json("web/assets/aniplex/text.json");
  const map = json("web-dev/data/line_map.json");
  const broken = lines.map((l, i) => [l, i]).filter(([l]) => l.includes("\n"));
  assert.equal(broken.length, 512);
  for (const [l, i] of broken) {
    assert.ok(l.endsWith("\n") && l.indexOf("\n") === l.length - 1, `line ${i}`);
    const next = map.lines[i + 1];
    assert.ok(next.glued, `line ${i + 1} is glued to ${i}`);
    assert.equal(map.scenes[next.at[0].s].route, "qa", `line ${i + 1}`);
  }
});

test("the fit reports: no balloon letter off its picture in English or Portuguese, three Aniplex pages at most", { skip: !(there("web-dev/audit/fit-en.json") && there("web-dev/audit/fit-pt.json") && there("web-dev/audit/fit-aniplex.json")) && "no fit reports" }, () => {
  const out = (name) => report(name).balloons.filter((b) => b.out > 0).length;
  assert.equal(out("en"), 0);
  assert.equal(out("pt"), 0);
  // 15308 (QA_07), 15585 and 15601 (QA_18): official rows wider than the balloon in the port's 42 px face, so a fourth row
  assert.ok(out("aniplex") <= 3);
});
