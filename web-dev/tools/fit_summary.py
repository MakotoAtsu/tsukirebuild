#!/usr/bin/env python3
"""fit_summary.py [report ...]: the worst pages of the page-fit reports -> web-dev/audit/fit-summary.json (translator tool, Stage 0).

The reports are web-dev/audit/fit-<name>.json, written by the fit page's runner (web-dev/fit/run-mcp.js) through the Playwright
MCP, which saves them as one JSON string: each is first rewritten here as plain JSON. fit-en.json (the Tsukihimates English the
port is made from) is the yardstick for the others' choices.

What counts (web-dev/fit/fit.js says how each is measured):
  - a page of more than 12 rows: its last rows are below the screen (row 12 ends at 1,076 of 1,080);
  - a choice row wider than the widest English one, or choice rows pushed up over the page's text;
  - a balloon row (the Q&A corners) with a letter outside the balloon picture.
Each page is listed with its scene, the line ids on it, and whether any of those lines differs from the English (a page that is all
English in another text.json is the English's own). Numbers, names and line ids only: no text is written.
"""
import glob
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
AUDIT = os.path.join(ROOT, "web-dev", "audit")
ROWS = 12


def load_report(path):
    """A report as the MCP saved it (a JSON string) or as this tool rewrote it (an object); rewritten as plain JSON."""
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, str):
        data = json.loads(data)
        write_report(data, path)
    return data


def write_report(r, path):
    big = ("pages", "choices", "balloons")
    dump = lambda x: json.dumps(x, ensure_ascii=True, separators=(",", ":"))
    out = ["{"]
    for k, v in r.items():
        if k not in big:
            out.append(f"{json.dumps(k)}:{dump(v)},")
    for k in big:
        out.append(f"{json.dumps(k)}:[")
        out.append(",\n".join(dump(x) for x in r.get(k, [])))
        out.append("]" + ("," if k != big[-1] else ""))
    out.append("}")
    with open(path, "w") as f:
        f.write("\n".join(out) + "\n")


def main():
    paths = sys.argv[1:] or sorted(p for p in glob.glob(os.path.join(AUDIT, "fit-*.json")) if not p.endswith("fit-summary.json"))
    with open(os.path.join(ROOT, "web-dev", "data", "line_map.json")) as f:
        m = json.load(f)
    on_page = {}
    for ln in m["lines"]:
        for a in ln["at"]:
            if a["page"] is not None:
                on_page.setdefault(a["page"], set()).add(ln["id"])
    with open(os.path.join(ROOT, "web", "assets", "text.json")) as f:
        english = json.load(f)
    reports = {os.path.basename(p)[4:-5]: load_report(p) for p in paths}
    base = reports.get("en")
    widest_en = max((w for c in base["choices"] for w in c["widths"]), default=None) if base else None

    def where(n, texts=None):
        p = m["pages"][n]
        ids = sorted(on_page.get(n, ()))
        item = {"page": n, "scene": m["scenes"][p["s"]]["name"], "script": p["s"], "k": p["k"], "pc": p["a"], "ids": ids}
        if texts is not None:
            item["translated"] = any(texts[i] != english[i] for i in ids)
        return item

    out = {"about": "web-dev/tools/fit_summary.py: the worst pages of each fit report. Line ids and numbers only.", "widest_english_choice": widest_en, "reports": {}}
    for name, r in reports.items():
        if r.get("map") != m["source"]["sha1"]:
            print(f"warning: fit-{name}.json was made with another line map ({r.get('map')})")
        text_path = os.path.join(ROOT, "web", r["text"].lstrip("/"))
        texts = None
        if os.path.isfile(text_path) and name != "en":
            with open(text_path) as f:
                texts = json.load(f)
        balloon_pages = {b["page"] for b in r["balloons"]}
        pages = sorted(r["pages"], key=lambda p: (-p[1], -(p[2] or 0)))
        over = [p for p in pages if p[1] > ROWS and p[0] not in balloon_pages]
        worst = [p for p in pages if p[0] not in balloon_pages][:10]
        wide = sorted(({**where(c["page"], texts), "id": c["ids"][i], "width": w} for c in r["choices"] for i, w in enumerate(c["widths"])
                       if widest_en is not None and w > widest_en + 0.05), key=lambda x: -x["width"])
        tight = sorted((b for b in r["balloons"] if b["out"] > 0), key=lambda b: (b["room"] if b["room"] is not None else 0, -b["out"]))
        rep = {
            "text": r["text"],
            "font": r["font"],
            "seconds": r.get("seconds"),
            "pages": len(r["pages"]),
            "errors": r["errors"],
            "rows": r["summary"]["rows"],
            "over12": [{**where(p[0], texts), "rows": p[1], "bottom": p[2]} for p in over],
            "fullest": [{**where(p[0], texts), "rows": p[1], "bottom": p[2]} for p in worst],
            "widest_choice": max((w for c in r["choices"] for w in c["widths"]), default=None),
            "choices_wider_than_english": wide,
            "choices_over_text": [where(c["page"], texts) for c in r["choices"] if c["room"] < 0],
            "balloon_pages_out": len(tight),
            "balloon_pages": len(r["balloons"]),
            "balloons_out": [{**where(b["page"], texts), "art": b["art"], "out": b["out"], "room": b["room"], "width": b.get("width"), "right": b.get("right")} for b in tight],
            "widest_balloon_row": max(({"page": b["page"], "width": b["width"], "right": b["right"]} for b in r["balloons"] if b.get("width") is not None),
                                      key=lambda x: x["width"], default=None),
        }
        if texts is not None:
            rep["balloon_pages_out_translated"] = sum(1 for b in rep["balloons_out"] if b["translated"])
        out["reports"][name] = rep
        print(f"\n{name}: {r['text']} ({len(r['pages'])} pages, {r.get('seconds')} s, Georgia {'yes' if r['font']['georgia'] else 'no'}"
              f"{', forced ' + r['font']['forced'] if r['font'].get('forced') else ''}); errors {len(r['errors'])}")
        print(f"  pages over {ROWS} rows: {len(over)}" + "".join(f"\n    page {x['page']} {x['scene']} (k {x['k']}) {x['rows']} rows, bottom {x['bottom']} px, lines {x['ids']}"
                                                         + ("" if texts is None else f", {'translated' if x['translated'] else 'English'}") for x in rep["over12"]))
        print("  fullest: " + ", ".join(f"{x['page']} {x['scene']} {x['rows']} rows" for x in rep["fullest"][:5]))
        print(f"  widest choice {rep['widest_choice']} px (English {widest_en}); wider than English: {len(wide)}"
              + "".join(f"\n    page {x['page']} {x['scene']} line {x['id']} {x['width']} px" for x in wide[:10]))
        print(f"  choice rows pushed over the text: {len(rep['choices_over_text'])}")
        print(f"  balloon pages with a letter outside the balloon: {len(tight)} of {len(r['balloons'])}"
              + (f" ({rep['balloon_pages_out_translated']} translated)" if texts is not None else "")
              + "".join(f"\n    page {x['page']} {x['scene']} lines {x['ids']} {x['art']}: {x['out']} letters out, widest row {x['width']} px to x {x['right']}"
                        for x in rep["balloons_out"][:8])
              + (f"\n  widest balloon row: {rep['widest_balloon_row']}" if rep["widest_balloon_row"] else ""))
    path = os.path.join(AUDIT, "fit-summary.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"\n{path}")


if __name__ == "__main__":
    main()
