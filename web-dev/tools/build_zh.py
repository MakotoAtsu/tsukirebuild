#!/usr/bin/env python3
"""build_zh.py <repo root> [text] [scripts] [tables] [ui] [img] [movie] [font] [subs]: the Chinese fan patch -> web/assets/zh, for the language switch.

The patch (月姬REMAKE汉化补丁 v3.0, by Letdo1945, 2024-06-18; v2.13 until 2026-11-16, GitHub issue 12) is for the original game, version 1.0.2. Its
files are new ones (CHS.*, SCR.mrg, prologue.dat) and its exefs patch only renames what the engine opens to them (and keeps screenshots and recording on):
the engine runs it as it runs Japanese, wrapping the lines itself, with the original's scripts. Chinese is therefore laid over Japanese: web/assets/zh holds only what the patch shows that is not what Japanese shows (ja/, then the shared files), and lang.js asks for a file
there first, then under ja/, then the shared one.

  zh/text.json            the patch's lines, with the engine's row breaks (web-dev/data/zh_rows.json, read from the original engine running the patch's
                          files and faces: web-dev/tools/ja_rows/README.md)
  zh/rows.json            the rows of the messages laid out together with others, by script number, where they are not Japanese's (null: none): the
                          scripts are Japanese's (the patch has none of its own), and lang.js puts these in place of their `rows` as they are read
  zh/system.json          the keys of system.json that differ from Japanese's (messages, scene names, the help bar's label cells ...)
  zh/gallery.json, zh/flowchart.json   titles, credits and notes
  zh/ui/...               the interface art the patch redrew (title, menu, save, config, help bar, gallery; the start-up notices)
  zh/img/...              the story's pictures it redrew with Chinese writing (signs, letters, screens: web-dev/data/zh_v3_pictures.json), under the
                          original's names; zh/images.json the sizes of any made on another canvas
  zh/movie/...            the two chapter titles it translated (the other chapter titles read the same in Chinese and are the original's), and its
                          prologue: v3.0 sets the prologue's words in Chinese in the picture itself, where the original has its Japanese (no subtitles)
  zh/fonts/               its three faces (TsukuMin, TsukuGo, SeuratPro .woff2), cut down to the letters Chinese's files use and the usual punctuation
                          and symbol blocks (fontTools: FONTTOOLS_PYTHON names a Python that has it, with brotli, if this one has not); 18.5 MB whole
  zh/index.json           the list of all of it, which app/js/lang.js reads

The patch's openings are not used: the openings and endings are the translation's, as in Japanese (build_ja.py ENGLISH_MOVIES). Its prologue is, encoded
as the port's other movies are (AV1), at the user's word (2026-11-16: "just add prologue video then, make it av1"). v2.13 had left the original's Japanese
in the picture and burned subtitles in under it, so until then the port drew those subtitles over the original's movie (web-dev/data/zh_prologue_subs.json,
app/js/subs.js); v3.0 has no subtitles to draw, and zh/subs is gone.

The layer: mods/japan/_zh_v300 (the update's romfs with the patch's files on top under the original's names: parts, allpacml and allui cut out of CHS in
their own order, SCR.mrg as script_text.mrg; README.txt there; named with _ so the native build skips it).
"""
import filecmp
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "../../web-research/tools"))
import build_ja as ja        # (sets TSUKI_LAYER to the original game: set again below)

LAYER = "_zh_v300"
os.environ["TSUKI_LAYER"] = LAYER

ASSETS = ja.ASSETS
JA = ja.JA
ZH = os.path.join(ASSETS, "zh")
ROWS = os.path.join(HERE, "../data/zh_rows.json")
SUBS = os.path.join(HERE, "../data/zh_prologue_subs.json")
# v3.0's own numbers for the story's pictures it redrew, read from its exefs patch against the unpatched main (the strings it overwrites): original ->
# the entry of CHS the engine opens instead. The pre-blurred copies (_NN_NN) are left: the port blurs the sharp picture itself.
PICTURES = os.path.join(HERE, "../data/zh_v3_pictures.json")
MOVIES = ("phasetitle_02_00", "phasetitle_14_01", "prologue")


def below(rel):
    """The file Japanese shows at `rel` (under web/assets): its own, else the shared one."""
    own = os.path.join(JA, rel)
    return own if os.path.exists(own) else os.path.join(ASSETS, rel)


def rows_data():
    if not os.path.exists(ROWS):
        print("WARNING: no", os.path.relpath(ROWS, HERE), "- the lines are written without row breaks")
        return {"lines": {}, "ops": {}}
    return json.load(open(ROWS))


