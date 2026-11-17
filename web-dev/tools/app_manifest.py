#!/usr/bin/env python3
"""app_manifest.py --bundle OUT: what the Android and desktop apps' updates are worked out from.

The apps carry everything they play and bring themselves up to date from the site (web/app/js/update.js): they download only the files the
site has that they were not built with. For that each side says what it holds, in the same form:

    {"format": 1, "time": <when it was made, seconds>, "shell": <the app the page needs, apphost.js SHELL>, "version": "<12 hex>",
     "app": [["js/main.js", <size>, "<sha256>"], ...],            every file of web/app
     "assets": {"md5": "<of the list>", "size": <of the list>, "path": "update/assets-<12 hex>.txt"},
     "langs": {"ja": {"md5", "size", "path": "update/lang-ja-<12 hex>.txt"}, "zh": {...}}}           the site's only

and the list is the apps' part of the game's files, "md5 size path" a line as web-dev/assets-manifest.txt has them: everything but
the languages' own folders, web/assets/ja and zh, and the loose voices and sound effects (the packs carry them). The apps are built in
English; Japanese and Chinese are downloaded when their plate is first chosen (update.js langPlan), from one list a folder ("langs":
Chinese is laid over Japanese, so it needs both).

  the site   tools/cloudflare/deploy.py stores update/app.json and the lists with every deployment (site_description, below), from
             the repository's web/app and web-dev/assets-manifest.txt
  an app     this script, run by web-dev/android/build_apk.sh and web-dev/desktop/build.sh, writes OUT/bundled.json and
             OUT/bundled-assets.txt from the files being packed, web/app and web/assets as they are on this computer

Needs nothing but Python's standard library.
"""
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FORMAT = 1


def language_table(path=ROOT / "web" / "app" / "js" / "languages.js"):
    """The page's table of languages (web/app/js/languages.js LANGUAGE_TABLE), the JSON between its two marks. No other list stands in for it."""
    m = re.search(r"/\* languages: \*/(.*?)/\* :languages \*/", Path(path).read_text(encoding="utf-8"), re.S)
    if not m:
        raise SystemExit(f"{path}: no language table between /* languages: */ and /* :languages */")
    return json.loads(m.group(1))


def _folders(table, key):
    out = []
    for row in table:
        if not row.get("coming") and row.get(key):
            out += [f for f in row["layers"] if f not in out]
    return tuple(out)


LANGUAGES = language_table()
# What the apps are built without: the folders of the languages they download when first chosen (the table's `download`: Japanese, Chinese,
# Portuguese; the user, 2026-11-17, of Portuguese: "make sure only people who select that download it"), and the loose voices and sound effects.
LANG_DIRS = _folders(LANGUAGES, "download")
# The folders with pictures, movies and faces of their own (the table's `packs`: Japanese's and Chinese's): they come to the apps in packs
# (build_langpacks.py), and the deployment keeps their media 30 days (tools/cloudflare/deploy.py MEDIA, so the order here is its cache rule's).
# Portuguese is two files of lines, which a pack would only copy.
PACKED = _folders(LANGUAGES, "packs")
WITHOUT = (*LANG_DIRS, "voice", "se")
# A language folder's small files come to the apps in packs (web-dev/tools/build_langpacks.py, under <folder>/pack): the apps download one file at a
# time, about 150 ms a request, so Japanese's 456 files cost a minute in requests alone. What stays loose for the apps: the folder's list (an app holds a
# language by it: update.js heldDirs), the packs and their index, and the large files (movies, faces), which gain nothing from a pack. The site keeps
# every file loose (a browser asks for each picture as a scene needs it), so a folder with packs has its small files twice on the site.
LANG_LOOSE = ("pack/", "movie/", "fonts/")


def lang_loose(rel):
    """Whether a file of a language folder (rel: under the folder) goes to the apps as itself, not in a pack."""
    return rel == "index.json" or rel.startswith(LANG_LOOSE)


def shell(app=ROOT / "web/app"):
    """The app the page needs, as apphost.js says it."""
    found = re.search(r"^export const SHELL = (\d+);", (app / "js/apphost.js").read_text(encoding="utf-8"), re.M)
    if not found:
        raise RuntimeError("web/app/js/apphost.js no longer says which app the page needs (export const SHELL = n;)")
    return int(found.group(1))


