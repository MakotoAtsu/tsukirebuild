# Translator tool: plan

Written 2026-11-17. Stage 0 was built the same day (see "Stage 0 as built"); nothing after it is. The plan is for a tool
that helps a team translate the game into a new language and get it into the port. It builds on what the port already has. It also draws on what adding
Portuguese turned up the same day (`web-dev/tools/build_pt.py`).

## What it is for

A translator should be able to:

- see each line next to the versions that already exist;
- write theirs;
- see it in the real text box and play it in the game;
- run checks that catch what goes wrong in practice;
- hand back a folder the port can serve as a language.

The tool runs locally. It is never deployed to the site or packed into the apps: deploy uploads only tracked `web/app`
files, and the apps pack only `web/app` and `web/assets`. It is built in `web-dev/`, and (decision 1 below) handed to
translators separately, to run on top of the app they downloaded.

## What it builds on (facts, checked 2026-11-17)

**Line numbers are the spine.**
- `web/assets/text.json` has 43,960 lines. Line *n* is the same moment in English (Tsukihimates), Aniplex, Japanese,
  Chinese and Portuguese.
- Scripts name lines as `$NNNNNN` in the arguments of `MSG`, `MSAD` and `SELR` (`langsave.js` `idsOf`). About 43,900
  lines are named. 22 are named twice, and 54 are never named.
- `langsave.js` `lineIndex` maps a line to a command, but only within one script. There is no map from any line to its
  script, command and page.

**Languages are layers.**
- `lang.js` `LAYERS`, `asset()` and `overlays()` do the layering.
- `text.json`, `gallery.json`, `flowchart.json` and scripts are replaced whole.
- `system.json` is merged shallowly, key by key (`vm.js` init), and `images.json` per picture.
- Fonts never go through `asset()`; they are named in `style.css`.

**Text-only languages already exist.** Aniplex (`aniplex/`) and Portuguese (`pt/`) are a full 43,960-line `text.json`
plus `index.json`. Everything else is English. This is the tool's output format.

**Markup a translator must keep** (parsed in `textbox.js` `parseMarkup`):
- italics as private-use letters (U+E000 + ASCII), other faces in U+E100 to U+E2FF;
- ruby `<base|reading>`;
- `@g` (italic face to the end of the line), `@t` and `@k`;
- `[ber00]` and `[zap00]`;
- `^` as a row break;
- `■` and dash runs counted as one letter.

The deepLuna control codes (`%{n}`, `%{i}`, ...) belong to the source format only. They must be applied before the
text reaches the port.

**Layout needs the DOM.**
- `textbox.js` `fillSegment` builds spans, and CSS wraps them: `#text` is 1,390 px wide, Georgia then Gelasio at 42 px,
  with 77.5 px rows from y = 146, so 12 rows reach 1,076 of 1,080.
- No pure layout function exists, and no page-fit check was ever saved. The tool has to build both.
- `reflow.js` removes the English patch's 55-cell breaks. A line with no `\n` is wrapped by the browser (the Aniplex
  path), so the tool should store translations without breaks.
- Ciel-sensei's corners keep their own rows (`^` or `\n`), and their balloon text wraps at the box width.

**Other facts.**
- Pages: `WNTY 1`, then a click, then `WKST F823 eq 0` ends a page. A linear scan finds about 15,700 pages. Branches
  inside pages make this an approximation.
- Voices: every `VPLY` is followed by its message, with no label between, so line to voice is static (16,680 voiced
  lines). There is no speaker name anywhere; the voice file's prefix is the only signal.
- Choices are lines in `text.json`, drawn on one row (`white-space: pre`).
- `?script=S&pc=P` fast-forwards from the script's start (`main.js` `vm.skip`). That is how "play from here" works once
  a line → script and command map exists.
- `web-dev/tools/dev_server.py` wraps `web/server.py` and adds exact-path routes (`EXTRA`). Both are GET only.
- Tests run with `node --test web-dev/tests/*.test.mjs`. `function-map.test.mjs` `machine()` is a VM with stubbed
  graphics, text and audio. `web-dev/smoketest/` loads the real `Renderer`, `TextBox` and `VM` in a page.

## Lessons from Portuguese (2026-11-17)

These shape the import and the checks:

- **Never key a translation by its position in a file.**
  - Two scene files had the right line count with lines one or two out (`01_00_ARC01_1_2`, `06_00_ARC06_1_2`).
    deepLuna's own build ships them shifted.
  - The `<PageN>` markers are not reliable either: `06_00_ARC06_2` has an empty page, and its last two pages run
    together.
  - The tool stores every translation by line number. Import aligns and reports what it could not place.
