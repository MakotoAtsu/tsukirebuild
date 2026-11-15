// update.js - the Android and the desktop app bring themselves up to date from the site (the opening page, home.js, asks and shows it).
//
// An app carries everything it plays (about 2.9 GB), so a fix must not mean that download again. The site publishes what it serves now, in
// update/app.json (web-dev/tools/app_manifest.py, written by each deployment): every file of the page with its size and SHA-256, and the list of the
// game's files with their MD5 (the apps' part of web-dev/assets-manifest.txt), under the list's own MD5. The app carries the same description of
// what it was built with (bundled.json, bundled-assets.txt). Whatever the site has that the app was not built with, a changed script, a corrected
// picture, is the update: those files alone are downloaded, into the app's own storage, each checked against its hash, and once they are all there
// the app switches to them in one step and loads the page again. From then on it answers a request from that set first and from what it was built
// with otherwise. Nothing is half done: until the switch the app is as it was, and a download that stopped goes on from where it was the next time.
//
// What is decided here and what the app does (apphost.js has the commands): this file reads the two descriptions and says which files are wanted;
// the app fetches (from the site's address only, which it knows itself), checks, keeps and switches. Should an update not come up twice running,
// the app goes back to what it had and names the update in `rejected`: it is not offered again by itself.
//
// Languages. The apps are built in English. Japanese and Chinese have folders of their own under the game's files (ja/, zh/: lang.js), which an
// app downloads when the player first chooses the language on PLAY (home.js asks first, with the size): the site lists each folder apart
// (update/app.json "langs"), and Chinese, laid over Japanese, needs both (LANG_DIRS). They come as an update does, into the update the app runs,
// and stay: every later update keeps them, brought up to date with the rest. The app is told nothing of languages: a folder is held when the
// update in use has its index.json (heldDirs).
export const SITE = "arcueid.date";
export const MANIFEST = "update/app.json";
export const FORMAT = 1;
// Where the app is downloaded, for an update that needs a newer app than this one.
export const DOWNLOAD_PAGE = `https://${SITE}/#download`;
// A path the app may keep a file under: plain names, no hidden ones, nothing that climbs out.
export const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
const HEX = { md5: /^[0-9a-f]{32}$/, sha256: /^[0-9a-f]{64}$/, version: /^[0-9a-f]{12}$/ };
// Kept by the page between visits (savefile.js LOCAL): the site's state last compared with this app's and found to need nothing, so that the
// lists are not fetched and compared again at every start.
export const SEEN = "tsuki.update.seen";
// (kept for one reload: what the opening page says once the update is in)
export const UPDATED = "tsuki.update.done";

// A description as update/app.json and bundled.json give it, checked. Throws on anything else.
export function readManifest(m) {
  const bad = (what) => Error(`not an update description: ${what}`);
  if (!m || typeof m !== "object" || m.format !== FORMAT) throw bad("format");
  if (!Number.isFinite(m.time) || !Number.isInteger(m.shell) || !HEX.version.test(m.version || "")) throw bad("time, shell or version");
  if (!Array.isArray(m.app) || !m.app.length) throw bad("app");
  for (const e of m.app) {
    if (!Array.isArray(e) || !SAFE_PATH.test(e[0]) || !Number.isInteger(e[1]) || e[1] < 0 || !HEX.sha256.test(e[2])) throw bad(`app file ${e?.[0]}`);
    if (e[0].startsWith("assets/") || e[0].startsWith("update/")) throw bad(`app file ${e[0]}`);
  }
  if (!m.assets || !HEX.md5.test(m.assets.md5 || "") || !Number.isInteger(m.assets.size)) throw bad("assets");
  if (m.assets.path !== undefined && !SAFE_PATH.test(m.assets.path)) throw bad("assets path");
  if (m.langs !== undefined) {
    if (!m.langs || typeof m.langs !== "object") throw bad("langs");
    for (const d of FOLDERS) {
      const l = m.langs[d];
      if (l !== undefined && (!HEX.md5.test(l?.md5 || "") || !Number.isInteger(l.size) || !SAFE_PATH.test(l.path || ""))) throw bad(`langs ${d}`);
    }
  }
  return m;
}

