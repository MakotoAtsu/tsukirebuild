// textfeed.js - the story's text for text-extraction tools: a page such as texthooker-ui, with a dictionary like Yomitan over it, connects
// to a WebSocket on the player's own computer and shows each message that arrives as a line to look words up in. The app is that
// WebSocket. Each line the story shows (the page's TextBox.log and logChoice, passed on through `host.text` in main.js) goes to every page
// connected, as plain text, which is what those tools take.
// It listens on this computer only (127.0.0.1 and ::1): nothing on the network reaches it, and Windows asks no firewall question. What a
// page sends it is not read. --text-port=N gives it another port and --text-port=0 turns it off. A port another program already has is
// left to that program: the feed is then off until the app is started again.
// LunaTranslator reads no WebSocket, so the same lines also go to the clipboard while it runs (ClipboardFeed, below).
const http = require("node:http");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = 6677;      // texthooker-ui's own default (ws://localhost:6677, src/stores/stores.ts websocketUrl$)
const LONGEST = 4000;   // characters of one message, at most (a page of the story is far less)

// The ports a browser will not connect to (the Fetch standard's "bad ports": mail, IRC and the like). A texthooker page is a web page, so
// a feed on one of these would never be reached (seen: ws://localhost:6679 refused by Node's own WebSocket, as Chrome refuses it).
const REFUSED = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113,
  115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636,
  989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

// The port from --text-port=N: a whole number from 0 (off) to 65535 that a browser connects to, else the default.
function portOf(value) {
  if (value === null || value === undefined || value === "") return PORT;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 65535 && !REFUSED.has(n) ? n : PORT;
}

class TextFeed {
  constructor({ port = PORT, log = (m) => console.error(m) } = {}) {
    this.port = port;
    this.log = log;
    this.servers = [];
    this.wss = null;
    this.on = false;
  }

  // Listens, and resolves true; or resolves false when it cannot (off, or the port taken). It never throws.
  async start() {
    if (!this.port) return false;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
    this.wss.on("connection", (ws) => ws.on("error", () => {}));   // (a page that goes away mid-message: nothing to do)
    const listen = (host) => new Promise((done) => {
      const server = http.createServer((req, res) => {
        res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8", Upgrade: "websocket" });
        res.end("The game's text, for a WebSocket client such as texthooker-ui.\n");
      });
      server.on("upgrade", (req, socket, head) => this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req)));
      server.once("error", (e) => { server.close(); done(e); });
      server.listen(this.port, host, () => {
        server.removeAllListeners("error");
        server.on("error", (e) => this.log(`text feed (${host}): ${e.message}`));
        this.servers.push(server);
        done(null);
      });
    });
    const failed = await listen("127.0.0.1");
    if (failed) {
      this.log(`text feed: port ${this.port} is not free (${failed.code || failed.message}), so there is no feed`);
      this.close();
      return false;
    }
    await listen("::1");   // ("localhost" can be either; a computer without IPv6 has the feed on 127.0.0.1 alone)
    this.on = true;
    return true;
  }

  // One line to every page connected.
  send(line) {
    if (!this.on || typeof line !== "string" || !line.trim()) return;
    const text = line.length > LONGEST ? line.slice(0, LONGEST) : line;
    for (const ws of this.wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }

  // What the page is told (main.js host.info): the port, or null when there is no feed.
  info() { return this.on ? { port: this.port } : null; }

  close() {
    this.on = false;
    for (const ws of this.wss?.clients || []) ws.terminate();
    for (const s of this.servers) s.close();
    this.servers = [];
    this.wss?.close();
    this.wss = null;
  }
}

// ---- the clipboard, for LunaTranslator -----------------------------------------------------------------------------------------------------
// LunaTranslator reads no WebSocket. It takes other programs' text from the clipboard (its "Clipboard" text source, textio/textsource/
// copyboard.py): each change is a line, handled as a hooked one. (Its network service's /api/textinput is for text typed in by hand: it
// brings LunaTranslator's window to the front for every line, and crashed LunaTranslator for a player, 2026-11-18.) So each line goes to
// the clipboard too, but only while LunaTranslator is running ("auto"), so that nobody else's clipboard is touched: --clipboard=on for
// always, --clipboard=off for never. The lines go a little apart, so that each change is read before the next.
const { execFile } = require("node:child_process");
const CLIP_GAP = 60;          // ms between two lines on the clipboard
const CLIP_WAITING = 30;      // lines held for it (fast forward); beyond that the oldest are dropped
const LOOK_EVERY = 5000;      // ms a look for LunaTranslator holds

// --clipboard=on|off|auto (auto if not given).
const clipboardModeOf = (value) => (value === "on" || value === "off" ? value : "auto");

// Whether LunaTranslator is running: one of tasklist's rows names a program whose name starts with it (LunaTranslator.exe and the like).
const hasLuna = (csv) => String(csv).split(/\r?\n/).some((row) => /^"lunatranslator[^"]*\.exe"/i.test(row.trim()));
function lunaRunning({ platform = process.platform, exec = execFile } = {}) {
  if (platform !== "win32") return Promise.resolve(false);   // (LunaTranslator is Windows only)
  return new Promise((done) => exec("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5000, maxBuffer: 8 << 20 },
    (err, out) => done(!err && hasLuna(out))));
}

class ClipboardFeed {
  constructor({ mode = "auto", write, running = lunaRunning, gap = CLIP_GAP, lookEvery = LOOK_EVERY, now = Date.now } = {}) {
    this.mode = clipboardModeOf(mode);
    this.write = write;
    this.running = running;
    this.gap = gap;
    this.lookEvery = lookEvery;
    this.now = now;
    this.queue = [];
    this.busy = false;
    this.closed = false;
    this.looked = null;       // { at, running } of the last look for LunaTranslator
    this.written = 0;
    this.idle = [];
  }

  // One line, written after those before it.
  send(line) {
    if (this.mode === "off" || this.closed || typeof line !== "string" || !line.trim()) return;
    this.queue.push(line.length > LONGEST ? line.slice(0, LONGEST) : line);
    if (this.queue.length > CLIP_WAITING) this.queue.splice(0, this.queue.length - CLIP_WAITING);
    this.next();
  }

  // Whether the lines are wanted now: always ("on"), or while LunaTranslator runs ("auto", looked for again after lookEvery).
  async wanted() {
    if (this.mode === "on") return true;
    if (this.looked && this.now() - this.looked.at < this.lookEvery) return this.looked.running;
    const at = this.now();
    let running = false;
    try { running = !!(await this.running()); } catch { /* not running, as far as can be told */ }
    this.looked = { at, running };
    return running;
  }

  async next() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length && !this.closed) {
      if (!(await this.wanted())) { this.queue = []; break; }
      const line = this.queue.shift();
      try { this.write(line); this.written++; } catch { /* the clipboard held by another program: that line is lost */ }
      await new Promise((done) => setTimeout(done, this.gap));
    }
    this.busy = false;
    for (const done of this.idle.splice(0)) done();
  }

  // Settles once every line handed over has been written or dropped.
  drained() { return this.busy || this.queue.length ? new Promise((done) => this.idle.push(done)) : Promise.resolve(); }

  info() { return this.mode === "off" || this.closed ? null : { mode: this.mode }; }

  close() { this.closed = true; this.queue = []; }
}

module.exports = { TextFeed, portOf, PORT, ClipboardFeed, clipboardModeOf, lunaRunning, hasLuna };
