#!/usr/bin/env python3
"""build_aniplex.py <repo root> [script_text.mrg]: the official English translation (Aniplex, the global edition) -> web/assets/aniplex.

English has two translations to choose from on PLAY (home.js): the Tsukihimates fan translation, what the port's files are made from, and the
official one of the global edition (TSUKIHIME -A piece of blue glass moon-, program 010057A01E4D4000). The official one is laid over the fan one
like a language folder (lang.js LAYERS): only its lines differ. The scripts, pictures, menus and sounds stay the port's.

  aniplex/text.json    the official lines, numbered as the port numbers them
  aniplex/index.json   the list, which app/js/lang.js reads

Where the lines come from: script_text.mrg of the global edition's RomFS (default: ../tsukihime-global-script/raw/script_text.mrg, taken from the
dump with that folder's README). It holds five language slots, each an offset table and then the lines (CRLF, padded with 0xFF): Japanese, English,
Simplified and Traditional Chinese, and an empty one.

Numbering: the global edition keeps the original's line numbers. Its Japanese slot has the port's Japanese lines (ja/text.json) at the same numbers
for all but 134 (lines the global edition reworded), and its scripts name the same numbers in the same order where the two differ (05_00_ARC05_1B
around 8761); its ten extra lines at the end are named only by its own scripts. So line n of the port is line n of the official text.

What is rewritten so that the port's text box reads it as it reads the fan translation's (textbox.js parseMarkup):
  @i ... @r     italics: the letters between become U+E000 plus their code, the fan translation's italics (tags inside stay as they are)
  @g            dropped: the official text marks its italics itself, so the second face is not slanted (the port slants it only for the fan text)
  @o            dropped (one line ends "@r@o": no such mark in the engine's table, nothing on screen)
  [heart] [heart2] [star2] [onpu]   the game font's marks: ♥ ♡ ☆ ♪, as the fan translation writes them
Everything else (^, @t, @b, @k, <base|ruby>, [ber00] [zap00], ■, ―) is the original's markup, which the port reads already.
"""
import json
import os
import re
import struct
import sys

SLOTS = ("japanese", "english", "chinese_simplified", "chinese_traditional", "empty")
MARKS = {"[heart]": "♥", "[heart2]": "♡", "[star2]": "☆", "[onpu]": "♪"}
TAG = re.compile(r"\[[a-z]+\d*\]")


def mrgd(buf):
    """mrgd00: u16 count at +6, then 8 bytes per entry (u16 sector, u16 byte offset, u16 sectors, u16 size): [(start, end)]."""
    if buf[:6] != b"mrgd00":
        raise ValueError("not an mrgd00 archive")
    n = struct.unpack_from("<H", buf, 6)[0]
    hdr = 8 + 8 * n
    starts = [hdr + so * 0x800 + bo for so, bo, _, _ in (struct.unpack_from("<HHHH", buf, 8 + 8 * i) for i in range(n))]
    return list(zip(starts, starts[1:] + [len(buf)]))


def slots(buf):
    """{slot name: [lines]} of script_text.mrg."""
    ents = mrgd(buf)
    out = {}
    for k in range(0, len(ents) - 1, 2):
        s, e = ents[k + 1]
        out[SLOTS[k // 2]] = buf[s:e].rstrip(b"\xff").decode("utf-8").split("\r\n")
    return out


def italic(s):
    """ASCII letters as the fan translation's italics (U+E000 + code), tags left whole."""
    out, i = [], 0
    for m in TAG.finditer(s):
        out.append(_slant(s[i:m.start()]))
        out.append(m.group(0))
        i = m.end()
    out.append(_slant(s[i:]))
    return "".join(out)


def _slant(s):
    return "".join(chr(0xE000 + ord(c)) if 0x20 <= ord(c) <= 0x7E else c for c in s)


def convert(line):
    if line.count("@i") != line.count("@r"):
        raise ValueError(f"unbalanced italics: {line.count('@i')} @i, {line.count('@r')} @r")
    line = re.sub(r"@i(.*?)@r", lambda m: italic(m.group(1)), line)
    line = line.replace("@g", "").replace("@o", "")
    for tag, ch in MARKS.items():
        line = line.replace(tag, ch)
    return line


def main(argv):
    root = os.path.abspath(argv[1] if len(argv) > 1 else ".")
    src = argv[2] if len(argv) > 2 else os.path.join(root, "..", "tsukihime-global-script", "raw", "script_text.mrg")
    assets = os.path.join(root, "web", "assets")
    text = slots(open(src, "rb").read())
    en, jp = text["english"], text["japanese"]
    port = json.load(open(os.path.join(assets, "text.json"), encoding="utf-8"))
    port_ja = [l.replace("", "") for l in json.load(open(os.path.join(assets, "ja", "text.json"), encoding="utf-8"))]
    if len(en) < len(port):
        raise SystemExit(f"the official text has {len(en)} lines, fewer than the port's {len(port)}")
    same = sum(a == b for a, b in zip(port_ja, jp))
    if same < len(port_ja) - 200:
        raise SystemExit(f"only {same} of {len(port_ja)} Japanese lines match at the same numbers: not the numbering this was made for")
    out = [convert(l) for l in en[:len(port)]]
    left = sorted({m for l in out for m in re.findall(r"@[a-z]|\[[a-z]+\d*\]", l)} - {"@t", "@b", "@k", "[ber00]", "[zap00]"})
    if left:
        raise SystemExit(f"marks the port does not read: {left}")
    folder = os.path.join(assets, "aniplex")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "text.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(folder, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"files": ["text.json"]}, f, separators=(",", ":"))
    filled = sum(1 for l in out if l.strip())
    print(f"aniplex/text.json: {len(out)} lines ({filled} with text; Japanese the same at {same} of {len(port_ja)} numbers)")


if __name__ == "__main__":
    main(sys.argv)
