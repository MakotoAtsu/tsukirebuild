// GitHub issue 16 (2026-11-23): in Japanese and Chinese a reading is set by the port over its base (style.css html.ja .ruby / .rt). WebKit keeps an
// <rt> in the row whatever its position, so on iPhones and in Safari each reading took a row of its own (a line of emphasis dots ran off the screen).
// Those two languages now make plain spans; a page saved with the tags is changed as it is restored. (This file runs as Chinese: its own process.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.location = { search: "?lang=zh", hostname: "localhost", href: "http://localhost/?lang=zh" };

class El {
  constructor(tag) { this.tag = tag; this.nodeName = tag.toUpperCase(); this.nodeType = tag === "#text" ? 3 : 1; this.children = []; this.parent = null; this.className = ""; this._text = ""; this.dataset = {}; const me = this;
    this.style = { opacity: "", setProperty() {}, getPropertyValue: () => "" };
    this.classList = { add(c) { const s = new Set(me.className.split(" ").filter(Boolean)); s.add(c); me.className = [...s].join(" "); },
      remove(c) { me.className = me.className.split(" ").filter((x) => x && x !== c).join(" "); },
      contains(c) { return me.className.split(" ").includes(c); } }; }
  get data() { return this._text; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = this; this.children.push(c); return c; }
  replaceWith(n) { const p = this.parent; if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); p.children[p.children.indexOf(this)] = n; n.parent = p; this.parent = null; }
  get textContent() { return this.tag === "#text" ? this._text : this.children.map((c) => c.textContent).join(""); }
  set textContent(t) { this.children = []; if (t) { const n = new El("#text"); n._text = t; n.parent = this; this.children.push(n); } }
  matches(sel) { return this.tag !== "#text" && sel.split(",").map((s) => s.trim()).some((s) => (s[0] === "." ? this.classList.contains(s.slice(1)) : this.tag === s)); }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matches(sel)) return n; return null; }
  all(t) { const out = [], walk = (n) => { for (const c of n.children) { if (t(c)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelectorAll(sel) {
    const inside = /^(?::is\((.+)\)|(\S+)) \.ch$/.exec(sel);
    if (inside) return this.all((c) => c.matches(".ch") && c.closest(inside[1] || inside[2]));
    return this.all((c) => c.matches(sel));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
globalThis.document = { documentElement: new El("html"), styleSheets: [], getElementById: () => null, createElement: (t) => new El(t), createTextNode: (t) => { const n = new El("#text"); n._text = t; return n; } };

const lang = await import("../../web/app/js/lang.js");
const textbox = await import("../../web/app/js/textbox.js");

test("Issue 16: Chinese and Japanese readings are spans, not <ruby> / <rt>; the line's text leaves them out", () => {
  assert.equal(lang.ORIG, true);
  const seg = new El("span");
  const { chars, ruby } = textbox.fillSegment(seg, "<真|・><的|・>话");
  const tags = seg.all((n) => n.tag !== "#text").map((n) => `${n.tag}.${n.className}`);
  assert.ok(!tags.some((t) => t.startsWith("ruby.") || t.startsWith("rt.")), tags.join(" "));
  assert.equal(seg.querySelectorAll(".ruby").length, 2);
  assert.equal(seg.querySelectorAll(".rt").length, 2);
  assert.equal(chars.length, 3);   // 真 的 话: the dots are no letters of the typing
  assert.equal(ruby.length, 2);
  assert.equal(textbox.lineText({ segs: [seg] }), "真\n的话");
});

test("Issue 16: a page saved with <ruby> / <rt> gets the spans, its classes and data kept", () => {
  const root = new El("div");
  const seg = root.appendChild(new El("span")); seg.className = "seg";
  const r = seg.appendChild(new El("ruby")); r.className = "italic";
  const base = r.appendChild(new El("span")); base.className = "ch on"; base.textContent = "外";
  const rt = r.appendChild(new El("rt")); rt.dataset.len = "1";
  const dot = rt.appendChild(new El("span")); dot.className = "ch on"; dot.textContent = "・";
  textbox.spanReadings(root);
  const [nr] = seg.children;
  assert.equal(nr.tag, "span");
  assert.equal(nr.className, "ruby italic");
  const [b, nrt] = nr.children;
  assert.equal(b, base);
  assert.equal(nrt.tag, "span");
  assert.equal(nrt.className, "rt");
  assert.equal(nrt.dataset.len, "1");
  assert.deepEqual(nrt.children, [dot]);
  assert.equal(root.querySelectorAll("ruby").length + root.querySelectorAll("rt").length, 0);
});

test("Issue 16: the Japanese / Chinese reading styles name the spans", () => {
  const css = readFileSync(new URL("../../web/app/style.css", import.meta.url), "utf8");
  const rules = css.split("\n").filter((l) => /^html\.ja [^{]*\b(rt|ruby)\b/.test(l));
  assert.ok(rules.length >= 3);
  for (const l of rules) assert.match(l, /:is\(rt, \.rt\)|:is\(ruby, \.ruby\)/, l);
});
