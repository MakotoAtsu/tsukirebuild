#!/usr/bin/env python3
"""build_pt.py <repo root> [PT-BR checkout] [--check-english]: the Brazilian Portuguese fan translation -> web/assets/pt.

The translation is HanabiWorks' (hanabiworks.github.io/tsukihime: credited in ABOUT, welcome.js, and web/README.md).
Source: github.com/ThiagoKrz/TsukihimeRE-PTBR, the translation's working repository, cloned beside the repo root as ../ptbr-source
(`git clone --depth 1 https://github.com/ThiagoKrz/TsukihimeRE-PTBR.git ptbr-source`). It is a deepLuna project, the tool
Tsukihimates made their English patch with, so its lines are laid out by the same rules as the port's English (text.json is
the Tsukihimates patch's script_text.mrg as it is).

The translation is incomplete. Every scene it has is shown in Portuguese; every other scene is the port's English
(Tsukihimates) line for line, so the story goes on in English where the Portuguese ends (in the checkout of 2026-11-17: the
prologue scenes, all of Arcueid's route, Ciel's days 1-5 and Ciel-sensei's corner 1-14).

  pt/text.json    43,960 lines, numbered as the port numbers them: Portuguese where translated, English elsewhere
  pt/index.json   the list, which app/js/lang.js reads

What is read from the checkout:
  deepluna_db.json   scene_map: each scene's lines in order, with the line number in script_text.mrg (= the port's number),
                     page, and glue / choice flags; its Japanese is checked against ja/text.json at the same numbers
  scripts/TL/        the translated scenes, one file per scene, deepLuna's legacy format: <PageN> markers, one line per
                     text line, '#' joining lines glued on one row, '//' a comment, 'C:>' marking a choice

What is not used:
  scripts/traduzindo/   work in progress (Ciel's day 6): most of it is still Japanese, and their own build leaves it out
  files named after no scene with text (02_00_ARC02_3_2.txt: an empty scene)
  ui/                   Switch textures (bntx) of the menus: the port's menus stay English
(A file named after a scene plus "pt", 01_00_ARC01_1_2pt.txt, is a revision of that scene, which their build never reads:
it is tried as another copy of the scene, below.)
  luna/, luna_cli.py    not run: the rules they apply are written out below (deepLuna's RubyUtils and
                        TranslationDb.generate_linebroken_text_map), so the build needs nothing but this file

Lines are made as deepLuna makes them for the patch: control codes (%{n} new row, %{s}, %{center}, %{i} ...) applied, then
broken at 55 cells (a letter above U+00FF counts two, private-use letters one), with glued lines continuing the row of the
line before. Italic codes give plain letters, as in the PT-BR build (its ENABLE_PUA_CODES is off): the translation marks
its italics with @g, which the text box slants as it does for the English.

Their build lays a scene file's lines on the scene's in order when the totals agree and skips the file otherwise, which
both drops scenes and ships lines shifted. Here every copy of a scene is tried two ways, in order and page by page
(matchings), and the one whose quotations agree best with the Japanese is kept (fit). Page by page, a page short by glued
lines that are only marks (■, ..., .) has the marks put back from the English, and any other page that does not match is
shown in English; the build says which. A choice is given the English's leading space (the gap after its number mark).

--check-english rebuilds the English from the Tsukihimates reference in the checkout (scripts/ref-patch-gringo, deepLuna's
readable format) with the same rules and the italic codes on, and compares it with text.json: the proof that the rules
here are deepLuna's.
"""
import glob
import itertools
import json
import os
import re
import sys

CELLS = 55          # Constants.CHARS_PER_LINE
PUA = 0xE000


class LineError(ValueError):
    pass


# --- deepLuna's RubyUtils ---------------------------------------------------------------------------------------------

def cells(s):
    """unicode_aware_len: private-use letters one cell, anything above U+00FF two, the rest one."""
    n = 0
    for c in s:
        o = ord(c)
        n += 1 if o >= 0xE000 else 2 if o > 256 else 1
    return n


