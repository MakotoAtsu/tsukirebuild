// lang.js - the language the game is played in: English (the translation, what the port's files are made from), Japanese (the original game) or Chinese
// (a fan translation of the original game: 月姬REMAKE汉化补丁 v2.13, by Letdo1945).
//
// Japanese is not a second copy of the game. web/assets/ja holds only what the original has that the translation changed (web-dev/tools/build_ja.py): the
// dialogue lines, the scripts the translation rewrote, the system's words, and the interface art, pictures and movies that carry text. ja/index.json lists
// those files, and asset() gives the Japanese file's address where there is one and the shared file's everywhere else.
//
// Chinese is laid over Japanese. Its patch changes files of the original and none of its code, so the game runs it as it runs Japanese: the engine sets
// and wraps the text the same way, the scripts are the original's, and the pictures it did not redraw are the original's. web/assets/zh holds only what
// the patch shows that Japanese does not (web-dev/tools/build_zh.py: the lines, with the rows the original engine gives them, the system's words, the art
// it redrew, two chapter titles, its faces, the prologue's subtitles); a file is asked for there first, then under ja/, then where it always was. ORIG
// names what the two share, the original game's way of setting its text; JA and ZH what is each one's own (words, faces).
//
// The language is chosen on the opening page (home.js, PLAY ONLINE) and kept in this browser. It is read once, as the page loads: every table is fetched in
// that language from the start, so changing it loads the page again. `?lang=ja` (or en) in the address chooses it for that visit.
// The Android and desktop apps are built in English, without web/assets/ja and zh: a language's folders are downloaded into the app when its plate is
// first chosen there (home.js, update.js langPlan), and the choice is kept only once they are in. Should they be gone after all (an update the app
// took out again), the app goes back to English (langReady).
import { APP } from "./apphost.js";

export const LANGS = ["en", "ja", "zh"];
const KEY = "tsuki.lang";

export function storedLang(storage = globalThis.localStorage) {
  try { const v = storage?.getItem(KEY); return LANGS.includes(v) ? v : "en"; } catch { return "en"; }
}
export function langOf(search = "", storage = globalThis.localStorage, app = APP) {
  if (app) return storedLang(storage);   // (in the apps only what was chosen once its files were in)
  const asked = new URLSearchParams(search).get("lang");
  return LANGS.includes(asked) ? asked : storedLang(storage);
}
export const LANG = langOf(globalThis.location?.search || "");
export const JA = LANG === "ja";
export const ZH = LANG === "zh";
export const ORIG = JA || ZH;
// The folders laid over the shared files, lowest first.
export const LAYERS = ZH ? ["ja", "zh"] : JA ? ["ja"] : [];

// Keeps the choice for the next load. Returns whether it is another language than the one this page was loaded in.
export function chooseLang(lang, storage = globalThis.localStorage) {
  if (!LANGS.includes(lang)) return false;
  try { storage?.setItem(KEY, lang); } catch { /* kept for this visit only */ }
  return lang !== LANG;
}

// What each folder has of its own: path -> the folders that have it, lowest first (paths under /assets/ja/, /assets/zh/).
let own = new Map();
export function setOwn(files, layer = "ja") { own = new Map(); addOwn(files, layer); }
export function addOwn(files, layer) { for (const f of files || []) { const at = own.get(f); if (at) at.push(layer); else own.set(f, [layer]); } }
export const has = (rel) => own.has(rel);
// The addresses of a table each folder lays over the shared one, lowest first (system.json, images.json: vm.js init).
export const overlays = (rel) => (own.get(rel) || []).map((layer) => `/assets/${layer}/${rel}`);
// A file corrected after the site first served it. The game's own files are stored to be kept for 30 days and never
// asked about again (`immutable`), which is right for files that never change but leaves a corrected one unseen until
// a browser's copy expires. Giving it the next number here asks for it at `...?v=<n>` instead, an address no browser
// has, so everyone has it at once; the stored file keeps its name. Japanese's own copy of the same path is marked too.
// Only the paths that pass through `asset` are covered: pictures, interface art and movies, not sounds, whose fetches
// would have to be wrapped here first.
const REVISED = {
  "img/IMG0316.avif": 2,   // the tree's cut-out, so the Ciel Day 9 scene has no bright rectangles (GitHub issue 7)
};

// A script as the language has it. Chinese's scripts are Japanese's, but for the rows of the messages laid out together with others (the engine's own,
// which hold the lines' text): zh/rows.json has those by script number, where they are not Japanese's (null: the script has none). vm.js getScript.
let rowsTable = null;
export async function ownRows(script, i) {
  if (!own.has("rows.json")) return script;
  rowsTable ||= fetch(asset("/assets/rows.json")).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const table = await rowsTable;
  if (!(String(i) in table)) return script;
  const out = { ...script };
  if (table[i]) out.rows = table[i]; else delete out.rows;
  return out;
}

// The address to ask for: a file under /assets/ is the one of the same path in the highest folder that has it (/assets/zh/, /assets/ja/).
export function asset(url) {
  if (!url.startsWith("/assets/")) return url;
  const rel = url.slice(8);
  const at = own.size ? own.get(rel) : null;
  const out = at ? `/assets/${at[at.length - 1]}/${rel}` : url;
  const rev = REVISED[rel];
  return rev ? `${out}${out.includes("?") ? "&" : "?"}v=${rev}` : out;
}

// Resolved once the lists are in (at once in English). A list that does not come leaves the game in the files below it.
export const langReady = (async () => {
  if (!ORIG || typeof fetch !== "function") return;
  const lists = await Promise.all(LAYERS.map((layer) => fetch(`/assets/${layer}/index.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  if (APP && lists.some((list) => !list) && typeof location !== "undefined") {
    // an app without the language's files: back to English, before anything is drawn
    chooseLang("en");
    location.reload();
    await new Promise(() => {});
  }
  lists.forEach((list, k) => addOwn(list?.files, LAYERS[k]));
  if (typeof document !== "undefined") {
    // html.ja: the original's way of setting text (style.css), in both; html.zh: Chinese's faces over it
    document.documentElement.lang = ZH ? "zh-Hans" : "ja";
    document.documentElement.classList.add("ja");
    if (ZH) document.documentElement.classList.add("zh");
    localizeStyles();
  }
})();

// The style sheets name interface art by its shared address (the text window, the wait marks, the save rows ...). Each such picture the language has of its
// own is named again here, rule by rule.
const ART = /url\((["']?)(?:https?:\/\/[^\/"')]+)?(\/assets\/[^"')]+)\1\)/g;   // (a browser may give the address back whole)
export function localizeStyles(doc = document) {
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.style) { walk(rule.cssRules); continue; }
      if (!rule.style) continue;
      for (const prop of ["background-image", "border-image-source"]) {
        const v = rule.style.getPropertyValue(prop);
        if (!v || !v.includes("/assets/")) continue;
        const next = v.replace(ART, (m, q, url) => `url("${asset(url)}")`);
        if (next !== v) rule.style.setProperty(prop, next, rule.style.getPropertyPriority(prop));
      }
      if (rule.cssRules) walk(rule.cssRules);
    }
  };
  for (const sheet of doc.styleSheets) {
    try { walk(sheet.cssRules); } catch { /* a sheet from elsewhere */ }
  }
}
