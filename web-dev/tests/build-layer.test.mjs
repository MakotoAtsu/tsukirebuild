// web-dev/tools/build_layer.py (the translator tool's Stage 1): a translations folder laid over the English -> a language folder, with the checks that
// stop a build. On an invented miniature text (no line of the game's), so it runs anywhere python3 does.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL = new URL("../../web-dev/tools/build_layer.py", import.meta.url).pathname;
const python = (() => { try { execFileSync("python3", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const hash = (s) => createHash("sha1").update(s, "utf8").digest("hex").slice(0, 12);

// A root with a five-line English (line 3 a choice, line 4 never shown), its "Japanese", and a line map of two scenes.
function world() {
  const root = mkdtempSync(join(tmpdir(), "layer-"));
  const english = ["The moon is out.", "A <cat|neko> sleeps.\nOn the roof.", "@gQuiet@g night.", " Go home.", "unused"];
  const ja = ["月が出ている。", "猫が寝ている。", "静かな夜。", "帰る。", "未使用"];
  mkdirSync(join(root, "web", "assets", "ja"), { recursive: true });
  writeFileSync(join(root, "web", "assets", "text.json"), JSON.stringify(english));
  writeFileSync(join(root, "web", "assets", "ja", "text.json"), JSON.stringify(ja));
  const map = { scenes: [{ name: "01_00_ARC01_1" }, { name: "QA_01" }], unnamed: [4],
    lines: [{ id: 0, at: [{ s: 0 }] }, { id: 1, at: [{ s: 0 }] }, { id: 2, at: [{ s: 1 }] }, { id: 3, at: [{ s: 0 }], choice: 1 }, { id: 4, at: [] }] };
  writeFileSync(join(root, "map.json"), JSON.stringify(map));
  const folder = join(root, "tl");
  mkdirSync(folder);
  return { root, folder, english, ja };
}
const scene = (folder, name, lines) => writeFileSync(join(folder, `${name}.json`), JSON.stringify({ scene: name, lines }));
const run = (w, ...extra) => spawnSync("python3", ["-I", TOOL, "xx", w.folder, "--root", w.root, "--map", join(w.root, "map.json"), "--out", join(w.root, "out"), ...extra], { encoding: "utf8" });

test("a translation is laid over the English: its lines where it has them, the English everywhere else", { skip: !python && "no python3" }, () => {
  const w = world();
  try {
    scene(w.folder, "01_00_ARC01_1", [{ id: 0, text: "La lune est là.", status: "draft", from: { lang: "ja", hash: hash(w.ja[0]) } },
      { id: 1, text: "", status: "empty" }, { id: 3, text: " Rentrer.", status: "final" }]);
    scene(w.folder, "QA_01", [{ id: 2, text: "@gNuit@g calme.\nTrès.", status: "reviewed" }]);   // (a corner keeps its rows)
    const r = run(w);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(readFileSync(join(w.root, "out", "text.json"), "utf8"));
    assert.deepEqual(out, ["La lune est là.", w.english[1], "@gNuit@g calme.\nTrès.", " Rentrer.", "unused"]);
    assert.deepEqual(JSON.parse(readFileSync(join(w.root, "out", "index.json"), "utf8")), { files: ["text.json"] });
    assert.match(r.stdout, /xx: 3 lines translated \(empty 1, draft 1, reviewed 1, final 1\); 2 in English/);
    assert.doesNotMatch(r.stdout, /warning/);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test("an error in any line stops the build and writes nothing", { skip: !python && "no python3" }, () => {
  const cases = [
    [[{ id: 9, text: "x" }], /no such line/],
    [[{ id: 0, text: "a" }, { id: 0, text: "b" }], /given again/],
    [[{ id: 2, text: "x" }], /scene 01_00_ARC01_1 does not show this line \(QA_01 does\)/],
    [[{ id: 0, text: "a\tb" }], /a tab/],
    [[{ id: 0, text: "a%{n}b" }], /a deepLuna code/],
    [[{ id: 0, text: "a @q b" }], /marks the English never uses: @q/],
    [[{ id: 0, text: "a [heart] b" }], /marks the English never uses: \[heart\]/],
    [[{ id: 1, text: "a <cat b" }], /a ruby <base\|reading> not closed/],
    [[{ id: 1, text: "a <cat> b" }], /a ruby <base\|reading> not closed/],
    [[{ id: 0, text: "x", status: "done" }], /status 'done' is none of empty, draft, reviewed, final/],
  ];
  for (const [lines, why] of cases) {
    const w = world();
    try {
      scene(w.folder, "01_00_ARC01_1", lines);
      const r = run(w);
      assert.equal(r.status, 1, `${why}: ${r.stdout}`);
      assert.match(r.stdout, why);
      assert.match(r.stdout, /errors?: nothing written/);
      assert.equal(existsSync(join(w.root, "out")), false);
    } finally { rmSync(w.root, { recursive: true, force: true }); }
  }
  // no such folder, or no scene files in it: an error, not an English build over the language
  for (const make of [(w) => rmSync(w.folder, { recursive: true }), () => {}]) {
    const w = world();
    try {
      make(w);
      const r = run(w);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout, /no such folder|no scene files/);
      assert.equal(existsSync(join(w.root, "out")), false);
    } finally { rmSync(w.root, { recursive: true, force: true }); }
  }
  // a file not named after its scene
  const w = world();
  try {
    writeFileSync(join(w.folder, "wrong.json"), JSON.stringify({ scene: "01_00_ARC01_1", lines: [] }));
    const r = run(w);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /wrong\.json: the file of scene 01_00_ARC01_1 is named 01_00_ARC01_1\.json/);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test("warnings: a stale source line, a line left as its source, a choice with a row break, a break in a story line, a line never shown", { skip: !python && "no python3" }, () => {
  const w = world();
  try {
    scene(w.folder, "01_00_ARC01_1", [
      { id: 0, text: "La lune.", status: "draft", from: { lang: "ja", hash: "000000000000" } },
      { id: 1, text: w.ja[1], status: "draft", from: { lang: "ja", hash: hash(w.ja[1]) } },
      { id: 3, text: " Ren-\ntrer.", status: "draft" },
      { id: 4, text: "jamais", status: "draft" },
    ]);
    const r = run(w, "--check");
    assert.equal(r.status, 0, r.stdout);
    for (const kind of ["stale: 1", "source left in: 1", "choice with a row break: 1", "line break in a story line: 1", "never shown: 1"]) assert.match(r.stdout, new RegExp(`warning: ${kind}`));
    assert.equal(existsSync(join(w.root, "out")), false, "--check writes nothing");
    // a deepLuna language's lines carry its row breaks: no warning for them
    writeFileSync(join(w.folder, "language.json"), JSON.stringify({ code: "xx", breaks: "deepluna" }));
    assert.doesNotMatch(run(w, "--check").stdout, /line break in a story line/);
    writeFileSync(join(w.folder, "language.json"), JSON.stringify({ code: "yy" }));
    assert.match(run(w, "--check").stdout, /language\.json is for 'yy', not 'xx'/);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test("line_hash is the first 12 hex of the line's SHA-1, as importers write from.hash", { skip: !python && "no python3" }, () => {
  const got = execFileSync("python3", ["-I", "-c", `import importlib.util; s = importlib.util.spec_from_file_location("b", ${JSON.stringify(TOOL)}); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.line_hash("月が出ている。"))`], { encoding: "utf8" }).trim();
  assert.equal(got, hash("月が出ている。"));
});
