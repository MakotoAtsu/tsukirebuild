// subs.js - subtitles the port sets over a movie. The Chinese patch put its translation of the prologue's words into a copy of the movie of its own: the
// original's frames with a line burned in at the bottom, and in three scenes its lines beside the movie's own written words. The port keeps the
// original's movie (Japanese's, ja/movie/prologue.mp4) and sets the same lines at the same frames over it, as text (zh/subs/prologue.json, from
// web-dev/data/zh_prologue_subs.json: read from the patch's movie frame by frame against the original's). The words and the frames are the patch's;
// the look is near its own (style.css #movie-subs), not measured to it.
import { asset, has } from "./lang.js";

const loaded = new Map();
// The subtitles of a movie in the language in use, or null (most movies, every language but Chinese).
export function subsFor(name) {
  const rel = `subs/${name}.json`;
  if (!has(rel)) return Promise.resolve(null);
  if (!loaded.has(rel)) loaded.set(rel, fetch(asset(`/assets/${rel}`)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return loaded.get(rel);
}

// The line shown at frame f (the table's subs are in order and do not overlap), or null.
export function lineAt(subs, f) {
  let lo = 0, hi = subs.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, s = subs[m];
    if (f < s.start) hi = m - 1;
    else if (f >= s.end) lo = m + 1;
    else return s;
  }
  return null;
}

// How far a line set into the picture is shown at frame f (it comes in from `start` to `full`, goes from `out` to `end`; null out: it is cut at end).
export function pictureLevel(p, f) {
  if (f < p.start || f >= p.end) return 0;
  if (f < p.full) return (f - p.start + 1) / (p.full - p.start + 1);
  if (p.out != null && f >= p.out) return Math.max(0, 1 - (f - p.out + 1) / (p.end - p.out + 1));
  return 1;
}

// Sets the lines of `data` over the movie playing in `v`, following its own clock (each frame as the element shows it, where the browser says when;
// else every display frame): `subs`, the line at the bottom, and `inPicture`, the lines the patch also set into the picture itself beside the movie's
// own words (three scenes of the prologue), at their places. box: the element to set them in. Returns the function that stops it.
export function showSubs(v, data, box) {
  const fps = data.fps || 30;
  let shown = null, run = true;
  const st = data.style || {};
  box.style.setProperty("--sub-size", `${st.size || 54}px`);
  box.style.setProperty("--sub-top", `${st.top ?? 932}px`);
  box.style.setProperty("--sub-stroke", `${st.stroke ?? 3}px`);
  box.style.setProperty("--sub-weight", String(st.weight || 700));
  const line = document.createElement("div");
  line.className = "sub";
  const pics = (data.inPicture || []).map((p) => {
    const e = document.createElement("div");
    e.className = "pic";
    e.textContent = p.text;
    e.style.left = `${p.x}px`;
    e.style.top = `${p.y}px`;
    e.style.opacity = "0";
    return e;
  });
  box.append(line, ...pics);
  const show = (t) => {
    const f = Math.floor(t * fps + 1e-3);
    const s = lineAt(data.subs, f);
    if (s !== shown) { shown = s; line.textContent = s ? s.text : ""; line.style.display = s ? "" : "none"; }
    let any = !!s;
    (data.inPicture || []).forEach((p, k) => {
      const a = pictureLevel(p, f);
      pics[k].style.opacity = String(a);
      pics[k].style.display = a > 0 ? "" : "none";
      any ||= a > 0;
    });
    box.style.display = any ? "block" : "none";
  };
  const byFrame = typeof v.requestVideoFrameCallback === "function";
  const step = (now, meta) => {
    if (!run) return;
    show(meta ? meta.mediaTime : v.currentTime);
    if (byFrame) v.requestVideoFrameCallback(step); else requestAnimationFrame(() => step());
  };
  show(v.currentTime);
  if (byFrame) v.requestVideoFrameCallback(step); else requestAnimationFrame(() => step());
  const seek = () => show(v.currentTime);
  v.addEventListener("seeked", seek);
  return () => {
    run = false;
    v.removeEventListener("seeked", seek);
    box.textContent = "";
    box.style.display = "none";
  };
}