def base_text(s):
    """remove_ruby_text: <base|reading> -> base."""
    out, in_ruby, mid = [], False, False
    for c in s:
        if c == "<":
            if in_ruby:
                raise LineError(f"ruby opened twice in {s!r}")
            in_ruby, mid = True, False
            continue
        if c == "|":
            if not in_ruby:
                raise LineError(f"'|' outside ruby in {s!r}")
            mid = True
            continue
        if c == ">":
            if not in_ruby or not mid:
                raise LineError(f"'>' without ruby in {s!r}")
            in_ruby, mid = False, True
            continue
        if not in_ruby or not mid:
            out.append(c)
    return "".join(out)


def width(s):
    """noruby_len."""
    return cells(base_text(s))


def words(line):
    """ruby_aware_split_words: split at spaces and row breaks outside ruby; a row break is a word of its own."""
    out, acc, in_ruby = [], "", False
    for c in line:
        if c == "<":
            if in_ruby:
                raise LineError(f"ruby opened twice in {line!r}")
            in_ruby = True
        if c == ">":
            if not in_ruby:
                raise LineError(f"'>' without ruby in {line!r}")
            in_ruby = False
        if c in " \n" and not in_ruby:
            out.append(acc)
            if c == "\n":
                out.append("\n")
            acc = ""
            continue
        acc += c
    if acc:
        out.append(acc)
    return out


