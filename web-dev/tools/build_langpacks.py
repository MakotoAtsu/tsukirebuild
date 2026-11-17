#!/usr/bin/env python3
"""build_langpacks.py [ja] [zh] [--check]: a language folder's small files in packs, for the Android and desktop apps.

The apps download a language's files when it is first chosen, and an update's files, one file at a time (web-dev/desktop/updater.js, the Android
Updates.java), each request about 150 ms before its first byte. Japanese has 456 files, Chinese 137: most of the time went in asking. Here every
file of a language folder the apps take in a pack (app_manifest.lang_loose: all but the folder's list, its movies and its faces) is put end to end
into packs of about TARGET bytes, and the apps' lists name the packs instead (app_manifest.lang_lists). The page reads a file out of its pack in the
apps (app/js/lang.js loadPacks); the site keeps serving every file by itself, as a browser asks for each picture only when a scene needs it.

    web/assets/<lang>/pack/<lang>-<hash>.pack   files end to end, as they are; the name carries a hash of the content, so a pack never changes
    web/assets/<lang>/pack/index.json            {"version": 1, "packs": [[pack name, [file, bytes, file, bytes, ...]], ...]}: a file's place in
                                                 its pack is the sum of the sizes before it; files are named under the language folder

Run it after build_ja.py / build_zh.py (the packs are what the folder's list names now). --check: the packs on disk hold exactly the folder's files.
Standard library only.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import app_manifest  # noqa: E402  (lang_loose: what stays loose, the same rule the apps' lists are made by)

ASSETS = os.path.normpath(os.path.join(HERE, "..", "..", "web", "assets"))
TARGET = 3_000_000          # bytes a pack is filled to; a file that would take it past this starts the next
VERSION = 1


def packed_files(lang):
    """The files of the folder that go in packs, in the order they are packed (by name: a scene's pictures sit near each other)."""
    listed = json.load(open(os.path.join(ASSETS, lang, "index.json")))["files"]
    return sorted(f for f in listed if not app_manifest.lang_loose(f))


def plan(lang):
    """[[file, ...], ...]: the packs, each about TARGET bytes."""
    packs, cur, size = [], [], 0
    for f in packed_files(lang):
        s = os.path.getsize(os.path.join(ASSETS, lang, f))
        if cur and size + s > TARGET:
            packs.append(cur)
            cur, size = [], 0
        cur.append(f)
        size += s
    if cur:
        packs.append(cur)
    return packs


def build(lang):
    folder = os.path.join(ASSETS, lang, "pack")
    os.makedirs(folder, exist_ok=True)
    index, keep = [], {"index.json"}
    for files in plan(lang):
        data = b"".join(open(os.path.join(ASSETS, lang, f), "rb").read() for f in files)
        name = f"{lang}-{hashlib.md5(data).hexdigest()[:10]}.pack"
        path = os.path.join(folder, name)
        if not (os.path.exists(path) and os.path.getsize(path) == len(data)):
            with open(path + ".tmp", "wb") as out:
                out.write(data)
            os.replace(path + ".tmp", path)
        keep.add(name)
        entry = []
        for f in files:
            entry += [f, os.path.getsize(os.path.join(ASSETS, lang, f))]
        index.append([name, entry])
    with open(os.path.join(folder, "index.json"), "w") as out:
        json.dump({"version": VERSION, "packs": index}, out, separators=(",", ":"))
    gone = [n for n in os.listdir(folder) if n not in keep]
    for n in gone:
        os.remove(os.path.join(folder, n))
    total = sum(os.path.getsize(os.path.join(folder, n)) for n, _ in index)
    print(f"{lang}: {sum(len(e) // 2 for _, e in index)} files in {len(index)} packs, {total / 1e6:.1f} MB; {len(gone)} old packs removed")


def check(lang):
    """Problems with the folder's packs: [] when they hold exactly the files the folder's list says go in packs, byte for byte."""
    folder = os.path.join(ASSETS, lang, "pack")
    try:
        index = json.load(open(os.path.join(folder, "index.json")))
    except OSError:
        return [f"{lang}: no packs (run build_langpacks.py {lang})"]
    problems, seen = [], []
    for name, entry in index["packs"]:
        try:
            data = open(os.path.join(folder, name), "rb").read()
        except OSError:
            problems.append(f"{lang}: pack {name} missing")
            continue
        if f"{lang}-{hashlib.md5(data).hexdigest()[:10]}.pack" != name:
            problems.append(f"{lang}: pack {name} is not what its name says")
        at = 0
        for k in range(0, len(entry), 2):
            f, size = entry[k], entry[k + 1]
            seen.append(f)
            own = os.path.join(ASSETS, lang, f)
            if not os.path.exists(own) or open(own, "rb").read() != data[at:at + size]:
                problems.append(f"{lang}: {f} in {name} is not the folder's file")
            at += size
        if at != len(data):
            problems.append(f"{lang}: pack {name} has {len(data) - at} bytes no file names")
    want = packed_files(lang)
    if sorted(seen) != want:
        problems.append(f"{lang}: the packs hold {len(seen)} files, the folder's list {len(want)} to pack (run build_langpacks.py {lang})")
    stray = [n for n in os.listdir(folder) if n != "index.json" and n not in {p for p, _ in index["packs"]}]
    if stray:
        problems.append(f"{lang}: files in pack/ no index names: {stray[:4]}")
    return problems


def main(argv):
    langs = [a for a in argv if not a.startswith("--")] or [l for l in app_manifest.PACKED if os.path.isdir(os.path.join(ASSETS, l))]
    if "--check" in argv:
        problems = [p for lang in langs for p in check(lang)]
        print("\n".join(problems) if problems else f"packs match their folders: {', '.join(langs)}")
        return 1 if problems else 0
    for lang in langs:
        build(lang)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