// The language folders each language needs, lowest first (lang.js LAYERS); English is the app's own.
export const LANG_DIRS = { ja: ["ja"], zh: ["ja", "zh"] };
const FOLDERS = ["ja", "zh"];
const inFolder = (p) => FOLDERS.some((d) => p.startsWith(`assets/${d}/`));
// The folders the update in use (info().update.current) holds, and whether it holds all that a language needs.
export const heldDirs = (cur) => FOLDERS.filter((d) => !!cur?.files?.[`assets/${d}/index.json`]);
export const hasLang = (cur, lang) => (LANG_DIRS[lang] || []).every((d) => heldDirs(cur).includes(d));

// The list of the game's files, "md5 size path" a line: path -> [size, md5].
export function parseList(text) {
  const out = new Map();
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const a = line.indexOf(" "), b = line.indexOf(" ", a + 1);
    const md5 = line.slice(0, a), size = Number(line.slice(a + 1, b)), path = line.slice(b + 1);
    if (!HEX.md5.test(md5) || !Number.isInteger(size) || !SAFE_PATH.test(path)) throw Error(`not a list of the game's files: ${line.slice(0, 80)}`);
    out.set(path, [size, md5]);
  }
  return out;
}

// A file's address on the site, with its hash's start as a query: an address of its own for each content, so that no cache between the site and
// the app can answer with an older file of the same name.
const stamped = (path, hash) => `${path}?h=${hash.slice(0, 12)}`;

// The page's files the site has that the app was not built with: [{ path, size, hash, from }], `from` the address under the site.
export function appFiles(bundled, remote) {
  const mine = new Map(bundled.app.map(([p, size, hash]) => [p, hash]));
  return remote.app.filter(([p, , hash]) => mine.get(p) !== hash)
    .map(([p, size, hash]) => ({ path: p, size, hash, from: stamped(`v/${remote.version}/${p}`, hash) }));
}
// ... and the game's files, from the two lists (parseList).
export function assetFiles(mine, theirs) {
  const out = [];
  for (const [p, [size, md5]] of theirs) if (mine.get(p)?.[1] !== md5) out.push({ path: `assets/${p}`, size, hash: md5, from: stamped(`assets/${p}`, md5) });
  return out;
}

// What the update is called: the app keeps its files under this name (desktop updater.js and Updates.java take <12 hex>-<8 hex>). Without
// languages, the version and the start of its list's MD5; with them, eight hex of a hash of those MD5s and the languages' (FNV-1a), so that a
// change to any list is another update.
const fnv = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16).padStart(8, "0"); };
export const idOf = (version, assets, langs = []) => `${version}-${langs.length ? fnv([assets, ...langs].join("|")) : assets.slice(0, 8)}`;
export const updateId = (remote, dirs = []) => idOf(remote.version, remote.assets.md5, dirs.map((d) => `${d}:${remote.langs[d].md5}`));