def apply_codes(text, pua=False):
    """apply_control_codes. Returns the text with %{...} codes applied."""
    out = ""
    pct = in_cc = False
    acc = ""
    offset = None
    center = right = False
    for c in text:
        if c == "%":
            pct = True
            continue
        if pct:
            pct = False
            if c == "{":
                in_cc, acc = True, ""
                continue
            in_cc, acc = False, ""
            out += "%" + c
            continue
        if in_cc and c == "}":
            in_cc = False
            if acc == "n":
                out += "\n"
            elif acc == "s":
                out += " "
            elif acc == "center":
                center = True
            elif acc == "align_right":
                right = True
            elif acc in ("no_break", "nothing", "force_glue"):
                pass
            elif acc == "e_35":
                out += ""
            elif acc in ("i", "r", "ri", "g", "flip_vertical"):
                if pua:
                    offset = PUA + 128 * {"i": 0, "r": 1, "ri": 2, "g": 3, "flip_vertical": 5}[acc]
            elif acc[:1] == "/":
                offset = None
            else:
                raise LineError(f"unknown control code %{{{acc}}} in {text!r}")
            continue
        if not in_cc:
            if offset and ord(c) < 128 and c not in " \n":
                out += chr(ord(c) + offset)
            else:
                out += c
        else:
            acc += c
    if center or right:
        if "\n" in out or width(out) > CELLS:
            raise LineError(f"a centred or right-aligned line that does not fit one row: {text!r}")
        pad = CELLS - width(out)
        out = " " * (pad // 2 if center else pad) + out
    return out


def linebreak(line, start=0):
    """linebreak_text: break at CELLS, the first row starting at cell `start`."""
    if width(line) + start <= CELLS:
        return line
    split = words(line)
    rows, acc, first = [], "", True
    for word in split:
        if width(word) > CELLS:
            if "<" in word or ">" in word:
                raise LineError(f"cannot break ruby {word!r} in {line!r}")
            while word:
                room = CELLS - width(acc + " ") if acc else CELLS
                acc = acc + " " + word[:room] if acc else word[:room]
                if width(acc) >= CELLS:
                    rows.append(acc)
                    acc, start, first = "", 0, False
                word = word[room:]
            continue
        if width(acc + " " + word) + start > CELLS:
            rows.append(acc)
            if word == "\n":
                acc, first = "", True
            else:
                acc, first = word, False
            start = 0
            continue
        if word == "\n":
            rows.append(acc)
            acc, start, first = "", 0, True
            continue
        acc = word if first else acc + " " + word
        first = False
    if acc or split[-1] == "\n":
        rows.append(acc)
    return "\n".join(rows)


# --- deepLuna's TranslationDb.generate_linebroken_text_map, for one scene --------------------------------------------

def lay_out(scene, cmds, tl, jp, fallback, out, pua=False):
    """Write the shown text of every line of `scene` into out[offset].

    cmds: the scene's scene_map entries. tl: {offset: translation} (deepLuna's en_text). jp: {offset: Japanese line}.
    fallback(offset): the line shown where tl has none (deepLuna shows the Japanese; the port's Portuguese shows English).
    """
    cursor, prev_page = 0, None
    qa = scene.startswith("QA")
    for k, cmd in enumerate(cmds):
        off = cmd["offset"]
        text = tl.get(off)
        if not text:
            out[off] = fallback(off)
            continue
        text = text.replace("\n", "")
        glued = cmd.get("is_glued", False)
        if not (glued or "%{force_glue}" in text) and not qa:
            cursor = 0
        if cmd["page_number"] != prev_page:
            prev_page = cmd["page_number"]
            cursor = 0
        no_break = "%{no_break}" in text
        coded = apply_codes(text, pua)
        if coded and glued and k > 0:
            before = out[cmds[k - 1]["offset"]]
            if before and before[-1] == "\n" and coded[0] == " ":
                coded = coded[1:]
        broken = coded if (qa or no_break) else linebreak(coded, cursor)
        split = broken.split("\n")
        last = split[-1]
        old = cursor
        cursor = width(last) if len(split) > 1 else cursor + width(last)
        cursor %= CELLS
        if k + 1 < len(cmds) and cmds[k + 1].get("is_glued") and broken:
            nxt = tl.get(cmds[k + 1]["offset"]) or jp[off]   # (deepLuna falls back to this line's Japanese here)
            if nxt and nxt[0] == " " and broken[-1] != "\n" and cursor == 0:
                broken += "\n"
            word = width(apply_codes(nxt.split(" ")[0], pua))
            if len(split) > 1:
                would_break = width(last) + word > CELLS
            else:
                would_break = old + width(last) + word > CELLS
            if nxt and nxt[0] != " " and broken[-1] != "\n" and would_break:
                if " " not in broken:
                    raise LineError(f"line {off}: the glued line after it needs a break this line cannot give: {text!r}")
                parts = broken.split(" ")
                broken = " ".join(parts[:-2] + ["\n".join(parts[-2:])])
                cursor = width(broken.split("\n")[-1])
        out[off] = broken


# --- reading the checkout ---------------------------------------------------------------------------------------------

def legacy_pages(path):
    """A legacy scene file: [(page number, [(text, comment)])], as deepLuna's import_legacy_update_file reads the lines."""
    pages, cur = [], None
    for line in open(path, encoding="utf-8").read().split("\n"):
        if not line:
            continue
        m = re.match(r"<Page(\d+)>", line)
        if line.startswith("<Page"):
            cur = (int(m.group(1)) if m else None, [])
            pages.append(cur)
            continue
        if cur is None:
            cur = (None, [])
            pages.append(cur)
        line = line.replace("C:>", "")
        parts = line.split("//")
        comment = parts[1] if len(parts) > 1 else None
        for frag in parts[0].split("#"):
            cur[1].append((untab(frag), comment))
    return pages


def untab(s):
    """One translator indents with tabs (56 lines) where the rest write the Japanese wide space U+3000: a leading tab is that
    space, a trailing one goes, any other is a space (the text box would draw a tab eight spaces wide)."""
    if "\t" not in s:
        return s
    body = s.lstrip("\t")
    return ("　" if len(body) < len(s) else "") + body.rstrip("\t").replace("\t", " ")


def page_groups(cmds):
    return [list(g) for _, g in itertools.groupby(cmds, key=lambda c: c["page_number"])]


MARKS_ONLY = re.compile(r"^[^\w]*$")


OPEN, CLOSE = "\"“「『'‘", "\"”」』'’"


def shape(s):
    """Whether a line opens and closes a quotation: the Japanese line's (「」『』“”) and its translation's agree on it nearly
    always, so a run of lines that disagree is a translation laid on the wrong lines."""
    s = re.sub(r"^(?:[　 ^\t]|@[a-z]|%\{[^}]*\})+", "", s)
    s = re.sub(r"(?:[　 ^\t]|%\{[^}]*\})+$", "", s)
    return s[:1] in OPEN, s[-1:] in CLOSE


def fit(tl, cmds, jp):
    """How badly a matching sits: lines whose quotation disagrees with the Japanese, and a tenth for each line left English."""
    placed = [c["offset"] for c in cmds if c["offset"] in tl]
    return sum(shape(tl[o]) != shape(jp[o]) for o in placed) + 0.1 * (len(cmds) - len(placed))


def matchings(scene, cmds, pages, english):
    """The ways a scene file can be laid on the scene: [(how, {offset: translation}, notes)].

    "in order": deepLuna's, every line on the next whenever the totals agree. "by page": page by page, which keeps a shift
    from running on where a page has one line too many and a later one too few (01_00_ARC01_1_2, 06_00_ARC06_1_2: their own
    build shows those lines one or two out); a page that cannot be matched is left out (shown in English). The page markers
    are not always the scene's pages (06_00_ARC06_2 has an empty one and its last two run together), so neither way is
    right everywhere; the caller keeps the one that sits best (fit)."""
    lines = [t for _, frags in pages for t, _ in frags]
    groups = page_groups(cmds)
    out = []
    if len(lines) == len(cmds):
        out.append(("in order", {c["offset"]: t for c, t in zip(cmds, lines)}, []))
    if len(groups) == len(pages):
        out.append(("by page", *by_page(scene, groups, pages, english)))
    return out


def by_page(scene, groups, pages, english):
    tl, notes = {}, []
    for n, (group, (_, frags)) in enumerate(zip(groups, pages), 1):
        texts = [t for t, _ in frags]
        if len(texts) == len(group):
            tl.update({c["offset"]: t for c, t in zip(group, texts)})
            continue
        short = len(group) - len(texts)
        marks = [i for i, c in enumerate(group) if c.get("is_glued") and MARKS_ONLY.match(english[c["offset"]])]
        if short > 0 and len(marks) == short:
            it = iter(texts)
            for i, c in enumerate(group):
                tl[c["offset"]] = english[c["offset"]] if i in marks else next(it)
            notes.append(f"{scene} page {n}: {short} glued mark line(s) missing, put back from the English: "
                         + ", ".join(repr(english[group[i]["offset"]]) for i in marks))
        else:
            notes.append(f"{scene} page {n}: {len(texts)} lines for the scene's {len(group)}: page shown in English")
    return tl, notes


def readable_blocks(path):
    """deepLuna's readable format: [sha:H]{ ... } or [offset:N]{ ... }; '--' starts a machine comment, '//' a human one."""
    text = open(path, encoding="utf-8").read()
    for m in re.finditer(r"\[(sha|offset):([0-9a-f]+)\]\s*\{(.*?)\n\}", text, re.S):
        kept = []
        for line in m.group(3).split("\n"):
            line = re.split(r"--|//", line)[0].rstrip()
            if line:
                kept.append(line)
        yield m.group(1), m.group(2), "\n".join(kept)


# --- main -------------------------------------------------------------------------------------------------------------

def load(root, src):
    assets = os.path.join(root, "web", "assets")
    db = json.load(open(os.path.join(src, "deepluna_db.json"), encoding="utf-8"))
    english = json.load(open(os.path.join(assets, "text.json"), encoding="utf-8"))
    scenes = {k: v for k, v in db["scene_map"].items() if v}
    jp = {c["offset"]: db["line_by_hash"][c["jp_hash"]]["jp_text"].replace("\r\n", "") for v in scenes.values() for c in v}
    ja = os.path.join(assets, "ja", "text.json")
    if os.path.exists(ja):
        port_ja = [l.replace("", "") for l in json.load(open(ja, encoding="utf-8"))]
        same = sum(1 for o, t in jp.items() if o < len(port_ja) and port_ja[o] == t)
        if same < len(jp) - 200:
            raise SystemExit(f"only {same} of {len(jp)} Japanese lines match ja/text.json at the same numbers: not the numbering this was made for")
    return assets, db, english, scenes, jp


def check_english(root, src):
    assets, db, english, scenes, jp = load(root, src)
    by_sha, by_off = {}, {}
    for path in glob.glob(os.path.join(src, "scripts", "ref-patch-gringo", "**", "*.txt"), recursive=True):
        for kind, key, text in readable_blocks(path):
            if text:
                (by_sha if kind == "sha" else by_off)[key if kind == "sha" else int(key)] = text
    tl = {}
    for v in scenes.values():
        for c in v:
            t = by_off.get(c["offset"]) or by_sha.get(c["jp_hash"])
            if t:
                tl[c["offset"]] = t
    out = {}
    for scene, cmds in scenes.items():
        try:
            lay_out(scene, cmds, tl, jp, lambda o: jp[o], out, pua=True)
        except LineError as e:
            print(f"{scene}: {e}")
    offs = [o for o in tl if o in out]
    same = sum(out[o] == english[o] for o in offs)
    print(f"English rebuilt from the Tsukihimates reference: {same} of {len(offs)} translated lines equal text.json")
    diff = [o for o in offs if out[o] != english[o]]
    for o in diff[:12]:
        print(f"  {o}: rebuilt {out[o][:90]!r}\n  {' ' * len(str(o))}  port    {english[o][:90]!r}")
    return same, len(offs)


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    root = os.path.abspath(args[0] if args else ".")
    src = args[1] if len(args) > 1 else os.path.join(root, "..", "ptbr-source")
    if "--check-english" in argv:
        check_english(root, src)
        return
    assets, db, english, scenes, jp = load(root, src)
    files = {}   # scene -> its files: <scene>.txt, and a revision <scene>pt.txt where there is one
    for path in sorted(glob.glob(os.path.join(src, "scripts", "TL", "**", "*.txt"), recursive=True)):
        name = os.path.basename(path)[:-4]
        scene = name if name in scenes else name[:-2] if name.endswith("pt") and name[:-2] in scenes else None
        if scene is None:
            print(f"skipped {os.path.relpath(path, src)}: names no scene with text")
            continue
        files.setdefault(scene, []).append(path)
    notes, tl = [], {}
    for scene, paths in files.items():
        # every way of laying every copy of the scene (01_00_ARC01_1_2pt.txt is a revision of 01_00_ARC01_1_2.txt that their
        # build never reads, and the one that sits), the best kept
        cmds = scenes[scene]
        tries = [(fit(got, cmds, jp), how, path, got, said)
                 for path in paths for how, got, said in matchings(scene, cmds, legacy_pages(path), english)]
        if not tries:
            notes.append(f"{scene}: its file has neither the scene's lines nor its pages: shown in English")
            continue
        score, how, path, got, said = min(tries, key=lambda t: t[0])
        usual = os.path.basename(path) == f"{scene}.txt" and how == "in order"
        if not usual:
            others = ", ".join(f"{os.path.basename(p)} {h} {s:.1f}" for s, h, p, _, _ in tries)
            notes.append(f"{scene}: {os.path.basename(path)} {how} (fit {score:.1f}; tried {others})")
            notes += said
        tl.update(got)
    out = list(english)
    shown = {}
    for scene in files:
        lay_out(scene, scenes[scene], tl, jp, lambda o: english[o], shown)
    for o, t in shown.items():
        out[o] = t
    # A choice's row is the game's number mark ("1.") and then the line: every English choice starts with the space between
    # the two, and nearly every Portuguese one has none ("1.Não tenho ..."), so it is given the English's.
    for cmds in scenes.values():
        for c in cmds:
            o = c["offset"]
            if c.get("is_choice") and o in shown and english[o].startswith(" ") and not out[o].startswith(" "):
                out[o] = " " + out[o]
    folder = os.path.join(assets, "pt")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "text.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(folder, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"files": ["text.json"]}, f, separators=(",", ":"))
    for n in notes:
        print(n)
    changed = sum(a != b for a, b in zip(out, english))
    print(f"pt/text.json: {len(out)} lines; {len(files)} scenes translated, {len(tl)} lines from the translation, "
          f"{changed} differ from the English")


if __name__ == "__main__":
    main(sys.argv)
