// The apps' packs of a language folder's small files (web-dev/tools/build_langpacks.py; app/js/lang.js loadPacks, fetchOwn; app_manifest.py lang_lists):
// the apps download one file at a time, so a language's hundreds of small files come to them in a few packs, and the page reads files out of those.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const store = () => ({ s: {}, getItem(k) { return this.s[k] ?? null; }, setItem(k, v) { this.s[k] = String(v); } });
globalThis.localStorage = store();
const { loadPacks, fetchOwn, asset, overlays, setOwn } = await import("../../web/app/js/lang.js");
const at = (rel) => new URL(`../../${rel}`, import.meta.url);
const read = (rel) => readFileSync(at(rel), "utf8");
const python = (() => { try { execFileSync("python3", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

// A folder "xx" with two packs, served by a fetch of our own: what loadPacks asks for, and how often.
function site() {
  const files = { "img/A.avif": "AAAA", "img/B.avif": "BB", "system.json": '{"k":1}', "scripts/3.json": '{"name":"three"}' };
  const p1 = files["img/A.avif"] + files["img/B.avif"], p2 = files["system.json"] + files["scripts/3.json"];
  const served = {
    "/assets/xx/pack/index.json": JSON.stringify({ version: 1, packs: [["xx-1.pack", ["img/A.avif", 4, "img/B.avif", 2]], ["xx-2.pack", ["system.json", 7, "scripts/3.json", 16]]] }),
    "/assets/xx/pack/xx-1.pack": p1, "/assets/xx/pack/xx-2.pack": p2,
    "/assets/yy/movie/m.mp4": "MOVIE",
  };
  const asked = [];
  const get = async (url) => {
    asked.push(url);
    if (url.startsWith("blob:")) return fetch(url);
    return url in served ? new Response(served[url]) : new Response("", { status: 404 });
  };
  return { get, asked };
}

test("in the apps a language's packs give each file an address of its slice, and asset() hands that out", async () => {
  const { get, asked } = site();
  assert.equal(await loadPacks("xx", get), 4);
  assert.deepEqual(asked, ["/assets/xx/pack/index.json", "/assets/xx/pack/xx-1.pack", "/assets/xx/pack/xx-2.pack"], "the index, then each pack once");
  setOwn(["img/A.avif", "img/B.avif", "system.json", "scripts/3.json", "movie/m.mp4"], "xx");
  const a = asset("/assets/img/A.avif"), b = asset("/assets/img/B.avif");
  assert.match(a, /^blob:/);
  assert.equal(await (await fetch(a)).text(), "AAAA");
  assert.equal(await (await fetch(b)).text(), "BB");
  assert.equal((await fetch(a)).headers.get("content-type"), "image/avif");
  assert.equal(await (await fetch(overlays("system.json")[0])).text(), '{"k":1}', "a table laid over the shared one, from its pack");
  assert.equal(asset("/assets/movie/m.mp4"), "/assets/xx/movie/m.mp4", "a file in no pack is asked for itself");
  assert.equal(asset("/assets/img/Z.avif"), "/assets/img/Z.avif", "and one the language has not, where it always was");
  setOwn([]);
});

test("another language's file is read out of its pack when asked (a save made in it), and only in the apps", async () => {
  const { get, asked } = site();
  assert.deepEqual(await (await fetchOwn("/assets/xx/scripts/3.json", get, "desktop")).json(), { name: "three" });
  assert.equal((await fetchOwn("/assets/xx/scripts/9.json", get, "android")).status, 404, "a file no pack has: the file itself");
  const before = asked.length;
  assert.equal((await fetchOwn("/assets/xx/scripts/3.json", get, null)).status, 404, "the site: the file itself");
  assert.deepEqual(asked.slice(before), ["/assets/xx/scripts/3.json"]);
  const none = site();
  assert.equal(await loadPacks("zz", none.get), 0, "a folder without packs: nothing, and its files are asked for as before");
});

test("the page opens the language's packs only in the apps, before anything asks for its files", () => {
  const lang = read("web/app/js/lang.js");
  assert.match(lang, /lists\.forEach\(\(list, k\) => addOwn\(list\?\.files, LAYERS\[k\]\)\);\n  if \(APP\) await Promise\.all\(LAYERS\.map\(\(layer\) => loadPacks\(layer\)\)\);/);
  assert.match(read("web/app/js/vm.js"), /const get = \(url\) => fetchOwn\(url\)\.then/, "a save made in Japanese, read in another language");
});

test("the apps' list of a language with packs names its packs and its loose files, not the files the packs carry", { skip: !python }, () => {
  const out = execFileSync("python3", ["-I", "-c", `import sys, json
sys.path.insert(0, "web-dev/tools")
import app_manifest as m
lines = [("a" * 32, 10, "ja/index.json"), ("b" * 32, 5, "ja/img/X.avif"), ("c" * 32, 6, "ja/text.json"), ("d" * 32, 99, "ja/movie/m.mp4"),
         ("e" * 32, 7, "ja/fonts/F.ttf"), ("f" * 32, 11, "ja/pack/ja-0123456789.pack"), ("0" * 32, 3, "ja/pack/index.json"),
         ("1" * 32, 5, "zh/index.json"), ("2" * 32, 4, "zh/text.json")]
print(json.dumps({k: v.decode() for k, v in m.lang_lists(lines).items()}))`], { cwd: at(".").pathname, encoding: "utf8" });
  const lists = JSON.parse(out);
  const paths = (k) => lists[k].trim().split("\n").map((l) => l.split(" ").slice(2).join(" "));
  assert.deepEqual(paths("ja"), ["ja/fonts/F.ttf", "ja/index.json", "ja/movie/m.mp4", "ja/pack/index.json", "ja/pack/ja-0123456789.pack"]);
  assert.deepEqual(paths("zh"), ["zh/index.json", "zh/text.json"], "a folder without packs: every file, as before");
});

test("the packs on disk hold exactly the files their folder's list says go in packs", { skip: !python || !existsSync(at("web/assets/ja/pack/index.json")) }, () => {
  const out = execFileSync("python3", ["-I", "web-dev/tools/build_langpacks.py", "--check"], { cwd: at(".").pathname, encoding: "utf8" });
  assert.match(out, /^packs match their folders/);
  const manifest = read("web-dev/assets-manifest.txt").split("\n").filter(Boolean).map((l) => l.split(" ").slice(2).join(" "));
  for (const lang of ["ja", "zh"]) {
    const ix = JSON.parse(read(`web/assets/${lang}/pack/index.json`));
    for (const [name] of ix.packs) assert.ok(manifest.includes(`${lang}/pack/${name}`), `${lang}/pack/${name} on the site`);
    assert.ok(manifest.includes(`${lang}/pack/index.json`));
  }
});
