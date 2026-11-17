// The table of languages (web/app/js/languages.js, the translator tool's Stage 1): every list of the languages is worked out from it, in the page and in
// web-dev/tools/app_manifest.py, so a language is a row there. The lists it gives are the ones the page had written out before (2026-11-17).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

globalThis.localStorage = { s: {}, getItem(k) { return this.s[k] ?? null; }, setItem(k, v) { this.s[k] = String(v); } };
const T = await import("../../web/app/js/languages.js");
const L = await import("../../web/app/js/lang.js");
const H = await import("../../web/app/js/home.js");
const U = await import("../../web/app/js/update.js");
const ROOT = new URL("../../", import.meta.url).pathname;
const SRC = readFileSync(new URL("../../web/app/js/languages.js", import.meta.url), "utf8");
const python = (code) => JSON.parse(execFileSync("python3", ["-I", "-c", `import json, sys; sys.path.insert(0, 'web-dev/tools'); import app_manifest as a; ${code}`], { cwd: ROOT, encoding: "utf8" }));

test("the table is JSON between its two marks, and is what the module exports", () => {
  const m = /\/\* languages: \*\/([\s\S]*?)\/\* :languages \*\//.exec(SRC);
  assert.ok(m, "the marks app_manifest.py reads by");
  assert.deepEqual(JSON.parse(m[1]), T.LANGUAGE_TABLE);
  for (const r of T.LANGUAGE_TABLE) {
    assert.match(r.code, /^[a-z]{2,3}$/);
    assert.ok(r.plate && r.row, r.code);
    if (r.coming) continue;
    for (const k of ["name", "start", "html", "scripts"]) assert.equal(typeof r[k], "string", `${r.code}.${k}`);
    assert.ok(Array.isArray(r.layers), r.code);
  }
});

test("the lists the page shows and the apps use are the ones it had written out", () => {
  assert.deepEqual(L.LANGS, ["en", "ja", "zh", "pt"]);
  assert.deepEqual(H.LANG_PLATES, [{ lang: "en", plate: "ENGLISH" }, { lang: "ja", plate: "日本語" }, { lang: "zh", plate: "中文" }, { lang: "pt", plate: "PORTUGUÊS" }]);
  assert.deepEqual(H.LANG_ROWS.map((r) => r[0]), ["ENGLISH", "日本語", "中文", "PORTUGUÊS", "ESPAÑOL"]);
  assert.equal(H.langLineFor("android").note, "日本語, 中文 and PORTUGUÊS are downloaded the first time they are chosen.\nSaves and progress carry over between languages. L changes it.");
  assert.deepEqual(Object.keys(H.LANG_NOW), ["en", "aniplex", "ja", "zh", "pt", "change"]);
  assert.deepEqual(U.LANG_DIRS, { ja: ["ja"], zh: ["ja", "zh"], pt: ["pt"] });
  assert.deepEqual(U.LANG_NAMES, { en: "English", ja: "Japanese", zh: "Chinese", pt: "Portuguese" });
  assert.deepEqual(["en", "ja", "zh", "pt", undefined, "xx"].map((c) => L.scriptsOf(c)), ["en", "ja", "zh", "en", "en", "xx"]);
  assert.deepEqual(["en", "ja", "zh", "pt"].map((c) => T.htmlLangOf(c)), ["en", "ja", "zh-Hans", "pt-BR"]);
  assert.deepEqual(["en", "ja", "zh", "pt"].map((c) => T.isOriginal(c)), [false, true, true, false]);
  assert.deepEqual(T.gatedOf(), [], "no language waits on its folder: the opening page asks for none");
});

test("a language on its way is listed and cannot be chosen: not by address, not by a device in it", () => {
  assert.ok(!L.LANGS.includes("es"));
  assert.equal(L.deviceLang({ languages: ["es-ES", "es"] }), "en");
  assert.equal(L.langOf("?lang=es", { getItem: () => null }, null, { languages: ["en"] }), "en");
  assert.equal(L.chooseLang("es", { setItem() { throw new Error("kept"); } }), false);
});

test("a new row reaches every list: plates, rows, PLAY's line, the apps' folders, names and note, its layers and scripts", () => {
  const xx = { code: "xx", plate: "XISH", name: "Xish", row: "A translation.", start: "The game starts in XISH.", layers: ["xx"], scripts: "en", html: "xx", device: true, download: true };
  const t = [...T.LANGUAGE_TABLE.slice(0, -1), xx, T.LANGUAGE_TABLE.at(-1)];
  assert.deepEqual(T.codesOf(t), ["en", "ja", "zh", "pt", "xx"]);
  assert.deepEqual(T.platesOf(t).at(-1), { lang: "xx", plate: "XISH" });
  assert.deepEqual(T.rowsOf(t).map((r) => r[0]), ["ENGLISH", "日本語", "中文", "PORTUGUÊS", "XISH", "ESPAÑOL"]);
  assert.equal(T.startLinesOf(t).xx, "The game starts in XISH.");
  assert.deepEqual(T.langDirsOf(t).xx, ["xx"]);
  assert.deepEqual(T.foldersOf(t), ["ja", "zh", "pt", "xx"]);
  assert.deepEqual(T.packedOf(t), ["ja", "zh"], "a text-only language has no packs");
  assert.equal(T.namesOf(t).xx, "Xish");
  assert.equal(T.downloadNoteOf(t), "日本語, 中文, PORTUGUÊS and XISH are downloaded the first time they are chosen.");
  assert.deepEqual(T.layersOf("xx", false, t), ["xx"]);
  assert.equal(T.scriptsOf("xx", t), "en");
  assert.deepEqual(T.deviceCodes(t), ["en", "ja", "zh", "pt", "xx"]);
  assert.equal(H.langLineFor("android", t).note.split("\n")[0], "日本語, 中文, PORTUGUÊS and XISH are downloaded the first time they are chosen.");
  // gated: shown only where its folder is
  assert.deepEqual(T.gatedOf([...t, { ...xx, code: "yy", gated: true }]).map((r) => r.code), ["yy"]);
  assert.ok(!T.deviceCodes([...t, { ...xx, code: "yy", gated: true }]).includes("yy"), "no device starts in a language not yet released");
});

test("app_manifest.py reads the same table, and stops when it cannot", () => {
  assert.deepEqual(python("print(json.dumps(a.LANGUAGES))"), T.LANGUAGE_TABLE);
  assert.deepEqual(python("print(json.dumps([a.LANG_DIRS, a.PACKED]))"), [T.foldersOf(), T.packedOf()]);
  const dir = mkdtempSync(join(tmpdir(), "langs-"));
  try {
    const bad = join(dir, "languages.js");
    writeFileSync(bad, "export const LANGUAGE_TABLE = [];\n");
    assert.throws(() => execFileSync("python3", ["-I", "-c", `import sys; sys.path.insert(0, 'web-dev/tools'); import app_manifest as a; a.language_table(${JSON.stringify(bad)})`],
      { cwd: ROOT, encoding: "utf8", stdio: "pipe" }), /no language table/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
