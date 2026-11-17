#!/usr/bin/env python3
"""build_layer.py <code> <translations folder> [--root R] [--out DIR] [--base text.json] [--map line_map.json] [--check]
A translation laid over the English -> web/assets/<code>/text.json and index.json (the translator tool's Stage 1: web-dev/TRANSLATOR-TOOL-PLAN.md).

The port plays a text-only language as a layer over the English (web/app/js/lang.js LAYERS, the language's row in web/app/js/languages.js): the
English's scripts, pictures and menus, with the lines of its own text.json. That file has all 43,960 lines, numbered as the port numbers them:
the translation where it has a line, the English (Tsukihimates, web/assets/text.json) everywhere else, so an unfinished translation goes on in
English where it stops.

The translations folder is the translators' (their own repository: the plan's decision 1), one file a scene and an optional language.json:

  <folder>/<scene>.json     {"scene": "05_01_CIEL05_3", "lines": [{"id": 13002, "text": "...", "status": "draft", "note": "",
                             "from": {"lang": "ja", "hash": "<12 hex>"}}, ...]}
  <folder>/language.json    {"code": "pt", "breaks": "deepluna" | "none", ...}

  id       the port's line number (web-dev/data/line_map.json says where each is); a line is in the file of a scene that shows it
  text     the line as the port is to show it: the text box's markup (textbox.js parseMarkup: italic letters, <base|reading>, @g @t @b @k,
           [ber00] [zap00], ^ for a row break of the translator's own)
  status   empty (not translated: the English is shown), draft, reviewed or final
  from     what it was translated from: the language (ja, en, aniplex, ...) and the first 12 hex of the SHA-1 of that line as that language's
           text.json has it (line_hash), so a source line changed since shows as stale
  breaks   "deepluna": the lines carry deepLuna's 55-cell row breaks, as the Tsukihimates English and an imported deepLuna project do; the port
           takes out the ones that only wrapped a full row (app/js/reflow.js) and the text box wraps the rest. "none" (the default): the lines
           have no such breaks and the text box wraps them; a line break in a story line is then flagged, as reflow.js may take it out (^ is a
           row break the port keeps). The Q&A corners keep every row as written.

Checks, run before anything is written; an error stops the build (exit 1), a warning is reported:
  errors    no such folder, or none of its files a scene's; a file that is not of this shape, or not named after its scene; an unknown status; a line number outside the text, or given twice;
            a line filed under a scene that does not show it (with the line map); tabs, carriage returns, deepLuna codes (%{...}) or U+FFFD in a
            line; @ marks or [tags] the English never uses; a ruby <base|reading> not closed
  warnings  a choice with a row break (a choice is one row); a line translated from a source line that has changed since (stale); a line left as
            its source; a line break in a story line of a "none" language; a line the scripts never show
The page-fit checks (a page past 12 rows, a choice wider than the English's widest, a balloon row off its picture) need the text box: run the fit
page's runner on the built text.json (web-dev/fit/run-mcp.js, then fit_summary.py).
"""
import glob
import hashlib
import importlib.util
import json
import os
import re
import sys

STATUSES = ("empty", "draft", "reviewed", "final")
HERE = os.path.dirname(os.path.abspath(__file__))