- **Checking quote shape against the Japanese is cheap and works.** If a line opens or closes a quotation in Japanese,
  the translation almost always does too, so a run of disagreeing lines marks a shift. Keep it as a check.
- **Real source mess to expect:**
  - tabs used as indents;
  - U+3000 paragraph indents;
  - `^` breaks in the corners;
  - glued mark lines (■, ..., .) dropped by the translator;
  - a revised copy of a scene under another file name (`…_2pt.txt`);
  - a "work in progress" folder that is still mostly Japanese.
- **English fallback per line works.** Unfinished languages are fine to ship that way, but their plate should only
  show where their folder is (`home.js` `langShown`, `ptThere`).
- **Adding a text-only language touches many places:**
  - `lang.js`: `LANGS`, a flag, `LAYERS`, `scriptsOf`;
  - `home.js`: the plate, the row, the start line;
  - `sitewords-table.js`: three strings in Japanese and Chinese;
  - `welcome.js`: the credit;
  - the assets manifest;
  - three test files (`lang.test.mjs`, `app-update.test.mjs`, `assets.test.mjs`).

  Stage 1 folds most of this into one table.

## Design

### Where translations live

One folder per language, one JSON file per scene:
`<translations>/<code>/<scene>.json` = `{ scene, lines: [{ id, text, status, note, from: { lang, hash } }] }`.

- `id` is the port's line number.
- `status` is `empty`, `draft`, `reviewed` or `final`.
- `from` records which version the line was translated from (`ja`, `en`, `aniplex`) and a hash of that line. When the
  source line changes later, the translation is flagged as stale.

Scene files keep git diffs small, so several translators can merge.

The folder is chosen when the tool starts. Whether it sits inside this repository or in the translators' own is decision
1 below.

### The pieces, in the order to build them

Each stage ends with its own tests and is usable on its own.

**Stage 0: foundations, no interface.**
- `web-dev/tools/line_map.py` writes `web-dev/data/line_map.json`. It holds numbers only, no game text. For every line:
  - scene name, script index and command;
  - page;
  - glued or not, choice or not;
  - voice file;
  - route and day (from the scene names).

  It is built from the English scripts. Lines named twice keep every command.
- `web-dev/fit/` is a page served by `dev_server.py` that uses the real `TextBox` and styles. Given a page's lines, it
  returns rows and the lowest pixel; given a choice or a corner line, its width. A runner (Playwright, own profile) walks
  every page of a `text.json` and writes a report.
- Run the runner on English, Aniplex and Portuguese now, to set the baseline: Portuguese's two fullest pages ended at
  751 px.
- Done when: the map covers every named line, and the fit report for English shows no page past 1,076 px.

**Stage 0 as built (2026-11-17).**
- Files:
  - `web-dev/tools/line_map.py` → `web-dev/data/line_map.json` (4.4 MB, a row per page and per line, so a script change is a
    small diff). Scenes (name, route, day, part or Q&A episode), pages, lines, and `ja` (below). Not in the repository:
    `web-dev/data/` holds data made from the game's files and is ignored, so run the tool after
    `fetch_assets.py --tables`.
  - `web-dev/fit/fit.html` + `fit.js`: the fit page, at `/fit/` of `dev_server.py` (also `/fit/fit.js`, `/fit/line_map.json`).
    `?text=/assets/pt/text.json` picks the lines, `?page=n` shows a page, `&font=gelasio` sets the story in the bundled face
    (what a machine without Georgia shows, Android among them). It makes storage read-only before the game's code loads.
  - `web-dev/fit/run-mcp.js`: the runner, for the Playwright MCP (own profile). On `dev_server.py` it needs nothing more; on
    any other server of the game, `&root=<web-dev folder>` routes `/fit/*` from disk.
  - `web-dev/tools/fit_summary.py` → `web-dev/audit/fit-summary.json`, from `web-dev/audit/fit-en.json`, `fit-en-gelasio.json`,
    `fit-aniplex.json` and `fit-pt.json`.
  - `web-dev/tests/line-map.test.mjs` (8 tests).
  - `.claude/launch.json` has `tsukihime-dev-8798` (`dev_server.py`); it was not started, because the folder already had five
    other chats' servers. The runs used the parent session's game server on 8797 with `&root`.
- What the map found:
  - 43,906 of 43,960 lines named; 54 never; 22 named by two or three commands (all kept).
  - 15,818 pages. 43 have more than one way through (IF__, GOTS, IFSC); each way is listed as runs of commands. No cap
    was hit. A path remembers the tests it passed, so `IF__ F075 ne 0` then `IF__ F075 eq 0` is one choice row, not both.
  - IFP4 blocks (PlayStation 4 only, never run) hold no lines, so no line is "dead". Their WKADs and WNTYs are skipped.
  - 16,680 voiced lines, 197 choices, 1,294 glued. Glued means set on the row before: deepLuna's 713 `is_glued`, plus
    the English's timed continuations (`$a@k@e@n`, then an MSAD), which share the row in the port too.
  - Japanese and Chinese: 241 scripts of their own. 2,911 lines are at other commands there, listed under `ja.at`; their
    pages are not mapped.
