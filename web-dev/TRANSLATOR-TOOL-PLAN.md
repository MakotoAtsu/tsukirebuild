# Translator tool: plan

Written 2026-11-17. Nothing here is built yet. The plan is for a developer-only tool that helps a team translate the game
into a new language and get it into the port. It builds on what the port already has. It also draws on what adding
Portuguese turned up the same day (`web-dev/tools/build_pt.py`).

## What it is for

A translator should be able to:

- see each line next to the versions that already exist;
- write theirs;
- see it in the real text box and play it in the game;
- run checks that catch what goes wrong in practice;
- hand back a folder the port can serve as a language.

The tool runs locally from `web-dev/`. It is never deployed or packaged: deploy uploads only tracked `web/app` files,
and the apps pack only `web/app` and `web/assets`.

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

## Decisions for the user

1. **Where translations live, and copyright.** The Japanese and both English scripts are not ours to hand around, and the
   game's files left this repository on 2026-11-12 for that reason. A translation is the translators' work, but it is
   built on that script. Should translations sit in this repository, or in the translators' own repositories (as
   HanabiWorks does), with the tool pointing at a folder? My default: their own repositories; this repository keeps only
   the tool.
2. **Translate from Japanese or from English?** The tool can show both; this only changes the default columns.
3. **Local only, or hosted later?** My default: local only until a team asks.
4. **Fold language registration into one table (Stage 1) before adding a fifth language.** My default: yes.
5. **Right-to-left languages** (Arabic, Hebrew) need text-box work in the engine. Scripts without spaces (Thai) need
   their own line breaking. Out of scope unless asked.

## Rough size

- Stages 0–1: about a session each.
- Stages 2–4: two or three sessions.
- Stages 5–7: a session each, Stage 7 more if pictures are wanted.
