"""tex.py - BNTX texture -> RGBA pixels, in memory. Block-linear untile from tools/hud/ui_archive.py; BC decode by texture2ddecoder."""
import os
import sys

import numpy as np
import texture2ddecoder as t2d

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "../../tools/hud"))
sys.path.insert(0, os.path.join(HERE, "../../framework/tools/maxwell"))
import ui_archive
import bntx as B


def textures(raw):
    out = B.parse_bntx(raw)
    at = _name_offsets(raw, len(out))
    if any(not _whole(raw, a) for a in at):
        _rename(raw, out, at)
    return out


def _name_offsets(raw, count):
    """Where each texture's name record is (its BRTI's pointer at +0x60)."""
    import struct
    infos = struct.unpack_from("<Q", raw, 0x28)[0]
    return [struct.unpack_from("<Q", raw, struct.unpack_from("<Q", raw, infos + 8 * k)[0] + 0x60)[0] for k in range(count)]


def _whole(raw, at):
    """Whether a name record is whole: a length, that many letters, a NUL."""
    import struct
    n = struct.unpack_from("<H", raw, at)[0]
    return n < 128 and at + 2 + n < len(raw) and raw[at + 2 + n] == 0


def _rename(raw, out, at):
    """The Chinese patch's DISP_PARTS_JA: its repacker wrote the name pool again with the Shift-JIS names (the balloons' "twフキダシ...") in UTF-8,
    which are longer, but kept each name's old length before it and left every pointer to a name (the textures', the dictionary's) at its old
    offset. The game finds these textures by number and never reads the names; the port's tools look them up by name. So the pool is read name by
    name to each NUL, and the old offsets are worked out again from the old lengths (u16 length, the letters, a NUL, to an even offset)."""
    import struct
    data = bytes(raw)
    s = data.find(b"_STR")
    count = struct.unpack_from("<i", raw, s + 0x10)[0]
    p = q = s + 0x14
    old = {}
    for _ in range(count + 1):
        n = struct.unpack_from("<H", raw, p)[0]
        end = data.index(b"\0", p + 2)
        # (named as the original's own record reads, its Shift-JIS taken for UTF-8 as containers.binstr does, so the files keep the shared names)
        old[q] = data[p + 2:end].decode("utf-8").encode("cp932").decode("utf-8", "replace")
        p = end + 1
        p += p & 1
        q += 3 + n
        q += q & 1
    for t, a in zip(out, at):
        if a not in old:
            raise ValueError(f"a texture name at {a:#x} matches no name of the pool")
        t.name = old[a]


def decode(t, raw, level=0):
    """RGBA uint8 array of one mip level (level 0 by default)."""
    w, h = max(1, t.width >> level), max(1, t.height >> level)
    name = t.format_name.split("_")[0]
    start = t.mip_offsets[level]
    end = t.mip_offsets[level + 1] if level + 1 < t.levels else start + t.image_size
    bw, bh, bpb = t.block_w, t.block_h, t.bpb
    bhl = t.block_height_log2
    rows = (h + bh - 1) // bh
    # the block height shrinks with the mip
    gobs = 1 << bhl
    while gobs > 1 and rows <= (gobs // 2) * 8:
        gobs //= 2
    bhl_m = {1: 0, 2: 1, 4: 2, 8: 3, 16: 4, 32: 5}[gobs]
    data = bytes(raw[start:end]) if level + 1 < t.levels else bytes(raw[start:])
    linear = ui_archive.deswizzle(data, w, h, bhl_m, block=bw, bpb=bpb)
    linear = bytes(linear)
    if name == "BC7":
        out = t2d.decode_bc7(linear, w, h)
    elif name == "BC1":
        out = t2d.decode_bc1(linear, w, h)
    elif name == "BC3":
        out = t2d.decode_bc3(linear, w, h)
    elif name == "BC4":
        out = t2d.decode_bc4(linear, w, h)
    elif name == "BC5":
        out = t2d.decode_bc5(linear, w, h)
    elif bpb == 4:
        a = np.frombuffer(linear, np.uint8).reshape(h, w, 4)
        return a.copy()
    else:
        raise ValueError("format " + t.format_name)
    a = np.frombuffer(out, np.uint8).reshape(h, w, 4)  # BGRA
    return a[:, :, [2, 1, 0, 3]].copy()