- How to run it (about 11 s a language):
  1. `python3 web-dev/tools/line_map.py`
  2. In the Playwright MCP:
     - `browser_navigate` to `http://localhost:PORT/fit/?text=/assets/<x>/text.json`;
     - `browser_run_code_unsafe` with `filename: tsukire-pc-port/web-dev/fit/run-mcp.js`;
     - `browser_evaluate` `() => JSON.stringify(window.__fitReport)` with `filename: tsukire-pc-port/web-dev/audit/fit-<x>.json`.

     The MCP's code has no file access, and it writes an object in inspector notation, so the report goes out as a string.
  3. `python3 web-dev/tools/fit_summary.py`
- Checked against the game at `/?script=S&pc=P` with the text finished. These gave the same rows, lowest pixel, and
  choice and balloon edges as the fit page:
  - English pages of 14 rows, 12 rows, blank rows and glued MSADs;
  - an English balloon and a two-row choice;
  - a Portuguese and an Aniplex 11-row page, each in its own mode (`lang=pt`, `english=aniplex`);
  - a Portuguese and an Aniplex balloon.

  `lang.js` `PT` and `OFFICIAL` only pick files (and `<html lang>`, which no style reads), so swapping the lines in English
  mode is what the game does. "Lowest pixel" is the bottom of the letter boxes, 62.5 px below the row's top: row 8 ends at
  751, row 12 at 1,061, and row 12's line box at 1,076. In Gelasio every row ends 3 px lower.
