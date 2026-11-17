// shrink.js - a picture made smaller away from the page's own thread (renderer.js upload).
// A GPU takes no texture larger than its limit on a side (4096 on older phones, tablets and laptops), and 2,276 of the game's pictures are stored
// larger: a standing sprite 4100 to 4500 tall, a wide picture up to 7467 across. Such a picture is read at a size that fits, with the browser's own
// createImageBitmap. Asked for on the page, Chrome does that resize on the page's thread: 0.1 s for a sprite and 0.67 s for a 5927 x 4332 picture
// with the processor slowed four times, as a phone's is, and nothing is drawn meanwhile (05_00_ARC05_9_2B on a 4096 GPU: 5.1 to 5.5 s of 150 lost
// to late frames, against 2.9 s where no picture needs it). The same call in a worker gives the same bitmap and holds the page 6 ms.
// The worker is made when first needed, from the few lines below (no file of its own to fetch). Where there is none, or it fails, does not answer,
// or gives a bitmap of another size than asked, the picture is made on the page as before, and from then on every one is.
export const SOURCE = `onmessage = async (e) => {
  const { id, blob, opts } = e.data;
  try { const bmp = await createImageBitmap(blob, opts); postMessage({ id, bmp }, [bmp]); }
  catch (err) { postMessage({ id, error: String((err && err.message) || err) }); }
};`;
const PATIENCE = 20000;   // ms a picture may take in the worker before it is given up for good (the largest takes under a second)

// The browser's worker from SOURCE, or null where it has none.
function pageWorker() {
  if (typeof Worker !== "function" || typeof Blob !== "function" || typeof URL?.createObjectURL !== "function") return null;
  // (the address is kept: a browser may read the lines after this returns, and there is one worker a page)
  return new Worker(URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" })));
}

export class Shrinker {
  // make(): the worker, or null. here(blob, opts): the bitmap made on the page. patience: ms. (All three for tests.)
  constructor({ make = pageWorker, here = (blob, opts) => createImageBitmap(blob, opts), patience = PATIENCE } = {}) {
    this.make = make;
    this.here = here;
    this.patience = patience;
    this.worker = null;
    this.off = false;         // no worker here, or it failed: every picture on the page
    this.jobs = new Map();    // id -> { done, timer }: what the worker has not answered yet
    this.n = 0;
  }

  // The worker is given up: what it still owed is made on the page.
  stop() {
    this.off = true;
    try { this.worker?.terminate?.(); } catch { /* gone already */ }
    this.worker = null;
    for (const job of [...this.jobs.values()]) job.done(null);
  }

  // The worker's bitmap for (blob, opts), or null where it gave none.
  ask(blob, opts) {
    if (this.off) return Promise.resolve(null);
    if (!this.worker) {
      try { this.worker = this.make(); } catch { this.worker = null; }
      if (!this.worker) { this.off = true; return Promise.resolve(null); }
      this.worker.onmessage = (e) => this.jobs.get(e.data?.id)?.done(e.data?.bmp || null);
      this.worker.onerror = (e) => { e?.preventDefault?.(); this.stop(); };          // (the worker's lines did not run)
      this.worker.onmessageerror = () => this.stop();                               // (a bitmap that could not be handed over)
    }
    return new Promise((res) => {
      const id = ++this.n;
      const job = { done: (bmp) => { clearTimeout(job.timer); this.jobs.delete(id); res(bmp); } };
      job.timer = setTimeout(() => this.stop(), this.patience);
      this.jobs.set(id, job);
      try { this.worker.postMessage({ id, blob, opts }); } catch { this.stop(); }
    });
  }

  // The picture in `blob` as a bitmap of opts.resizeWidth x opts.resizeHeight.
  async bitmap(blob, opts) {
    const bmp = await this.ask(blob, opts);
    if (bmp && bmp.width === opts.resizeWidth && bmp.height === opts.resizeHeight) return bmp;
    // none (this picture's own fault, or the worker's), or one of another size (a worker that does not resize): on the page, as before
    if (bmp) { bmp.close?.(); this.stop(); }
    return this.here(blob, opts);
  }
}