// Is there an update, and what is it? One of:
//   { state: "offline" }             the site could not be asked (no connection, or it has no description)
//   { state: "shell" }               there is one, for a newer app than this: the app itself has to be downloaded again
//   { state: "current" }             nothing newer than what the app has
//   { state: "rejected", id }        the newest one was tried here and did not come up; `force` offers it again
//   { state: "update", id, files, bytes, count, meta, newer }
//                                    files: all that the update keeps over what the app was built with; bytes and count: what of those has
//                                    still to be downloaded; meta: what the app records of it (apphost.js `apply`); newer: whether what is to
//                                    be downloaded is more than languages' files (a newer version's)
// each with { version, time }: the version in use now, where that could be read.
// host: apphost.js connect(). local(path): a text file of the app's own (bundled.json, bundled-assets.txt). storage: for SEEN.
// lang: a language to add (langPlan). The update is then that language's folders the app does not hold, over what it runs now, or with the
// newer version where the site has one: the language's files are the site's, and go with the site's newest page.
export async function checkUpdate(host, { local = localText, storage = globalThis.localStorage, force = false, lang = null } = {}) {
  let info, bundled, remote;
  try {
    info = await host.call("info");
    bundled = readManifest(JSON.parse(await local("/bundled.json")));
  } catch { return { state: "offline" }; }   // (an app built without its description: it cannot tell what it has)
  const cur = info.update?.current || null;
  const now = { version: cur?.version || bundled.version, time: cur?.time || bundled.time };
  try {
    const m = JSON.parse(await host.call("fetchText", { path: MANIFEST }));
    if (Number.isInteger(m?.format) && m.format > FORMAT) return { state: "shell", ...now };   // written for an app that reads a newer description
    remote = readManifest(m);
  } catch { return { state: "offline", ...now }; }
  if (remote.shell > (Number(info.shell) || 0)) return { state: "shell", ...now };
  const held = heldDirs(cur), dirs = FOLDERS.filter((d) => held.includes(d) || (LANG_DIRS[lang] || []).includes(d)), adding = dirs.length > held.length;
  // Only what was published after this app's own files is an update: an app built from newer work than the site has is left alone.
  const newer = remote.time > now.time;
  if (!newer && !adding) return { state: "current", ...now };
  if (dirs.some((d) => !remote.langs?.[d])) return { state: "offline", ...now };   // (a site that does not list the languages)
  const version = newer ? remote.version : now.version, assets = newer ? remote.assets.md5 : cur?.assets || bundled.assets.md5;
  const id = idOf(version, assets, dirs.map((d) => `${d}:${remote.langs[d].md5}`)), seen = `${cur?.id || `built-${bundled.version}-${bundled.assets.md5.slice(0, 8)}`}|${id}`;
  try { if (!force && !adding && storage?.getItem(SEEN) === seen) return { state: "current", ...now }; } catch { /* compared again */ }

  let files = [];
  try {
    if (!newer) {
      // a language over the version in use: everything that version has stays as it is (the page's files are taken from the update, not the site)
      for (const [p, [size, hash]] of Object.entries(cur?.files || {})) if (!inFolder(p)) files.push({ path: p, size, hash, from: stamped(p.startsWith("assets/") ? p : `v/${version}/${p}`, hash) });
    } else {
      files = appFiles(bundled, remote);
      if (remote.assets.md5 === bundled.assets.md5) { /* the game's files are the ones the app was built with */ }
      else if (cur && cur.assets === remote.assets.md5) {
        // ... or the ones the update it has was made for: those stay
        for (const [p, [size, hash]] of Object.entries(cur.files)) if (p.startsWith("assets/") && !inFolder(p)) files.push({ path: p, size, hash, from: stamped(p, hash) });
      } else {
        if (!remote.assets.path) throw Error("no list of the game's files");
        const [mine, theirs] = await Promise.all([local("/bundled-assets.txt"), host.call("fetchText", { path: stamped(remote.assets.path, remote.assets.md5), hash: remote.assets.md5 })]);
        files.push(...assetFiles(parseList(mine), parseList(theirs)));
      }
    }
    // the languages' folders, each as the site lists it now (files the update in use holds are kept, not downloaded again)
    for (const d of dirs) {
      const l = remote.langs[d];
      for (const [p, [size, md5]] of parseList(await host.call("fetchText", { path: stamped(l.path, l.md5), hash: l.md5 }))) {
        if (p.startsWith(`${d}/`)) files.push({ path: `assets/${p}`, size, hash: md5, from: stamped(`assets/${p}`, md5) });
      }
    }
  } catch { return { state: "offline", ...now }; }
  const have = cur?.files || {};
  const same = files.length === Object.keys(have).length && files.every((f) => have[f.path]?.[1] === f.hash);
  if (same) {
    try { storage?.setItem(SEEN, seen); } catch { /* compared again next time */ }
    return { state: "current", ...now };
  }
  if (!force && (info.update?.rejected || []).includes(id)) return { state: "rejected", id, ...now };
  const wanted = files.filter((f) => have[f.path]?.[1] !== f.hash);
  return {
    state: "update", id, files, bytes: wanted.reduce((n, f) => n + f.size, 0), count: wanted.length, newer: wanted.some((f) => !inFolder(f.path)), ...now,
    meta: { id, time: newer ? remote.time : now.time, version, assets, files: Object.fromEntries(files.map((f) => [f.path, [f.size, f.hash]])) },
  };
}
// The update that adds `lang` (ja, zh): asked for whatever was seen or given up before, as the player's choice.
export const langPlan = (host, lang, opts = {}) => checkUpdate(host, { ...opts, lang, force: true });