- Results (`web-dev/audit/fit-summary.json`):
  - **English (Tsukihimates):** one page past 12 rows. Page 7936, `08_01_CIEL08_5`, lines 19381–19383, is 14 rows: the
    scream in 19383 is 10 rows by itself (15 rows in the patch's own 55-cell breaks; the Japanese page is 9 rows). Seen
    on screen in the port: its last two rows are below the screen. So the "done when" above fails on the English text
    itself, not on the harness. Next fullest: two pages of 12 rows. No choice row is pushed over the text. The widest
    choice is 1,373.2 px (line 42765). No balloon letter is outside its picture in any of the 649 balloon pages.
    Gelasio gives the same verdicts.
  - **Aniplex:** no page past 12 rows (fullest 11), widest choice 1,124.5 px. 231 of 649 balloon pages had letters
    outside the balloon. In QA_01, "…here,but you're a part" ran past the balloon's right edge. The cause: the official
    scripts set 514 corner sentences as one message with a row break between two lines (`$042793^$042794`). The port
    plays Aniplex's lines with Tsukihimates' scripts, which give the second line its own MSAD glued to the first's row;
    Tsukihimates puts the break in its text, the official text has none. Fixed the same day (below): 3 left.
  - **Portuguese:** its only page past 12 rows is the English page 7936 (Ciel's day 8 is not translated). Its fullest
    translated pages are 11 rows (983.5 px), so the "751 px" above did not come from a walk of every page. No choice is
    wider than the English's widest. 24 balloon pages, all translated (QA 1–14), had letters outside the balloon; one row
    reached x 1,914. Seen on screen in QA_13 and QA_14: the first row ran past the balloon's right edge. Fixed (below): 0
    left.
- **Balloon fix (2026-11-17, the user's choice of two):**
  - `build_aniplex.py` reads the official scripts (`../tsukihime-global-script/scripts`) and ends with a row break each
    corner line the official scripts break from the next while the port's scripts glue them: 512 lines. This is the same
    mechanism as Tsukihimates' text. `aniplex/text.json` grew 1,024 bytes; `web-dev/assets-manifest.txt` and the tests
    that pin it are updated.
  - `textbox.js` `BALLOON_INSIDE`: text laid over the English (`lang.js` `LAYERS` not empty and not Japanese/Chinese:
    Aniplex, Portuguese, later translations) wraps each balloon at the width that stays on its picture, not at the game's
    table width, which runs 30–400 px past the picture. The 30 widths come from `fit.insideWidths()`; the runner refuses
    to run if the table and the pictures disagree. Every Tsukihimates balloon row is narrower than its balloon's inside,
    and Tsukihimates keeps the table width anyway: the English report is identical before and after.
  - Result: Aniplex 231 → 3 balloon pages out, Portuguese 24 → 0, English 0. No story page moved in any language.
  - The 3 left are Aniplex pages 15308 (QA_07), 15585 and 15601 (QA_18). The official rows are wider than the balloon
    in the port's 42 px SeuratPro, so a fourth row falls below it. The official script uses the same balloons there,
    so the official engine's face must be narrower. Not changed.
  - `web-dev/tests/balloon-rows.test.mjs` (5 tests).
- Left for later stages: Stage 4's balloon check is the fit page's (letters against the picture). Stage 2 needs a runner
  that works over an installed app.

**Stage 1: build and registration.**
- `web-dev/tools/build_layer.py` generalises `build_pt.py`. Translations folder in, `web/assets/<code>/text.json` and
  `index.json` out, with English fallback and every check below run as a gate.
- `build_pt.py` becomes an importer that feeds it.
- One language table in `lang.js`: code, plate, row text, start line, layers, device-default or not, downloaded in the
  apps or not, folder-gated or not. `home.js`, `update.js` and the tests read the table instead of their own lists.
- Done when: adding a language is one table row, a folder and its page strings.

**Stage 2: the editor.**
- `web-dev/translator/` is served by `dev_server.py` at `/translator/`.
- Scenes are listed by route and day, with progress bars.
- Each line is a row: reference columns (any of Japanese, Tsukihimates, Aniplex, Chinese or another layer), the edit box,
  status and note.
- Markup shows readably: italics in italics, ruby as two fields, marks as small tags. It is written back exactly.
- Saving needs a write route in `dev_server.py`: localhost only, POST, limited to the chosen translations folder.
- Search and replace work across the whole language, with every match shown first.

**Stage 3: preview and play.**
- The current page shows in the Stage 0 fit page, with an over-12-rows warning as you type.
- "Play from here" uses `/?script=S&pc=P&lang=draft`. `dev_server.py` serves `/assets/draft/` by building the layer on
  the fly from the translations folder, so the game shows the work as it stands.

**Stage 4: checks**, run on save and before a build:
- untranslated lines, and source text left in;
- markup changed: ruby, italics, `@` marks, tags, `^` in corners;
- a page past 12 rows, a choice wider than the widest English one, a corner row past its balloon;
- letters the language's story font lacks;
- the same source line translated two ways;
- stale lines (the source hash changed);
- quote shape against the Japanese (the shift check);
- tabs, `\r`, stray `%{` codes.

**Stage 5: consistency.**
- Glossary: agreed spellings of names and terms, and a flag where a line uses the source term without the agreed one.
- Translation memory: identical and near-identical source lines suggest earlier translations. 4,865 English lines repeat
  exactly.

**Stage 6: import and export.**
- Import deepLuna's legacy and readable formats (the code is in `build_pt.py`), plus CSV, PO and XLIFF.
- Every import aligns by line number, and reports what it placed and what it left.
- Export goes to the same formats, for teams using other tools.

**Stage 7: everything that is not story text.**
- Menus and messages (`system.json` messages, gallery titles, flowchart notes), `words.js`, and the site's words.
  This needs the app to take these as overlays from a text-only layer, which it does not today.
- Pictures with letters: use `ja/index.json`'s `ui/`, `img/` and `movie/` entries as the list, with the original beside
  an upload slot and a size check.
- Fonts trimmed to the letters used (as `build_zh.py` does).
- Movie subtitles (the `subs.js` format).

**Later, only if asked:** a hosted version for teams working online (a Cloudflare Worker with D1, GitHub sign-in).

## Decisions (answered by the user, 2026-11-17)

1. **Where translations live, and copyright: in the translators' own repositories.** This repository keeps only the
   tool. In the user's words: translators keep the work in their own repository while they work on it; they download the
   app and the tool, which runs on top of the app; when they release their work, the user adds it to R2 and releases it
   on the site.
   - So the tool is handed to translators, not only run from this checkout. From Stage 2 on it must run over an installed
     app's files (the desktop app's `www`, or a `web/` folder filled by `fetch_assets.py`), point at a translations
     folder outside both, and need nothing else from `web-dev/`. Stage 0's map and fit page are written with that in
     mind: the map is numbers only and can ship with the tool, and the fit page needs only `web/app` and `web/assets`.
   - Releasing stays the user's job: the tool's output is a language folder (`text.json` + `index.json`) the user
     uploads.
2. **Default reference columns: Japanese and Tsukihimates side by side.** Any other version can be switched on.
3. **Local only.** No hosted version until a team asks.
4. **Yes: fold language registration into one table in Stage 1**, before a fifth language.
5. **Right-to-left and no-space scripts are out of scope** unless asked.

## Rough size

- Stages 0–1: about a session each.
- Stages 2–4: two or three sessions.
- Stages 5–7: a session each, Stage 7 more if pictures are wanted.
