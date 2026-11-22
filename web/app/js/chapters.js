// chapters.js - the chapters' days and names, as text. The game shows them as pictures (the system menu's header,
// MENU_PARTS_JA/system_phasetitle_ja, and the flowchart's day titles, flow_phasetitle), and the translation had to fit
// each English name into the Japanese picture's cell, on two lines where it was long. The port writes them out instead,
// on one line; these lists give what each cell of the two sheets says, read off the patched pictures.
import { LANG } from "./lang.js";

// A chapter's day (null: none shown) by its name; "Epilogue." is struck through in both sheets.
const DAY = {
  "Prologue": null, "Glass Moon": 0, "Morning of Homecoming I": 1, "Day that Wasn't": 2, "Inversion Impulse": 3, "Infernal River of Blood I": 4,
  "Infernal River of Blood II": 5, "Distant Sea of Frost": 5, "Vermillion Vestiges I": 6, "Cerulean Stigma": 6, "Eyes of Death Perception I": 7,
  "Reverse Hatching I": 7, "Eyes of Death Perception II": 8, "Reverse Hatching II": 8, "L'Arc-en-Ciel I": 9, "Death.": 9, "L'Arc-en-Ciel II": 10,
  "Scarlet Moon of Crimson I": 10, "Blacked Out Moon": 10, "Epilogue.": 11, "Scarlet Moon of Crimson II": 11, "Night of Ill-Omen": 12,
  "Vermillion Vestiges II": 12, "The Moon's Surface": 13, "Mirage": 13, "Stone of Eternity": 14, "Moon Princess": 14, "Rainbow in the Night": 15,
  "Daylight Blue": 15,
};
const STRUCK = new Set(["Epilogue."]);
// Russian (Living FLCL's translation): the chapters' names as its own two sheets show them. Russian draws the sheets' cells, as the original does
// (ui.js), so these are what the pictures say, for the flowchart's written lines and for readers of the page.
const RUSSIAN = {
  "Prologue": "Пролог",
  "Glass Moon": "Хрустальная Луна",
  "Morning of Homecoming I": "Возвращение Домой I",
  "Day that Wasn't": "Обычный День",
  "Inversion Impulse": "Обращающий Импульс",
  "Infernal River of Blood I": "Река Огня и Крови I",
  "Infernal River of Blood II": "Река Огня и Крови II",
  "Distant Sea of Frost": "Далекое Холодное Море",
  "Vermillion Vestiges I": "Багровые Отголоски I",
  "Cerulean Stigma": "Лазурная Метка",
  "Eyes of Death Perception I": "Взгляд Восприятия Смерти I",
  "Reverse Hatching I": "Преображение I",
  "Eyes of Death Perception II": "Взгляд Восприятия Смерти II",
  "Reverse Hatching II": "Преображение II",
  "L'Arc-en-Ciel I": "Небесный Лук I",
  "Death.": "Смерть",
  "L'Arc-en-Ciel II": "Небесный Лук II",
  "Scarlet Moon of Crimson I": "Багряная Луна I",
  "Blacked Out Moon": "Бледная Луна",
  "Epilogue.": "Эпилог",
  "Scarlet Moon of Crimson II": "Багряная Луна II",
  "Night of Ill-Omen": "Дурное Знамение",
  "Vermillion Vestiges II": "Багровые Отголоски II",
  "The Moon's Surface": "Лунный Мир",
  "Mirage": "Мираж",
  "Stone of Eternity": "Незыблемый Камень",
  "Moon Princess": "Лунная Принцесса",
  "Rainbow in the Night": "Ночная Радуга",
  "Daylight Blue": "Дневная Лазурь",
};
// system_phasetitle_ja: three columns of cells 568 x 80 from (24, 24), 584 across and 96 down apart.
const MENU_SHEET = [
  ["Glass Moon", "Morning of Homecoming I", "Day that Wasn't", "Inversion Impulse", "Infernal River of Blood I", "Distant Sea of Frost", "Vermillion Vestiges I",
    "Cerulean Stigma", "Eyes of Death Perception I", "Reverse Hatching I"],
  ["Eyes of Death Perception II", "Reverse Hatching II", "L'Arc-en-Ciel I", "Death.", "L'Arc-en-Ciel II", "Scarlet Moon of Crimson I", "Blacked Out Moon", "Epilogue.",
    "Scarlet Moon of Crimson II", "Night of Ill-Omen"],
  ["Vermillion Vestiges II", "The Moon's Surface", "Mirage", "Stone of Eternity", "Moon Princess", "Daylight Blue", "Rainbow in the Night", "Prologue",
    "Infernal River of Blood II"],
];
// flow_phasetitle: three columns of cells 200 x 32 from (8, 8), 208 across and 40 down apart.
const FLOW_SHEET = [
  ["Prologue", "Glass Moon", "Morning of Homecoming I", "Day that Wasn't", "Inversion Impulse", "Infernal River of Blood I", "Infernal River of Blood II",
    "Distant Sea of Frost", "Vermillion Vestiges I", "Cerulean Stigma"],
  ["Eyes of Death Perception I", "Reverse Hatching I", "Eyes of Death Perception II", "Reverse Hatching II", "L'Arc-en-Ciel I", "Death.", "L'Arc-en-Ciel II",
    "Scarlet Moon of Crimson I", "Blacked Out Moon", "Epilogue."],
  ["Scarlet Moon of Crimson II", "Night of Ill-Omen", "Vermillion Vestiges II", "The Moon's Surface", "Mirage", "Stone of Eternity", "Moon Princess",
    "Rainbow in the Night", "Daylight Blue"],
];
const chapter = (name) => (name === undefined ? null : { day: DAY[name] ?? null, name, struck: STRUCK.has(name) });