async function localText(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw Error(`${path}: ${r.status}`);
  return r.text();
}

// Downloads the update's files and switches to them. onProgress({ done, total }): bytes so far. When it comes back the app serves the new
// files, and the page has to load itself again; when it throws, the app is as it was.
export async function runUpdate(host, plan, onProgress = null) {
  await host.call("stage", { id: plan.id, files: plan.files }, onProgress);
  await host.call("apply", { id: plan.id, meta: plan.meta });
}

// A size as the page says it: 340 KB, 1.2 MB, 48 MB, 1.3 GB (decimal units, as phones and the site's downloads show them).
export function sizeText(bytes) {
  if (bytes < 1e6) return `${bytes > 0 ? Math.max(1, Math.round(bytes / 1e3)) : 0} KB`;
  if (bytes < 1e7) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes < 1e9) return `${Math.round(bytes / 1e6)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}
// The version as the page names it: the day its files were published and their name on the site.
export const versionText = ({ version, time }) => `${new Date(time * 1000).toISOString().slice(0, 10)} (${version})`;

// The page's words (home.js shows them on PLAY's page and in the game's Yes / No window).
export const UPDATE_TEXT = {
  head: "Updates",
  what: "Fixes come from arcueid.date: only the files that changed are downloaded, after asking, and your saves stay as they are. Without a connection the game plays as it is.",
  version: (v) => `This version: ${versionText(v)}`,
  checking: "Looking for an update...",
  current: "Up to date.",
  offline: "Could not look for an update just now. The game plays as it is.",
  found: (bytes) => `An update is available (${sizeText(bytes)}).`,
  ask: (bytes) => `An update is available (${sizeText(bytes)}).\nDownload it now?`,
  shell: "The latest update needs a newer version of this app, from arcueid.date.",
  askShell: "The latest update needs a newer version of this app.\nOpen the download page?",
  rejected: "The latest update did not start here and was taken out again. Check again to give it another try.",
  loading: (done, total) => `Downloading the update  ${total ? Math.floor((done / total) * 100) : 0}%\nPress to stop`,
  failed: "The update could not be downloaded. Nothing was changed.",
  stopped: "The update was stopped. Nothing was changed.",
  done: "Updated.",
  // a language's files (langPlan), downloaded when its plate is first chosen; `name` the language in English (LANG_NAMES)
  // (the question window holds about 36 letters a line: a longer one wraps into the No / Yes below it)
  askLang: (name, bytes, newer) => (newer ? `${name} needs a download (${sizeText(bytes)}),\nwith the latest update.\nDownload it now?` : `${name} needs a download (${sizeText(bytes)}).\nDownload it now?`),
  langLoading: (name, done, total) => `Downloading ${name}  ${total ? Math.floor((done / total) * 100) : 0}%\nPress to stop`,
  langOffline: (name) => `${name} needs a download.\nNo connection to arcueid.date.`,
  langFailed: (name) => `${name} could not be downloaded. Nothing was changed.`,
  langStopped: (name) => `${name} was stopped. Nothing was changed.`,
};
export const LANG_NAMES = { en: "English", ja: "Japanese", zh: "Chinese" };
