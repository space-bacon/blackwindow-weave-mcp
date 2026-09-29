import fs from "node:fs";
import path from "node:path";
import { chunk } from "./chunk.js";
import { MODEL } from "./embed.js";
import { listFiles, readText } from "./files.js";

const REFRESH_MS = 30_000, REFRESH_MAX_FILES = 200;
const concat = (parts, n) => { const out = new Float32Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export class Weave {
  constructor(store, embedder) { this.store = store; this.embedder = embedder; this.loaded = new Map(); this.running = new Map(); this.checked = new Map(); this.progress = new Map(); this.scope = new Set(); }

  get(folder) {
    if (!this.loaded.has(folder)) { const x = this.store.load(folder); if (x) this.loaded.set(folder, x); }
    return this.loaded.get(folder) || null;
  }

  /** Index a folder, or bring its index up to date: files whose size and mtime are unchanged keep their rows. */
  weave(folder, progress = () => {}, opts = {}) {
    folder = path.resolve(folder);
    if (!opts.maxChanged) this.scope.add(folder);
    const track = (done, total, message) => { this.progress.set(folder, { done, total }); progress(done, total, message); };
    if (!this.running.has(folder)) this.running.set(folder, this.run(folder, track, opts).finally(() => { this.running.delete(folder); this.progress.delete(folder); }));
    return this.running.get(folder);
  }

  async run(folder, progress, { maxChanged = Infinity } = {}) {
    let st; try { st = fs.statSync(folder); } catch { st = null; }
    if (!st?.isDirectory()) throw new Error(`${folder} is not a folder on this machine`);
    const t0 = Date.now(), files = listFiles(folder), prev = this.get(folder);
    const d0 = prev?.manifest.dim || 0, kept = [], passages = [], manifestFiles = {}, todo = [];
    for (const f of files) {
      const old = prev?.manifest.files[f.rel];
      if (old && old.size === f.size && old.mtimeMs === f.mtimeMs) {
        const [a, b] = old.rows, start = passages.length;
        kept.push(prev.rows.subarray(a * d0, b * d0));
        for (let i = a; i < b; i++) passages.push(prev.passages[i]);
        manifestFiles[f.rel] = { size: f.size, mtimeMs: f.mtimeMs, rows: [start, passages.length] };
      } else todo.push(f);
    }
    const removed = prev ? Object.keys(prev.manifest.files).filter((r) => !manifestFiles[r] && !todo.some((f) => f.rel === r)).length : 0;
    this.checked.set(folder, Date.now());
    if (prev && !todo.length && !removed) return { folder, files: files.length, passages: prev.passages.length, embedded: 0, reused: files.length, removed: 0, secs: (Date.now() - t0) / 1000 };
    if (todo.length > maxChanged) return { folder, skipped: `${todo.length} files changed; call weave_folder to re-index` };
    const pending = [];
    for (const f of todo) { const text = readText(folder, f.rel); if (text != null) pending.push({ ...f, chunks: chunk(text, f.rel) }); }
    // Batches are cut from the passages in length order, so a batch pads to a length close to its own.
    const flat = pending.flatMap((p) => p.chunks), order = flat.map((_, i) => i).sort((a, b) => flat[a].text.length - flat[b].text.length);
    let dim = d0, done = 0, fresh = null;
    for (let s = 0; s < flat.length; s += 32) {
      const idx = order.slice(s, s + 32), e = await this.embedder.embed(idx.map((i) => flat[i].text));
      dim = e.d; fresh ||= new Float32Array(flat.length * dim);
      idx.forEach((i, j) => fresh.set(e.rows.subarray(j * dim, (j + 1) * dim), i * dim));
      done += e.n;
      progress(done, flat.length, `${done} of ${flat.length} passages embedded`);
    }
    for (const p of pending) {
      const start = passages.length;
      for (const c of p.chunks) passages.push({ file: p.rel, start: c.start, end: c.end, label: c.label, text: c.text });
      manifestFiles[p.rel] = { size: p.size, mtimeMs: p.mtimeMs, rows: [start, passages.length] };
    }
    dim = dim || 384;
    const rows = concat(fresh ? [...kept, fresh] : kept, passages.length * dim);
    const manifest = { folder, model: MODEL, dim, files: manifestFiles, passages: passages.length, created: prev?.manifest.created || new Date().toISOString(), updated: new Date().toISOString() };
    this.store.save(folder, manifest, rows, passages);
    this.loaded.set(folder, { manifest, rows, passages });
    return { folder, files: files.length, passages: passages.length, embedded: flat.length, reused: files.length - pending.length, removed, secs: (Date.now() - t0) / 1000 };
  }

  /** The k passages nearest the query by centred cosine, over one woven folder, or else the folders woven or named
   *  in this session, or else every woven folder. Folders not checked in the last 30 s are brought up to date first
   *  when fewer than 200 of their files changed. */
  async search(query, k = 8, folder) {
    const all = this.store.folders().map((f) => f.folder), mine = all.filter((f) => this.scope.has(f));
    const targets = folder ? [path.resolve(folder)] : mine.length ? mine : all;
    const busy = (f) => { const s = this.progress.get(f); return s ? `${f} is still being woven (${s.done} of ${s.total} passages embedded)` : null; };
    if (folder && !this.get(targets[0]) && busy(targets[0])) throw new Error(busy(targets[0]));
    if (!targets.length || (folder && !this.get(targets[0]))) throw new Error(folder ? `${targets[0]} is not woven yet; call weave_folder first` : [...this.progress.keys()].map(busy)[0] || "nothing is woven yet; call weave_folder on a project folder first");
    const notes = [];
    for (const f of this.progress.keys()) if (!folder && !this.get(f)) notes.push(busy(f));
    for (const f of targets) {
      if (Date.now() - (this.checked.get(f) || 0) < REFRESH_MS || this.running.has(f)) continue;
      const r = await this.weave(f, () => {}, { maxChanged: REFRESH_MAX_FILES }).catch((e) => ({ skipped: e.message }));
      if (r.skipped) notes.push(`${f}: ${r.skipped}`);
    }
    const { rows: q, d } = await this.embedder.embed([query]);
    const top = [];
    for (const f of targets) {
      const x = this.get(f); if (!x || x.manifest.dim !== d) continue;
      const n = x.passages.length, R = x.rows;
      for (let i = 0; i < n; i++) {
        let s = 0; const o = i * d;
        for (let j = 0; j < d; j++) s += q[j] * R[o + j];
        if (top.length < k || s > top[top.length - 1].score) {
          top.push({ score: s, folder: f, i });
          top.sort((a, b) => b.score - a.score);
          if (top.length > k) top.pop();
        }
      }
    }
    return { notes, hits: top.map(({ score, folder: f, i }) => { const p = this.get(f).passages[i]; return { path: path.join(f, p.file), start: p.start, end: p.end, label: p.label, text: p.text, score }; }) };
  }
}
