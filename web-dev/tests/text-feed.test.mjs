// The desktop app's text feed (web-dev/desktop/textfeed.js): the story's lines, as plain text, to text-extraction tools such as texthooker-ui
// over a WebSocket on the player's own computer. What the page hands over (TextBox.onLine), the feed itself on real sockets, and how the app and
// the page are wired to it. The socket tests need the desktop app's packages (cd web-dev/desktop && npm install); without them they are skipped.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import http from "node:http";
import net from "node:net";
import { execFileSync } from "node:child_process";

globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } };
const { TextBox, lineText } = await import("../../web/app/js/textbox.js");

const at = (rel) => new URL(`../../${rel}`, import.meta.url);
const read = (rel) => readFileSync(at(rel), "utf8");
const HAVE_WS = existsSync(at("web-dev/desktop/node_modules/ws/package.json"));
const feedModule = () => createRequire(import.meta.url)("../desktop/textfeed.js");

// A port nothing listens on just now.
const freePort = () => new Promise((done, fail) => {
  const s = net.createServer();
  s.once("error", fail);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => done(port)); });
});
// A client as a texthooker page is one (Node's own WebSocket, the browser's): the messages it gets, and a wait for the next.
function client(url) {
  const ws = new WebSocket(url), got = [], waiting = [];
  ws.addEventListener("message", (e) => { got.push(e.data); waiting.shift()?.(e.data); });
  const opened = new Promise((done, fail) => { ws.addEventListener("open", done, { once: true }); ws.addEventListener("error", () => fail(Error(`no connection to ${url}`)), { once: true }); });
  const next = (ms = 2000) => new Promise((done, fail) => { const t = setTimeout(() => fail(Error("no message")), ms); waiting.push((v) => { clearTimeout(t); done(v); }); });
  return { ws, got, opened, next };
}
const settle = () => new Promise((done) => setTimeout(done, 100));

// ---- what the page hands over ------------------------------------------------------------------------------------------------------------------
test("each line logged goes to onLine as plain text: the ruby's base, an inline piece on its own, a choice's rows together", () => {
  const t = new TextBox(), got = [];
  t.onLine = (line) => got.push(line);
  t.log("<遠野|とおの>は@c1歩いた@c0。");   // (colour marks as colourMarks leaves them, vm.js)
  t.log("  ");                                      // (nothing to read: not logged, not told)
  t.log(" And more.", null, { inline: true });      // MSAD: the backlog joins it to the line before; the feed has it as it comes
  t.logChoice(["1.Yes", "2.<否|いな>"]);
  assert.deepEqual(got, ["遠野は歩いた。", " And more.", "1.Yes\n2.否"]);
  assert.equal(t.history[0].text, "遠野は歩いた。 And more.");
  // a listener that fails stops nothing
  t.onLine = () => { throw Error("gone"); };
  t.log("Still logged.");
  assert.equal(t.history.at(-1).text, "Still logged.");
  // and with no listener (the site, the Android app, an older desktop app) it is as before
  const u = new TextBox();
  u.log("Plain.");
  assert.equal(u.history.length, 1);
});

test("a line typed again (a load, Quick Jump, going back) is read back from the page for onLine, without the ruby's readings", () => {
  // the page as a restore leaves it: segments of letters, a ruby with its reading in <rt>, a dash run
  const t = (data) => ({ nodeType: 3, data });
  const e = (nodeName, ...childNodes) => ({ nodeType: 1, nodeName, childNodes, querySelectorAll: () => [] });   // (no letters to type: retype stops after telling)
  const ln = { segs: [
    e("SPAN", t("　いま、"), e("RUBY", e("SPAN", t("殊")), e("SPAN", t("更")), e("RT", e("SPAN", t("こと")), e("SPAN", t("さら")))), e("SPAN", t("に"))),
    e("SPAN", t("思いだす事があるとすれば、それは"), e("SPAN", t("―――"))),
  ] };
  assert.equal(lineText(ln), "　いま、殊更に思いだす事があるとすれば、それは―――");
  assert.equal(lineText(null), "");
  // retype tells it (a TextBox with that line on its page)
  const box = new TextBox(), got = [];
  box.onLine = (line) => got.push(line);
  box.lines = [ln];
  box.finish = () => {};
  box.retype();
  assert.deepEqual(got, ["　いま、殊更に思いだす事があるとすれば、それは―――"]);
  box.lines = [{ segs: [e("SPAN", t("  "))] }];
  box.retype();
  assert.equal(got.length, 1, "nothing to read: nothing told");
});

