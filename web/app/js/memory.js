// memory.js - what an iPhone or an iPad is spared (GitHub issue 16, 2026-11-22). A port addition: nothing here is the game's.
//
// WebKit counts a page's pictures against the page itself: the textures, the targets it draws through and the pictures on their way to the GPU
// are all in the web content process's own footprint, with the decoded sounds and the page's heap, and iOS ends a process that takes too much
// (the reporter's log: the page at 1,600 MiB on an iPhone 13 Pro Max, ended as the phone ran short; closing the other apps and tabs let the
// same scene pass). Measured in a WKWebView on a Mac with the iPhone's limits, fast forward through 05_01_CIEL05_3E held the page at 1.3 to
// 1.6 GB and took it to 1.9 GB, of which 0.9 to 1.1 GB were graphics while the renderer counted 0.5 to 0.6 GB. The iOS Simulator shows none
// of that graphics memory, which is why issue 8's measurements there missed it.
//
// The parts, each of which an iPhone or iPad takes and nothing else does (a desktop and an Android phone keep what they had):
//   queue    one large picture is decoded at a time, the pictures used longest ago let go before it is and not after, and a picture the
//            story is waiting for goes before those read ahead (renderer.js load)
//   count    the blurred copies are held to their share whatever the pace, their makers' reduced copies are counted, and the targets a
//            frame no longer draws through are let go (renderer.js)
//   windows  the text window's styles are read as textures for the scene that shows them, not all 33 at start (preload.js scene)
//   sounds   a sound that has stopped lets go of its samples, also where the sound system is not running and would never say it ended
//            (audio.js)
// (A fifth part, fewer pictures kept, was built, measured and taken out: renderer.js pictureBudget.)
// `?mem=off` in the address switches all of it off for that visit, `?mem=on` all of it on (on any device: for measuring), and a list
// (`?mem=queue,sounds`) only those parts.
import { appleTouch } from "./touch.js";

export const PARTS = ["queue", "count", "windows", "sounds"];

export function memoryPlan(win = globalThis) {
  let asked = null;
  try { asked = new URLSearchParams(win.location?.search || "").get("mem"); } catch { /* no address */ }
  const listed = asked && asked !== "on" && asked !== "off" ? new Set(asked.split(",")) : null;
  const on = asked === null ? appleTouch(win) : asked !== "off";
  return Object.fromEntries(PARTS.map((p) => [p, on && (!listed || listed.has(p))]));
}

export const MEMORY = memoryPlan();
