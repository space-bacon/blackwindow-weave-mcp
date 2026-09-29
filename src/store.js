import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// One index per woven folder: manifest.json names the rows file and passages file it goes with, so a write lands as
// two new data files and then an atomic rename of the manifest, and an interrupted write leaves the last good index.
export class Store {
  constructor(root) { this.root = path.join(root, "index"); fs.mkdirSync(this.root, { recursive: true }); }

  dirOf(folder) { return path.join(this.root, crypto.createHash("sha1").update(folder).digest("hex").slice(0, 16)); }

  load(folder, retry = 1) {
    const dir = this.dirOf(folder), mf = path.join(dir, "manifest.json");
    if (!fs.existsSync(mf)) return null;
    try {
      const manifest = JSON.parse(fs.readFileSync(mf, "utf8"));
      const buf = fs.readFileSync(path.join(dir, manifest.rowsFile));
      const rows = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
      const passages = fs.readFileSync(path.join(dir, manifest.passagesFile), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      if (rows.length !== passages.length * manifest.dim) throw new Error("rows and passages disagree");
      return { manifest, rows, passages };
    } catch (e) {
      // A data file that vanished between reading the manifest and opening it was replaced by another process's save.
      if (e.code === "ENOENT" && retry > 0) return this.load(folder, retry - 1);
      // An unreadable index is moved aside rather than overwritten, and the folder is woven again from its files.
      fs.renameSync(dir, `${dir}.unreadable-${Date.now()}`);
      process.stderr.write(`[weave] ${folder}: index unreadable (${e.message}); moved aside\n`);
      return null;
    }
  }

  save(folder, manifest, rows, passages) {
    const dir = this.dirOf(folder), stamp = `${Date.now()}-${process.pid}`;
    fs.mkdirSync(dir, { recursive: true });
    const old = fs.existsSync(path.join(dir, "manifest.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) : null;
    const next = { ...manifest, rowsFile: `rows-${stamp}.f32`, passagesFile: `passages-${stamp}.jsonl` };
    fs.writeFileSync(path.join(dir, next.rowsFile), Buffer.from(rows.buffer, rows.byteOffset, rows.byteLength));
    fs.writeFileSync(path.join(dir, next.passagesFile), passages.map((p) => JSON.stringify(p)).join("\n") + "\n");
    fs.writeFileSync(path.join(dir, "manifest.json.tmp"), JSON.stringify(next));
    fs.renameSync(path.join(dir, "manifest.json.tmp"), path.join(dir, "manifest.json"));
    if (old) for (const f of [old.rowsFile, old.passagesFile]) if (f && f !== next.rowsFile && f !== next.passagesFile) fs.rmSync(path.join(dir, f), { force: true });
  }

  folders() {
    const out = [];
    for (const d of fs.readdirSync(this.root)) {
      const mf = path.join(this.root, d, "manifest.json");
      if (!fs.existsSync(mf)) continue;
      try { const m = JSON.parse(fs.readFileSync(mf, "utf8")); out.push({ folder: m.folder, files: Object.keys(m.files).length, passages: m.passages, updated: m.updated }); } catch { /* skipped */ }
    }
    return out;
  }

  forget(folder) { const dir = this.dirOf(folder); const had = fs.existsSync(dir); fs.rmSync(dir, { recursive: true, force: true }); return had; }
}