// ---- the feed ------------------------------------------------------------------------------------------------------------------------------------
test("--text-port: a whole number from 0 (off) to 65535 that a browser connects to, else 6677 (texthooker-ui's own default)", { skip: !HAVE_WS && "no ws: cd web-dev/desktop && npm install" }, () => {
  const { portOf, PORT } = feedModule();
  assert.equal(PORT, 6677);
  for (const [given, port] of [[null, 6677], [undefined, 6677], ["", 6677], ["0", 0], ["7000", 7000], ["65535", 65535], ["65536", 6677], ["-1", 6677], ["abc", 6677], ["66.5", 6677], ["6679", 6677], ["6697", 6677], ["10080", 6677], ["6680", 6680]]) {   // (6679 and the like: ports browsers refuse)
    assert.equal(portOf(given), port, String(given));
  }
});

test("the feed sends each line to every page connected, on 127.0.0.1 and ::1 (localhost), and reads nothing they send", { skip: !HAVE_WS && "no ws: cd web-dev/desktop && npm install" }, async () => {
  const { TextFeed } = feedModule();
  const port = await freePort(), said = [];
  const feed = new TextFeed({ port, log: (m) => said.push(m) });
  try {
    assert.equal(feed.info(), null, "nothing before it listens");
    assert.equal(await feed.start(), true);
    assert.deepEqual(feed.info(), { port });
    const a = client(`ws://localhost:${port}`), b = client(`ws://127.0.0.1:${port}`);
    await Promise.all([a.opened, b.opened]);
    let v6 = null;
    try { v6 = client(`ws://[::1]:${port}`); await v6.opened; } catch { v6 = null; }   // (a computer without IPv6)
    const lines = ["遠野は歩いた。", "1.Yes\n2.No"];
    for (const line of lines) {
      const arrived = [a.next(), b.next(), v6?.next()];
      feed.send(line);
      assert.deepEqual((await Promise.all(arrived)).slice(0, v6 ? 3 : 2), Array(v6 ? 3 : 2).fill(line));
    }
    // not a line: nothing goes out
    feed.send("");
    feed.send("   ");
    feed.send(42);
    // a page's own message is not read, and one too long for the feed closes that page only
    a.ws.send("hello");
    const closed = new Promise((done) => b.ws.addEventListener("close", done, { once: true }));
    b.ws.send("x".repeat(5000));
    await closed;
    feed.send("After.");
    assert.equal(await a.next(), "After.");
    await settle();
    assert.deepEqual(a.got, [...lines, "After."]);
    // a very long line is cut, not refused
    feed.send("あ".repeat(5000));
    assert.equal((await a.next()).length, 4000);
    // a plain request is told what this is
    const status = await new Promise((done, fail) => http.get(`http://127.0.0.1:${port}/`, (r) => { r.resume(); done(r.statusCode); }).on("error", fail));
    assert.equal(status, 426);
    a.ws.close();
    v6?.ws.close();
    assert.deepEqual(said, []);
  } finally { feed.close(); }
  assert.equal(feed.info(), null);
  await settle();
  // closed: the port is free again
  const again = new TextFeed({ port });
  try { assert.equal(await again.start(), true); } finally { again.close(); }
});

test("a port another program has is left to it: no feed, nothing thrown, and the page is told there is none", { skip: !HAVE_WS && "no ws: cd web-dev/desktop && npm install" }, async () => {
  const { TextFeed } = feedModule();
  const port = await freePort();
  const other = net.createServer();
  await new Promise((done) => other.listen(port, "127.0.0.1", done));
  const said = [];
  const feed = new TextFeed({ port, log: (m) => said.push(m) });
  try {
    assert.equal(await feed.start(), false);
    assert.equal(feed.info(), null);
    feed.send("Nobody hears this.");
    assert.equal(said.length, 1);
    assert.match(said[0], new RegExp(`port ${port} is not free \\(EADDRINUSE\\)`));
  } finally { feed.close(); other.close(); }
  // and --text-port=0 is no feed at all
  const off = new TextFeed({ port: 0 });
  assert.equal(await off.start(), false);
  assert.equal(off.info(), null);
  off.send("Nothing.");
  off.close();
});