// The chapter a cell of the system menu's sheet shows; cell: [x0, y0, x1, y1] (system.json saves.phaseCells). Null for
// the table's empty entries.
export function menuChapter(cell) {
  if (!cell || cell[2] - cell[0] <= 1) return null;
  return chapter(MENU_SHEET[Math.round((cell[0] - 24) / 584)]?.[Math.round((cell[1] - 24) / 96)]);
}
// The chapter a cell of the flowchart's sheet shows; rect: [x, y, w, h] (flowchart.json phaseRects).
export function flowChapter(rect) {
  if (!rect) return null;
  return chapter(FLOW_SHEET[Math.round((rect[0] - 8) / 208)]?.[Math.round((rect[1] - 8) / 40)]);
}
// The chapter as the language names it: in Russian its Russian name, and whether Russian's sheets have its picture (`art`).
export function localizedChapter(chapter, language = LANG) {
  if (!chapter || language !== "ru") return chapter;
  return { ...chapter, name: RUSSIAN[chapter.name] ?? chapter.name, art: Object.hasOwn(RUSSIAN, chapter.name) };
}
// A scene's name on the menu and the save rows ("3rd day ― morning"), in Russian "3-й день — Утро".
const TIMES = { morning: "Утро", "after school": "После уроков", midnight: "Полночь" };
export function sceneName(name, language = LANG) {
  if (language !== "ru" || !name) return name;
  const match = /^(\d+)(?:st|nd|rd|th) day(?:\s*[―—–-]\s*(.+))?$/i.exec(name.trim());
  if (!match) return name;
  const [, day, time] = match;
  const suffix = time && (TIMES[time.toLowerCase()] || time);
  return `${day}-й день${suffix ? ` — ${suffix}` : ""}`;
}
// A chapter by its name alone (where the tables are missing).
export const chapterNamed = (name) => (name in DAY ? chapter(name) : null);
// "12 / Night of Ill-Omen", as the flowchart writes it.
export const chapterLine = (c) => (c.day === null ? c.name : `${c.day} / ${c.name}`);
