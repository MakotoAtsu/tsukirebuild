#!/usr/bin/env python3
"""run_rows.py <text.json> <work dir> <runbatch.sh> <out rows.json> [--check rows.json]: every line of a text laid out by the original engine -> a rows
table (make_rows.py). How zh_rows.json was made (2026-11-14), with the steps that made ja_rows.json on 2026-11-11 written down as one tool:

  1. every line by itself (all.tsv -> all.out);
  2. the messages that are not one line by itself and not glued (text an MSAD adds, lines joined by ^: pass1.tsv -> pass1.out), laid out whole;
  3. the glued ones (@x), in passes, each laid out from where the row before it ended (+2 px, what the window passes): that needs the layout of the
     message before, so a glued message waits for the pass after its predecessor's (pass2.tsv ...);
  4. make_rows.py turns the buffers into the table.

runbatch.sh <tsv> <out> runs the hooked original engine on a batch (README.md: a build of the unpatched main with hook_015 / hook_016, in a sandbox
whose mods folder has the language's romfs as its one layer: the update's for Japanese; for Chinese the update's with the patch's files, its faces among
them, since the engine measures a row through the font). The messages (web-dev/data/rows_units.json) are the scripts', which are the original's in both.
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from rows_lib import engine_items

UNITS = os.path.join(HERE, "../../data/rows_units.json")


def body(arg):
    m = re.search(r"@[en]", arg)
    return arg[:m.start()] if m else arg


def tsv_safe(s):
    assert "\t" not in s and "\n" not in s, s
    return s


def read_out(path):
    res = {}
    for line in open(path, encoding="utf-8"):
        if line.startswith("#") or not line.strip():
            continue
        p = line.rstrip("\n").split("\t")
        res[p[0]] = bytes.fromhex(p[3]).decode("utf-8")
    return res


def run(runbatch, tsv, out):
    if os.path.exists(out) and os.path.getmtime(out) > os.path.getmtime(tsv):
        return read_out(out)
    subprocess.check_call([runbatch, tsv, out])
    return read_out(out)


def main():
    a = sys.argv[1:]
    check = []
    if "--check" in a:
        i = a.index("--check")
        check = a[i:i + 2]
        a = a[:i] + a[i + 2:]
    text_path, work, runbatch, out_path = a
    os.makedirs(work, exist_ok=True)
    T = json.load(open(text_path))
    U = json.load(open(UNITS))
    units = U["units"]

    def unit_text(u):
        return "".join(re.sub(r"\$(\d+)", lambda m: T[int(m[1])], body(arg).replace("@x", "").replace("@k", "")) for _, arg in u["ops"])

    # 1. every line by itself
    tsv = os.path.join(work, "all.tsv")
    if not os.path.exists(tsv):
        open(tsv, "w", encoding="utf-8").write("".join(f"{i}\t{tsv_safe(t)}\n" for i, t in enumerate(T)))
    alone = run(runbatch, tsv, os.path.join(work, "all.out"))
    print("alone:", len(alone), "of", len(T), flush=True)
    assert len(alone) == len(T), "the batch did not finish: give the run more time (SECS)"

    # 2. messages laid out whole
    special = U["special"]
    tsv = os.path.join(work, "pass1.tsv")
    if not os.path.exists(tsv):
        open(tsv, "w", encoding="utf-8").write("".join(f"u{k}\t{tsv_safe(unit_text(units[k]))}\n" for k in special if not units[k]["glued"]))
    res = {int(k[1:]): v for k, v in run(runbatch, tsv, os.path.join(work, "pass1.out")).items()}
    print("pass 1:", len(res), flush=True)

    # 3. glued messages, each from where the one before it ended
    gxs = {}

    def unit_buf(k):
        if k in res:
            return res[k]
        u = units[k]
        ids = re.findall(r"\$(\d+)", u["ops"][0][1])
        if not u["glued"] and len(u["ops"]) == 1 and len(ids) == 1:
            return alone[str(int(ids[0]))]
        return None

    def last_row_px(buf, k=None):
        items, breaks, _ = engine_items(buf)
        st = breaks[-1] if breaks else 0
        w = sum(24.8 if ord(c) < 0x100 else 49.6 for c, _ in items[st:])      # a narrow letter is half a cell
        if not breaks and k in gxs:
            w += gxs[k] - 264.0                                                # a glued line still on the row it was glued to
        return w

    todo = [k for k in special if units[k]["glued"]]
    n = 2
    while todo:
        lines, rest = [], []
        for k in todo:
            u = units[k]
            pb = unit_buf(u["prev"]) if u["prev"] is not None else None
            if u["prev"] is None:
                gx = 264.0
            elif pb is None:
                rest.append(k)
                continue
            else:
                gx = 264.0 + last_row_px(pb, u["prev"]) + 2.0
            gxs[k] = gx
            lines.append(f"u{k}\t@x{tsv_safe(unit_text(u))}\t{gx:.3f}\n")
        tsv = os.path.join(work, f"pass{n}.tsv")
        open(tsv, "w", encoding="utf-8").write("".join(lines))
        got = run(runbatch, tsv, os.path.join(work, f"pass{n}.out"))
        res.update({int(k[1:]): v for k, v in got.items()})
        print(f"pass {n}:", len(lines), "laid out,", len(rest), "wait for the next", flush=True)
        if len(rest) == len(todo):
            raise SystemExit(f"stuck: {rest[:5]}")
        todo, n = rest, n + 1
    uo = os.path.join(work, "units_out.json")
    json.dump({"buf": {str(k): v for k, v in res.items()}, "gx": {str(k): v for k, v in gxs.items()}}, open(uo, "w"), ensure_ascii=False)

    # 4. the table
    subprocess.check_call([sys.executable, os.path.join(HERE, "make_rows.py"), text_path, os.path.join(work, "all.out"), UNITS, uo, out_path] + check)


if __name__ == "__main__":
    main()