def line_hash(text):
    """The first 12 hex of the SHA-1 of a line (UTF-8), as a translation's `from.hash` keeps it."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def load_line_map(root, path=None):
    """The line map: from `path` (line_map.json), else made now from the scripts (line_map.py), else None."""
    if path:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    if not os.path.isfile(os.path.join(root, "web", "assets", "scripts", "index.json")):
        return None
    spec = importlib.util.spec_from_file_location("line_map", os.path.join(HERE, "line_map.py"))
    lm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lm)
    return lm.build(root)


def read_folder(folder):
    """(language.json or {}, [(file name, its JSON or an error string)])."""
    meta = {}
    lang_file = os.path.join(folder, "language.json")
    if os.path.isfile(lang_file):
        with open(lang_file, encoding="utf-8") as f:
            meta = json.load(f)
    files = []
    for path in sorted(glob.glob(os.path.join(folder, "*.json"))):
        name = os.path.basename(path)
        if name == "language.json":
            continue
        try:
            with open(path, encoding="utf-8") as f:
                files.append((name, json.load(f)))
        except (OSError, ValueError) as e:
            files.append((name, f"not JSON: {e}"))
    return meta, files


def source_text(root, lang):
    """A language's text.json (the English's is web/assets/text.json), or None where it is not here."""
    path = os.path.join(root, "web", "assets", "text.json") if lang == "en" else os.path.join(root, "web", "assets", lang, "text.json")
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


MARK = re.compile(r"@[a-z][0-9]?")        # (ASCII digits: "@t２" is the @t mark and a letter)
TAG = re.compile(r"\[[a-z]+[0-9]*\]")


def check(code, folder, root, base, line_map=None):
    """Every check on a translations folder: (lines {id: text}, errors [str], warnings {kind: [str]}, counts)."""
    errors, warnings = [], {}
    if not os.path.isdir(folder):
        return {}, [f"{folder}: no such folder"], warnings, {s: 0 for s in STATUSES}, {}
    meta, files = read_folder(folder)
    if not files:
        errors.append(f"{folder}: no scene files (<scene>.json): nothing to build")
    warn = lambda kind, msg: warnings.setdefault(kind, []).append(msg)
    marks = {m for line in base for m in MARK.findall(line)} | {"@g", "@t", "@b", "@k"}
    tags = {t for line in base for t in TAG.findall(line)}
    breaks = meta.get("breaks", "none")
    if breaks not in ("none", "deepluna"):
        errors.append(f"language.json: breaks is {breaks!r}, not \"none\" or \"deepluna\"")
    scenes_of, choice, unnamed = {}, set(), set()
    if line_map:
        names = [s["name"] for s in line_map["scenes"]]
        for ln in line_map["lines"]:
            scenes_of[ln["id"]] = {names[a["s"]] for a in ln["at"]}
            if ln.get("choice"):
                choice.add(ln["id"])
        unnamed = set(line_map["unnamed"])
    sources, seen, lines = {}, {}, {}
    counts = {s: 0 for s in STATUSES}
    for name, data in files:
        if isinstance(data, str):
            errors.append(f"{name}: {data}")
            continue
        scene = data.get("scene") if isinstance(data, dict) else None
        if not isinstance(scene, str) or not isinstance(data.get("lines"), list):
            errors.append(f"{name}: not {{\"scene\": ..., \"lines\": [...]}}")
            continue
        if name != f"{scene}.json":
            errors.append(f"{name}: the file of scene {scene} is named {scene}.json")
        qa = scene.startswith("QA")
        for k, ln in enumerate(data["lines"]):
            where = f"{name} line {k}"
            if not isinstance(ln, dict) or not isinstance(ln.get("id"), int) or not isinstance(ln.get("text", ""), str):
                errors.append(f"{where}: not {{\"id\": <number>, \"text\": \"...\", \"status\": ...}}")
                continue
            i, text, status = ln["id"], ln.get("text", ""), ln.get("status", "draft" if ln.get("text") else "empty")
            where = f"{name} id {i}"
            if status not in STATUSES:
                errors.append(f"{where}: status {status!r} is none of {', '.join(STATUSES)}")
                continue
            if not 0 <= i < len(base):
                errors.append(f"{where}: no such line (the text has {len(base)})")
                continue
            if i in seen:
                errors.append(f"{where}: given again (first in {seen[i]})")
                continue
            seen[i] = name
            if line_map and i in scenes_of and scenes_of[i] and scene not in scenes_of[i]:
                errors.append(f"{where}: scene {scene} does not show this line ({', '.join(sorted(scenes_of[i]))} does)")
            if i in unnamed:
                warn("never shown", f"{where}: the scripts never show this line")
            if status == "empty" or not text:
                counts["empty"] += 1
                continue
            counts[status] += 1
            bad = [what for ch, what in (("\t", "a tab"), ("\r", "a carriage return"), ("%{", "a deepLuna code"), ("�", "U+FFFD")) if ch in text]
            if bad:
                errors.append(f"{where}: {', '.join(bad)}")
            odd = sorted({m for m in MARK.findall(text) if m not in marks and not re.fullmatch(r"@c[0-5]", m)} | {t for t in TAG.findall(text) if t not in tags})
            if odd:
                errors.append(f"{where}: marks the English never uses: {' '.join(odd)}")
            depth, ok = 0, True
            for piece in re.findall(r"[<>|]", text):
                if piece == "<":
                    depth += 1
                    ok = ok and depth == 1
                elif piece == ">":
                    depth -= 1
                    ok = ok and depth == 0
            if not ok or depth or any("|" not in r for r in re.findall(r"<[^<>]*>", text)):
                errors.append(f"{where}: a ruby <base|reading> not closed")
            if i in choice and ("\n" in text or "^" in text):
                warn("choice with a row break", f"{where}: a choice is one row")
            if breaks == "none" and not qa and "\n" in text:
                warn("line break in a story line", f"{where}: the port may take it out (reflow.js); ^ is a row break it keeps")
            src = ln.get("from") or {}
            if isinstance(src, dict) and src.get("lang"):
                if src["lang"] not in sources:
                    sources[src["lang"]] = source_text(root, src["lang"])
                st = sources[src["lang"]]
                if st is not None and i < len(st):
                    if src.get("hash") and src["hash"] != line_hash(st[i]):
                        warn("stale", f"{where}: its {src['lang']} line has changed since it was translated")
                    if text == st[i] and src["lang"] != "en":
                        warn("source left in", f"{where}: the same as its {src['lang']} line")
            lines[i] = text
    return lines, errors, warnings, counts, meta


def build(code, folder, root, out=None, base_path=None, map_path=None, write=True, say=print):
    """Check, then (unless write is False or a check fails) write <out>/text.json and index.json. Returns (errors, warnings, counts)."""
    base_path = base_path or os.path.join(root, "web", "assets", "text.json")
    with open(base_path, encoding="utf-8") as f:
        base = json.load(f)
    line_map = load_line_map(root, map_path)
    if line_map is None:
        say("no line map (no scripts here, no --map): lines are not checked against their scenes")
    lines, errors, warnings, counts, meta = check(code, folder, root, base, line_map)
    if meta.get("code") and meta["code"] != code:
        errors.append(f"language.json is for {meta['code']!r}, not {code!r}")
    for e in errors[:40]:
        say(f"error: {e}")
    if len(errors) > 40:
        say(f"... and {len(errors) - 40} errors more")
    for kind, found in warnings.items():
        say(f"warning: {kind}: {len(found)}" + "".join(f"\n  {w}" for w in found[:5]) + (f"\n  ... {len(found) - 5} more" if len(found) > 5 else ""))
    translated = sum(1 for i, t in lines.items() if t)
    say(f"{code}: {translated} lines translated ({', '.join(f'{k} {v}' for k, v in counts.items())}); {len(base) - translated} in English")
    if errors:
        say(f"{len(errors)} errors: nothing written")
        return errors, warnings, counts
    if write:
        out = out or os.path.join(root, "web", "assets", code)
        text = list(base)
        for i, t in lines.items():
            text[i] = t
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "text.json"), "w", encoding="utf-8") as f:
            json.dump(text, f, ensure_ascii=False, separators=(",", ":"))
        with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
            json.dump({"files": ["text.json"]}, f, separators=(",", ":"))
        say(f"{os.path.join(out, 'text.json')}: {len(text)} lines, {sum(a != b for a, b in zip(text, base))} differ from the English")
    return errors, warnings, counts


def main(argv):
    opts, args = {}, []
    it = iter(argv[1:])
    for a in it:
        if a in ("--root", "--out", "--base", "--map"):
            opts[a[2:]] = next(it, None)
        elif a == "--check":
            opts["check"] = True
        else:
            args.append(a)
    if len(args) != 2:
        raise SystemExit(__doc__)
    code, folder = args
    root = os.path.abspath(opts.get("root") or os.path.join(HERE, "..", ".."))
    if not re.fullmatch(r"[a-z]{2,3}", code):
        raise SystemExit(f"{code!r}: a language's code is two or three small letters")
    errors, _, _ = build(code, folder, root, opts.get("out"), opts.get("base"), opts.get("map"), write=not opts.get("check"))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main(sys.argv)