# ---- text and scripts ---------------------------------------------------------------------------------------------------------------
def build_text(rom):
    rows = rows_data()["lines"]
    lines = ja.lines_of(rom)
    out = [ja.with_rows(l, rows.get(str(i), [])) for i, l in enumerate(lines)]
    assert all(o.replace(ja.ROW, "") == l or "<" in l for o, l in zip(out, lines))
    assert len(out) == len(json.load(open(os.path.join(JA, "text.json")))), "the patch's lines are not the original's lines"
    with open(os.path.join(ZH, "text.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("text:", len(out), "lines,", sum(ja.ROW in o for o in out), "of them more than a row")
    return lines


def build_scripts(rom, lines):
    """The Chinese rows of the messages laid out together, by script, where they are not what Japanese's script has (zh/rows.json). The scripts themselves
    are the original's, which Japanese has (checked here: the same commands)."""
    import re
    import mzx
    from build_core import parse
    d = rom.read("allscr.mrg")
    ents = mzx.mrgd(d)
    names = json.load(open(os.path.join(ASSETS, "scripts", "index.json")))["names"]
    rows = rows_data()["ops"]
    shutil.rmtree(os.path.join(ZH, "scripts"), ignore_errors=True)
    table = {}
    for i, (o, e) in enumerate(ents[3:3 + len(names)]):
        raw = mzx.mzx(d[o:e])
        if raw[:1] == b"\xa0":
            raw = bytes(c ^ 0xFF for c in raw)
        ops, labels, zm, zl = parse(ja.mend(raw.decode("utf-8", "replace")))
        mine = json.loads(json.dumps({"name": names[i], "ops": ops, "labels": labels, "zm": zm, "zl": zl}))
        theirs = json.load(open(below(f"scripts/{i}.json")))
        r = rows.get(names[i])
        if r:
            mine["rows"] = {op: [ja.with_rows(lines[e[0]], e[1], len(e) > 2) for e in ents_] for op, ents_ in r.items()}
            for op, ents_ in r.items():
                ids = [int(x) for x in re.findall(r"\$(\d+)", ops[int(op)][1])]
                assert ops[int(op)][0] in ("MSG", "MSAD") and ids == [e[0] for e in ents_], (names[i], op, ops[int(op)], ents_)
        assert {k: v for k, v in mine.items() if k != "rows"} == {k: v for k, v in theirs.items() if k != "rows"}, ("script differs from Japanese's", i, names[i])
        if mine.get("rows") != theirs.get("rows"):
            table[str(i)] = mine.get("rows")
    with open(os.path.join(ZH, "rows.json"), "w") as f:
        json.dump(table, f, ensure_ascii=False, separators=(",", ":"))
    print("rows:", len(table), "of", len(names), "scripts have rows of their own,", sum(v is None for v in table.values()), "of them none")


# ---- the system's words -------------------------------------------------------------------------------------------------------------
def build_tables(root, rom):
    """system.json's keys that differ from Japanese's (shared + ja/system.json), and the gallery's and the flowchart's words."""
    from pathlib import Path
    import build_system, build_gallery, build_flowchart
    tmp = os.path.join(ZH, ".build")
    os.makedirs(tmp, exist_ok=True)
    mine = json.loads(json.dumps(build_system.build(Path(root), out=tmp)))
    base = json.load(open(os.path.join(ASSETS, "system.json")))
    base.update(json.load(open(os.path.join(JA, "system.json"))))
    # (imageSizes is about the story's pictures, which are Japanese's: build_ja.py sync_sizes fits it to them, and the patch has none of its own)
    over = {k: v for k, v in mine.items() if base.get(k) != v and k not in ("messagesSource", "imageSizes")}
    with open(os.path.join(ZH, "system.json"), "w") as f:
        json.dump(over, f, ensure_ascii=False, separators=(",", ":"))
    print("system: keys of its own:", ", ".join(over))
    build_gallery.build(Path(root), out=ZH)
    thumbs = "ui/CG_THUMB_PARTS_JA/cg_thumb_all.webp"
    if os.path.exists(os.path.join(ZH, thumbs)) and ja.same_picture(os.path.join(ZH, thumbs), below(thumbs)):
        os.remove(os.path.join(ZH, thumbs))
    build_flowchart.build(Path(root), out=ZH)
    for name in ("gallery.json", "flowchart.json"):
        if filecmp.cmp(os.path.join(ZH, name), below(name), shallow=False):
            os.remove(os.path.join(ZH, name))
            print(name, "is Japanese's")
    shutil.rmtree(tmp, ignore_errors=True)


# ---- interface art ------------------------------------------------------------------------------------------------------------------
def build_ui(root, rom):
    """Every interface picture of the patch that is not what Japanese shows, under zh/ui (the same names)."""
    import build_ui as ui
    tmp = os.path.join(ZH, ".build")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    manifest = os.path.join(tmp, "manifest.json")
    ui.main(root, out=os.path.join(tmp, "ui"), manifest=manifest)
    base = json.load(open(ui.MANIFEST))
    mine = json.load(open(manifest))
    sized = [(k, t) for k, v in mine.items() for t, wh in v.items() if base.get(k, {}).get(t) not in (None, wh)]
    if sized:
        print("WARNING: interface pictures of another size than the translation's:", sized[:8])
    kept = 0
    dest = os.path.join(ZH, "ui")
    shutil.rmtree(dest, ignore_errors=True)
    for pack in sorted(os.listdir(os.path.join(tmp, "ui"))):
        for f in sorted(os.listdir(os.path.join(tmp, "ui", pack))):
            a, b = os.path.join(tmp, "ui", pack, f), below(f"ui/{pack}/{f}")
            if not os.path.exists(os.path.join(ASSETS, "ui", pack, f)):
                continue                       # (a picture the port does not use, as in the shared folder)
            if filecmp.cmp(a, b, shallow=False) or ja.same_picture(a, b, 0.0001):
                continue
            os.makedirs(os.path.join(dest, pack), exist_ok=True)
            shutil.move(a, os.path.join(dest, pack, f))
            kept += 1
    shutil.rmtree(tmp, ignore_errors=True)
    print("ui:", kept, "pictures are Chinese's own")


# ---- the story's pictures -----------------------------------------------------------------------------------------------------------
def build_img(root, rom):
    """Every story picture the patch redrew that the port draws, under zh/img by the original's name, at the size the port draws it."""
    import re
    import convert
    import needed
    import packs
    from PIL import Image
    renames = {k: v for k, v in json.load(open(PICTURES)).items() if not re.search(r"_\d\d_\d\d$", k)}
    want = needed.needed(ASSETS)["images"]
    chs = {}
    for i, n, off, stored, _ in packs.entries(rom, "CHS"):
        chs.setdefault(n.split(".")[0].upper(), {"p": "CHS", "o": off, "s": stored})
    dest = os.path.join(ZH, "img")
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(dest)
    sized, made, unused = {}, 0, []
    for key, new in sorted(renames.items()):
        if key not in want:
            unused.append(key)
            continue
        assert new in chs, (key, new)
        im = convert.load_image(rom, chs[new])
        s = convert.scales().get(key, [0, 0, 1.0])
        scale = s[2]
        if (im.width, im.height) != (s[0], s[1]) and s[0]:
            sized[key] = [im.width, im.height, 1.0]      # (made on another canvas than the original's: its own size, kept whole)
            scale = 1.0
        w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
        sm = im if scale == 1.0 else im.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
        out = os.path.join(dest, key + ".avif")
        convert.save_avif(sm, out)
        made += 1
    images = os.path.join(ZH, "images.json")
    if sized:
        with open(images, "w") as f:
            json.dump(sized, f, separators=(",", ":"))
    elif os.path.exists(images):
        os.remove(images)
    print("img:", made, "pictures are Chinese's own,", len(sized), "of another size;", len(unused), "the port never draws:", unused[:6])


# ---- movies, faces, subtitles -------------------------------------------------------------------------------------------------------
def build_movies(root, rom):
    import convert
    dest = os.path.join(ZH, "movie")
    os.makedirs(dest, exist_ok=True)
    for n in MOVIES:
        assert rom.origin(f"movie/{n}.mp4") == "patch"
        out = os.path.join(dest, n + ".mp4")
        if not os.path.exists(out):
            convert.make_movie(rom, n, out)
        print("movie:", n, round(os.path.getsize(out) / 1e6, 1), "MB")


# Kept whole in every face beside the letters the files use: Latin, punctuation, symbols, kana, CJK punctuation, full-width forms (the story's own lines
# use letters from all of these; the port's text for Chinese is only what these files hold).
KEEP = [(0x20, 0x7E), (0xA0, 0xFF), (0x152, 0x153), (0x2000, 0x206F), (0x2100, 0x218F), (0x2190, 0x21FF), (0x2460, 0x24FF), (0x2500, 0x25FF),
        (0x2600, 0x26FF), (0x3000, 0x30FF), (0xFF00, 0xFFEF)]


def used_letters():
    """Every letter of Chinese's own files (the lines, the system's words, the gallery, the flowchart, the rows, the subtitles) and of the port's own
    Chinese words (app/js/ui.js HINTS_ZH, app/js/words.js, app/js/sitewords-table.js)."""
    import re
    out = set()
    for rel in ("text.json", "system.json", "gallery.json", "flowchart.json", "rows.json", "subs/prologue.json"):
        p = os.path.join(ZH, rel)
        if os.path.exists(p):
            out |= set(open(p, encoding="utf-8").read())
        elif rel != "subs/prologue.json":
            raise SystemExit(f"zh/{rel} is not made yet: build it before the fonts")
    ui = open(os.path.join(HERE, "../../web/app/js/ui.js"), encoding="utf-8").read()
    out |= set(re.search(r"export const HINTS_ZH = \{([^}]*)\}", ui).group(1))
    out |= set(open(os.path.join(HERE, "../../web/app/js/words.js"), encoding="utf-8").read())     # (the Controls page's Chinese words)
    out |= set(open(os.path.join(HERE, "../../web/app/js/sitewords-table.js"), encoding="utf-8").read())   # (the opening page's Chinese words)
    return {c for c in out if ord(c) >= 0x20}


def build_fonts(rom):
    """The patch's three faces, cut down to what Chinese shows (used_letters, KEEP), as WOFF2. The story's face lacks some of those letters (♪, ・, ー,
    traditional forms): the gothic face, which has them, is set after it (style.css html.zh), as the game falls back to it."""
    import subprocess
    import tempfile
    import convert
    py = os.environ.get("FONTTOOLS_PYTHON") or sys.executable
    if subprocess.run([py, "-c", "import fontTools.subset, brotli"], capture_output=True).returncode:
        raise SystemExit("fontTools and brotli are needed for the fonts: pip install fonttools brotli, or set FONTTOOLS_PYTHON")
    dest = os.path.join(ZH, "fonts")
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(dest)
    letters = "".join(sorted(used_letters()))
    keep = ",".join(f"{a:04X}-{b:04X}" for a, b in KEEP)
    with tempfile.TemporaryDirectory() as tmp:
        text = os.path.join(tmp, "letters.txt")
        open(text, "w", encoding="utf-8").write(letters)
        for rel, name in ja.FONTS.items():
            assert rom.origin(rel) == "patch"
            whole = os.path.join(tmp, name)
            convert.copy_file(rom, rel, whole)
            out = os.path.join(dest, os.path.splitext(name)[0] + ".woff2")
            subprocess.run([py, "-m", "fontTools.subset", whole, f"--text-file={text}", f"--unicodes={keep}", f"--output-file={out}", "--flavor=woff2",
                            "--layout-features=*", "--name-IDs=*", "--name-languages=*", "--notdef-outline", "--glyph-names", "--symbol-cmap",
                            "--legacy-cmap"], check=True)
            print("font:", name, round(os.path.getsize(whole) / 1e6, 1), "MB ->", os.path.basename(out), round(os.path.getsize(out) / 1e6, 2), "MB")
    print("fonts:", len(letters), "letters of the files kept")


def build_subs():
    """v3.0's prologue is its own movie (MOVIES), with its words in the picture: no subtitles to draw (v2.13's, SUBS, are kept for the record)."""
    shutil.rmtree(os.path.join(ZH, "subs"), ignore_errors=True)
    print("subs: none (the prologue is the patch's own movie)")


def write_index():
    ja.JA = ZH            # (write_index lists the folder it is given through the module's own name)
    try:
        ja.write_index()
    finally:
        ja.JA = JA


def main():
    root = sys.argv[1]
    kinds = set(sys.argv[2:]) or {"text", "scripts", "tables", "ui", "img", "movie", "font", "subs"}
    from romio import Rom
    rom = Rom(root)
    assert rom.origin("script_text.mrg") == "patch" and os.path.exists(os.path.join(root, "mods/japan", LAYER, "romfs/script_text.mrg"))
    os.makedirs(ZH, exist_ok=True)
    lines = None
    if kinds & {"text", "scripts"}:
        lines = build_text(rom) if "text" in kinds else ja.lines_of(rom)
    if "scripts" in kinds:
        build_scripts(rom, lines)
    if "tables" in kinds:
        build_tables(root, rom)
    if "ui" in kinds:
        build_ui(root, rom)
    if "img" in kinds:
        build_img(root, rom)
    if "movie" in kinds:
        build_movies(root, rom)
    if "subs" in kinds:
        build_subs()
    if "font" in kinds:
        build_fonts(rom)            # (last: the faces keep the letters the files above use)
    write_index()


if __name__ == "__main__":
    main()