// ---- LunaTranslator ------------------------------------------------------------------------------------------------------------------------------
// A stand-in for LunaTranslator's network service as network/server/tcpservice.py is: IPv4, one request a connection, each answered in a thread
// of its own (here: after a random wait, so lines sent together would overtake each other), "HTTP/1.1 200 " with no length, then closed.
async function lunaStandIn({ answer = true } = {}) {
  const paths = [];
  const server = net.createServer((sock) => {
    let head = "";
    sock.on("data", (d) => {
      head += d.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      paths.push(head.split("\r\n")[0].split(" ")[1]);
      if (!answer) return;   // (hangs: the sender's timeout ends it)
      setTimeout(() => { sock.end("HTTP/1.1 200 \r\nAccess-Control-Allow-Origin: *\r\n\r\n"); }, Math.random() * 25);
    });
    sock.on("error", () => {});
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { port: server.address().port, paths, close: () => server.close() };
}
// The text as LunaTranslator reads it: urlsplit + parse_qsl (TextInput: _.query.get("text")), in Python itself.
const asLunaReads = (paths) => JSON.parse(execFileSync("python3", ["-I", "-c",
  "import json, sys\nfrom urllib.parse import urlsplit, parse_qsl\nprint(json.dumps([[urlsplit(p).path, dict(parse_qsl(urlsplit(p).query)).get('text')] for p in json.load(sys.stdin)]))"],
  { input: JSON.stringify(paths), encoding: "utf8" }));

test("--luna-port: a whole number from 0 (off) to 65535, else 2333 (LunaTranslator's own default)", { skip: !HAVE_WS && "no ws: cd web-dev/desktop && npm install" }, () => {
  const { lunaPortOf, LUNA_PORT } = feedModule();
  assert.equal(LUNA_PORT, 2333);
  for (const [given, port] of [[null, 2333], ["", 2333], ["0", 0], ["9000", 9000], ["65536", 2333], ["-1", 2333], ["x", 2333]]) assert.equal(lunaPortOf(given), port, String(given));
});

test("LunaTranslator gets each line at /api/textinput, one at a time and in order, its text intact as its own parser reads it", { skip: !HAVE_WS && "no ws: cd web-dev/desktop && npm install" }, async () => {
  const { LunaFeed } = feedModule();
  const luna = await lunaStandIn();
  const feed = new LunaFeed({ port: luna.port });
  try {
    assert.deepEqual(feed.info(), { port: luna.port });
    const lines = ["　いま、殊更に思いだす事があるとすれば、それは―――", "１．父親である遠野槙久の事だ。\n２．やはり、妹の秋葉の事だ。", "A + B & C = 100% #1? /path", "  spaced  "];
    for (let i = 0; i < 30; i++) lines.push(`Line ${i}: 「${"あ".repeat(i)}」`);   // (a fast-forward burst)
    for (const line of lines) feed.send(line);
    feed.send("");
    feed.send("   ");
    feed.send(42);
    await feed.drained();
    assert.equal(feed.reached, true);
    assert.deepEqual(asLunaReads(luna.paths), lines.map((l) => ["/api/textinput", l]));
    // a very long line is cut, not refused
    feed.send("い".repeat(5000));
    await feed.drained();
    assert.equal(asLunaReads(luna.paths.slice(-1))[0][1].length, 4000);
  } finally { feed.close(); luna.close(); }
});

test("with LunaTranslator not listening, or too slow, lines are dropped quietly and the queue stays bounded; port 0 is none", { skip: !HAVE_WS && "no ws: cd web-dev/desktop && npm install" }, async () => {
  const { LunaFeed } = feedModule();
  // nothing on the port: each line is refused at once
  const none = new LunaFeed({ port: await freePort() });
  for (let i = 0; i < 5; i++) none.send(`Lost ${i}`);
  const t0 = Date.now();
  await none.drained();
  assert.equal(none.reached, false);
  assert.ok(Date.now() - t0 < 2000, "refused quickly");
  none.close();
  // a service that never answers: the timeout moves on, and no more than 200 lines wait
  const hung = await lunaStandIn({ answer: false });
  const slow = new LunaFeed({ port: hung.port, timeout: 100 });
  for (let i = 0; i < 260; i++) slow.send(`Waiting ${i}`);
  assert.ok(slow.queue.length <= 200, `queue ${slow.queue.length}`);
  assert.equal(slow.queue.at(-1), "Waiting 259", "the newest kept, the oldest dropped");
  slow.close();
  await slow.drained();
  hung.close();
  // --luna-port=0
  const off = new LunaFeed({ port: 0 });
  assert.equal(off.info(), null);
  off.send("Nothing.");
  await off.drained();
  assert.equal(off.queue.length, 0);
});

// ---- how the app and the page are wired --------------------------------------------------------------------------------------------------------
test("the desktop app starts the feed and LunaTranslator's sender when ready, tells the page of them in info, takes lines through `text`, and packs textfeed.js and ws", () => {
  const main = read("web-dev/desktop/main.js");
  assert.match(main, /const \{ TextFeed, portOf, LunaFeed, lunaPortOf \} = require\("\.\/textfeed\.js"\);/);
  assert.match(main, /const TEXT_PORT = portOf\(flag\("text-port"\)\);\nconst LUNA_PORT = lunaPortOf\(flag\("luna-port"\)\);/);
  assert.match(main, /const feedInfo = \(\) => \{ const ws = feed\?\.info\(\), lu = luna\?\.info\(\); return ws \|\| lu \? \{ port: ws\?\.port \?\? null, luna: lu\?\.port \?\? null \} : null; \};/);
  assert.match(main, /\n  info: async \(\) => \{ await feedStarted; return \{ [^\n]*text: feedInfo\(\) \}; \},/);
  assert.match(main, /\n  text: \(\{ line \}\) => \{ const s = typeof line === "string" \? line : ""; feed\?\.send\(s\); luna\?\.send\(s\); return \{\}; \},/);
  assert.match(main, /app\.whenReady\(\)\.then\(\(\) => \{\n    loadUpdater\(\);\n    feed = new TextFeed\(\{ port: TEXT_PORT \}\);\n    feedStarted = feed\.start\(\)\.catch\(\(\) => false\);[^\n]*\n    luna = new LunaFeed\(\{ port: LUNA_PORT \}\);/);
  assert.match(main, /app\.on\("will-quit", \(\) => \{ feed\?\.close\(\); luna\?\.close\(\); \}\);/);
  // listening on this computer only
  const feed = read("web-dev/desktop/textfeed.js");
  assert.match(feed, /await listen\("127\.0\.0\.1"\)/);
  assert.match(feed, /await listen\("::1"\)/);
  assert.equal((feed.match(/\.listen\(/g) || []).length, 1, "one listen call, given the address each time");
  // packed: the module in the app's files, ws as a dependency of the app (not of the build), installed by build.sh when missing
  const pack = JSON.parse(read("web-dev/desktop/package.json"));
  assert.ok(pack.build.files.includes("textfeed.js"));
  assert.match(pack.dependencies.ws, /^\d+\.\d+\.\d+$/, "an exact version");
  assert.equal(pack.devDependencies.ws, undefined);
  assert.equal(JSON.parse(read("web-dev/desktop/package-lock.json")).packages["node_modules/ws"].version, pack.dependencies.ws);
  assert.match(read("web-dev/desktop/build.sh"), /\[ -d node_modules\/electron-builder \] && \[ -d node_modules\/ws \] \|\| npm install/);
});

test("the page sends a line only when the app's info names a feed, and none of a run that passes everything at once", () => {
  const page = read("web/app/js/main.js");
  assert.match(page, /import \{ HOST \} from "\.\/apphost\.js";/);
  assert.match(page, /HOST\?\.call\("info"\)\.then\(\(info\) => \{\n  if \(info\?\.text\) text\.onLine = \(line\) => \{ if \(!vm\.fast\) HOST\.call\("text", \{ line \}\)\.catch\(\(\) => \{\}\); \};\n\}\)\.catch\(\(\) => \{\}\);/);
  const host = read("web/app/js/apphost.js");
  assert.ok(host.includes("//   text         { line }"));
  // the Android app has no feed: `text` is the desktop's alone, and the page never asks it of an app whose info does not name one
  assert.ok(!read("web-dev/android/src/date/arcueid/tsukirebuild/MainActivity.java").includes('case "text":'));
});