def app_version(root, files):
    """The name of a set of app files (paths under `root`): the folder the site serves them from, v/<this>/. index.html is not part of it."""
    digest = hashlib.sha256()
    for path in sorted(files):
        if path.name != "index.html":
            digest.update(path.as_posix().encode() + b"\0" + (root / path).read_bytes() + b"\0")
    return digest.hexdigest()[:12]


def app_entries(root, files):
    return [[path.as_posix(), (root / path).stat().st_size, hashlib.sha256((root / path).read_bytes()).hexdigest()] for path in sorted(files, key=lambda p: p.as_posix())]


def apps_list(lines):
    """The apps' part of a list of the game's files ("md5 size path" lines, or (md5, size, path)), as the text both sides compare."""
    rows = []
    for line in lines:
        md5, size, path = line.split(" ", 2) if isinstance(line, str) else line
        if path.split("/")[0] not in WITHOUT:
            rows.append((path, f"{md5} {int(size)} {path}"))
    return ("\n".join(row for _, row in sorted(rows)) + "\n").encode()


def lang_lists(lines):
    """Each language folder's files, as a list in the apps' form ("md5 size path" lines, paths under web/assets): {folder: bytes}. A folder that has
    packs (<folder>/pack/index.json) lists its packs and its loose files (lang_loose) in place of the files the packs carry."""
    rows = {folder: [] for folder in LANG_DIRS}
    for line in lines:
        md5, size, path = line.split(" ", 2) if isinstance(line, str) else line
        if path.split("/")[0] in rows:
            rows[path.split("/")[0]].append((path, f"{md5} {int(size)} {path}"))
    out = {}
    for folder, found in rows.items():
        if any(path == f"{folder}/pack/index.json" for path, _ in found):
            found = [(path, row) for path, row in found if lang_loose(path[len(folder) + 1:])]
        if found:
            out[folder] = ("\n".join(row for _, row in sorted(found)) + "\n").encode()
    return out


def listed(listing, path=None):
    """What a description says of a list: its MD5 and size, and where the site has it."""
    named = {"md5": hashlib.md5(listing).hexdigest(), "size": len(listing)}
    if path:
        named["path"] = path
    return named


def describe(root, files, listing, made=None, path=None):
    """The description of the app files `files` under `root` and the list `listing` (bytes, from apps_list)."""
    return {"format": FORMAT, "time": int(time.time() if made is None else made), "shell": shell(root), "version": app_version(root, files),
            "app": app_entries(root, files), "assets": listed(listing, path)}


def site_description(root, files, manifest, made=None):
    """For a deployment: (update/app.json's bytes, [(key, bytes)] of the lists it names: the apps' list, then each language folder's).
    files: web/app's files, as paths under root."""
    lines = [line for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
    listing = apps_list(lines)
    lists = [(f"update/assets-{hashlib.md5(listing).hexdigest()[:12]}.txt", listing)]
    description = describe(root, files, listing, made, lists[0][0])
    description["langs"] = {}
    for folder, found in lang_lists(lines).items():
        lists.append((f"update/lang-{folder}-{hashlib.md5(found).hexdigest()[:12]}.txt", found))
        description["langs"][folder] = listed(found, lists[-1][0])
    return json.dumps(description, separators=(",", ":")).encode(), lists


def md5_of(path):
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def visible(folder):
    """Every file under `folder` that is not hidden, as paths under it (links followed, as the app builds follow them)."""
    found = []
    for here, folders, names in os.walk(folder, followlinks=True):
        folders[:] = [name for name in folders if not name.startswith(".")]
        found += [(Path(here) / name).relative_to(folder) for name in names if not name.startswith(".")]
    return sorted(found)


def bundle(out, app=ROOT / "web/app", assets=ROOT / "web/assets"):
    """OUT/bundled.json and OUT/bundled-assets.txt: what an app built now from `app` and `assets` holds."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    listing = apps_list((md5_of(assets / path), (assets / path).stat().st_size, path.as_posix()) for path in visible(assets) if path.parts[0] not in WITHOUT)
    description = describe(app, visible(app), listing)
    (out / "bundled-assets.txt").write_bytes(listing)
    (out / "bundled.json").write_text(json.dumps(description, separators=(",", ":")), encoding="utf-8")
    count = listing.count(b"\n")
    print(f"bundled.json: version {description['version']}, {len(description['app'])} app files, {count} of the game's files")
    return description


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "--bundle":
        raise SystemExit(__doc__)
    bundle(sys.argv[2])
