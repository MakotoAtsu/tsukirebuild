#!/usr/bin/env python3
"""make_rows.py <text.json> <all.out> <units.json> <units_out.json> <out.json> [--check <rows.json>]: the engine's layouts -> a rows table.

The table build_ja.py / build_zh.py read (web-dev/data/ja_rows.json, zh_rows.json):
  lines: {line id: [break, ...]}           where the engine starts a row by itself in the line laid out alone (only lines it breaks). A break is the index
                                            of the letter it comes before (build_ja.raw_tokens: ruby letters, a [tag] one letter, ^ and @ codes none), or
                                            [index, n] inside a ruby group, the first n letters of its reading staying on the row above.
  ops:   {script: {op: [[id, breaks(, 1)], ...]}}   messages laid out together with others (text an MSAD adds, lines joined by ^, glued @x lines), where
                                            a line's rows are not its rows alone; every line the command names, in order; a third item 1: the line starts
                                            a row of its own (a glued line that did not fit the row before).

Inputs, from the runs README.md describes:
  all.out          every line laid out alone: "id<TAB>?<TAB>?<TAB>hex of the laid-out buffer" (NX_LAYOUT_OUT; lines starting # are notes)
  units.json       {"units": [{script, ops: [[op, arg], ...], glued, prev}], "special": [unit index, ...]}: the messages of all scripts as the engine
                   lays them out together (the scripts are the original's, so this is the same for Japanese and Chinese)
  units_out.json   {"buf": {unit index: laid-out buffer}}: the special units laid out whole (pass1, then glue_pass.py for the glued ones)
--check compares the result with an existing table (how this was checked against ja_rows.json, which was made before this file).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rows_lib import raw_tokens, engine_items, same

ROW = ""


def body(arg):
    m = re.search(r"@[en]", arg)
    return arg[:m.start()] if m else arg


def breaks_of(text, items, breaks, egroups, skip=0):
    """The engine's own breaks inside `text`, whose letters start at items[skip]: (the breaks, how many of the items are the text's).

    The text's letters and the engine's are lined up one to one, but for a plain space where the engine ended a row, which it leaves out of its buffer
    (UAX #14: a space at a break is not drawn). Japanese has none; the Chinese patch's lines use spaces as pauses. A break there goes after the space,
    so the space stays at the end of the row above, where it shows nothing, and the next row starts with the next letter as the engine's does."""
    if not text:
        return [], 0
    toks, forced, groups = raw_tokens(text)
    at, j = [], skip                      # each letter's item, None for a space the engine left out
    for t in toks:
        if j < len(items) and same(t["c"], items[j][0]):
            at.append(j)
            j += 1
        elif t["c"] == " ":
            at.append(None)
        else:
            raise ValueError("letter %r / %r at %d" % (t["c"], items[j][0] if j < len(items) else None, len(at)))
    # (in a run of spaces the one left out is the one at the break, not the run's last, which is where lining up in order puts it: moved back there)
    for k in range(len(at)):
        if at[k] is None:
            m = k - 1
            while m >= 0 and toks[m]["c"] == " " and at[m] is not None and at[m] not in breaks:
                m -= 1
            if m >= 0 and toks[m]["c"] == " " and at[m] is not None and at[m] in breaks:
                at[m + 1:k + 1] = at[m:k]
                at[m] = None
    if any(a is None for a in at):
        for k, a in enumerate(at):
            if a is None and (k == 0 or at[k - 1] is not None):
                # a run of spaces left out (the Chinese patch v3.0 has runs of four before an opening bracket, of which the engine leaves out the
                # last two where it ends the row): fine where the letter after the run starts a row, or nothing comes after it
                e = k
                while e < len(at) and at[e] is None:
                    e += 1
                if e < len(at) and at[e] not in breaks:
                    raise ValueError("a space left out with no break after it, at %d" % k)
    letter = {}
    for k, a in enumerate(at):
        if a is not None:
            letter.setdefault(a, k)
    out = []
    for b in sorted(breaks):
        if not skip < b < j:
            continue
        k = letter[b]
        if k in forced or k == 0:
            continue
        g = toks[k]["ruby"]
        if g is not None and toks[k - 1]["ruby"] == g:
            grp = groups[g]
            first = at[grp["first"]]
            eg = [e for e in egroups if first <= e["first"] < first + grp["n"]]
            if len(eg) < 2:
                raise ValueError("ruby split not found")
            out.append([k, len(eg[0]["read"])])
        else:
            out.append(k)
    return out, j - skip


def read_out(path):
    res = {}
    for line in open(path, encoding="utf-8"):
        if line.startswith("#") or not line.strip():
            continue
        p = line.rstrip("\n").split("\t")
        res[p[0]] = bytes.fromhex(p[3]).decode("utf-8")
    return res


def main():
    a = sys.argv[1:]
    check = None
    if "--check" in a:
        i = a.index("--check")
        check = json.load(open(a[i + 1]))
        a = a[:i] + a[i + 2:]
    text_path, all_out, units_path, units_out, out_path = a
    T = json.load(open(text_path))
    alone = read_out(all_out)
    lines, bad = {}, []
    for i, t in enumerate(T):
        buf = alone.get(str(i))
        if buf is None:
            bad.append((i, "not laid out"))
            continue
        try:
            items, brk, eg = engine_items(buf) if t else ([], [], [])
            b, _ = breaks_of(t, items, brk, eg)
        except Exception as e:
            bad.append((i, str(e)))
            continue
        if b:
            lines[str(i)] = b
    U = json.load(open(units_path))
    units = U["units"]
    bufs = json.load(open(units_out))["buf"]
    ops, ubad = {}, []
    for k in U["special"]:
        u = units[k]
        buf = bufs.get(str(k))
        if buf is None:
            ubad.append((k, "not laid out"))
            continue
        try:
            items, brk, eg = engine_items(buf)
            new_row = buf[:1] == "\n"
            skip = 0
            first = True
            joined = False                      # a ^ just before: the row break there is the script's, not the engine's
            for op, arg in u["ops"]:
                ents = []
                for piece in re.split(r"(\$\d+)", body(arg).replace("@x", "").replace("@k", "")):
                    if not re.fullmatch(r"\$\d+", piece):
                        skip += len(raw_tokens(piece)[0])          # (literal letters in a message: none in the game's scripts)
                        joined = joined or "^" in piece
                        continue
                    i = int(piece[1:])
                    b, n = breaks_of(T[i], items, brk, eg, skip)
                    # a line that starts a row of its own: a glued line that did not fit the row before, or a line added to a message whose row the
                    # engine ends just before it
                    own_row = (first and new_row) or (not first and not joined and skip in brk)
                    ents.append([i, b, 1] if own_row else [i, b])
                    skip += n
                    first, joined = False, False
                if any(len(e) > 2 or e[1] != lines.get(str(e[0]), []) for e in ents):
                    ops.setdefault(script_name(U, u), {})[str(op_in(u, op, ents))] = ents
            if skip != len(items):
                raise ValueError("unit has %d letters, the buffer %d" % (skip, len(items)))
        except Exception as e:
            ubad.append((k, str(e)))
    about = (check or {}).get("about") or "Where the original engine breaks rows: its own layout of every line (native 0xbf0f8), read from a build of the unpatched executable. See web-dev/tools/ja_rows/README.md."
    window = (check or {}).get("window") or {"x": 264.0, "y": 156.696442, "width": 1392.0, "letter": 45.6, "gap": 4.0, "row": 81.0, "cells": 28}
    out = {"about": about, "window": window, "lines": lines, "ops": ops}
    json.dump(out, open(out_path, "w"), ensure_ascii=False, separators=(",", ":"))
    print("lines with rows:", len(lines), "of", len(T), "| not read:", len(bad), bad[:5])
    print("ops:", sum(len(v) for v in ops.values()), "in", len(ops), "scripts | units not read:", len(ubad), ubad[:5])
    if check:
        dl = [k for k in set(lines) | set(check["lines"]) if lines.get(k) != check["lines"].get(k)]
        co = {(s, o): v for s, d in check["ops"].items() for o, v in d.items()}
        mo = {(s, o): v for s, d in ops.items() for o, v in d.items()}
        do = [k for k in set(co) | set(mo) if co.get(k) != mo.get(k)]
        print("check: lines differing", len(dl), sorted(dl, key=int)[:10], "| ops differing", len(do), sorted(do)[:10])
        for k in sorted(do)[:5]:
            print("   ", k, "made", mo.get(k), "table", co.get(k))


_scripts = {}


def op_in(u, op, ents):
    """The command's number in the script as build_ja.py parses it (mended: build_ja.mend), found by the lines it names, nearest the number the units
    were listed with (10_01_CIEL10_4_3 was listed before the mend, which moves its later commands by one)."""
    i = u["script"]
    if i not in _scripts:
        here = os.path.dirname(os.path.abspath(__file__))
        ja = os.path.join(here, "../../../web/assets/ja/scripts/%d.json" % i)
        path = ja if os.path.exists(ja) else os.path.join(here, "../../../web/assets/scripts/%d.json" % i)
        _scripts[i] = json.load(open(path))["ops"]
    ops = _scripts[i]
    ids = [e[0] for e in ents]
    named = [k for k, o in enumerate(ops) if o[0] in ("MSG", "MSAD") and [int(x) for x in re.findall(r"\$(\d+)", str(o[1]) if len(o) > 1 else "")] == ids]
    if not named:
        raise ValueError("no command names %s in script %d" % (ids, i))
    return min(named, key=lambda k: abs(k - op))


def script_name(U, u):
    names = U.get("names")
    if names:
        return names[u["script"]]
    return NAMES[u["script"]]


NAMES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../web/assets/scripts/index.json")))["names"]

if __name__ == "__main__":
    main()
