// sitewords.js - the opening page's own words (home.js, welcome.js) in Japanese, Chinese, Portuguese and Russian. The page is written in English; as it is drawn, each string is
// looked up here by its English (tr) and shown in the language of the page (lang.js UILANG: the game's, or in an app where none has been chosen, the
// device's), or as it is where there is no entry. Words made of parts (a file name, a size, a list of plates) are matched by PATTERNS instead.
// Every string the page can show has an entry in both (web-dev/tests/sitewords.test.mjs walks them all), so a change to the English shows there.
// The Chinese faces keep only the letters Chinese uses, and this file is read for them (build_zh.py used_letters).
import { UILANG } from "./lang.js";
import { SITE_JA, SITE_ZH, SITE_PT, PATTERNS_JA, PATTERNS_ZH, PATTERNS_PT } from "./sitewords-table.js";
import { SITE_RU, PATTERNS_RU } from "./sitewords-ru.js";   // (Russian's table is a file of its own: it has the game's screens' words too, words.js)

export const TABLES = { ja: SITE_JA, zh: SITE_ZH, pt: SITE_PT, ru: SITE_RU };
export const PATTERNS = { ja: PATTERNS_JA, zh: PATTERNS_ZH, pt: PATTERNS_PT, ru: PATTERNS_RU };

// The string in the page's language (or `lang`): the table's entry, else the first pattern that matches, else the English as it is.
export function tr(text, lang = UILANG) {
  if (typeof text !== "string" || lang === "en" || !text) return text;
  const table = TABLES[lang];
  if (!table) return text;
  if (Object.hasOwn(table, text)) return table[text];
  for (const [re, to] of PATTERNS[lang]) {
    const m = re.exec(text);
    if (m) return to(m, (s) => tr(s, lang));
  }
  return text;
}

// A block as welcome.js draws it (blockEl), its words looked up: a paragraph, ["h", text], ["note", text], ["rows", [[name, what, font?]]],
// ["facts", [[figure, what]]]. A row's name is looked up too (most are paths or commands, which have no entry and stay as they are).
export function trBlock(b, lang = UILANG) {
  if (lang === "en") return b;
  if (typeof b === "string") return b === "logo" ? b : tr(b, lang);
  if (!Array.isArray(b)) return b;
  if (b[0] === "h" || b[0] === "note") return [b[0], tr(b[1], lang)];
  if (b[0] === "rows") return ["rows", b[1].map(([name, what, font]) => (font ? [name, tr(what, lang), font] : [tr(name, lang), tr(what, lang)]))];
  if (b[0] === "facts") return ["facts", b[1].map(([n, what]) => [n, tr(what, lang)])];
  return b;
}

// A table of words (SAVE_TEXT, UPDATE_TEXT): each string looked up, each function's result looked up.
export function localize(words, lang = UILANG) {
  if (lang === "en") return words;
  const out = {};
  for (const [k, v] of Object.entries(words)) out[k] = typeof v === "function" ? (...a) => tr(v(...a), lang) : tr(v, lang);
  return out;
}
