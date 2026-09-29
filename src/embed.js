import fs from "node:fs";
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";

export const MODEL = "RiverRider/motherlode-code-small-en-v0.1";
const MEAN = `https://huggingface.co/${MODEL}/resolve/main/centring/mean_shipped.json`;

/** Motherlode on the CPU: CLS pooling, unit length, then the model's shipped mean subtracted and the row brought back
 *  to unit length, so a dot product between two rows is their centred cosine. */
export class Embedder {
  constructor(cacheDir) { this.cacheDir = cacheDir; this.pipe = null; this.mu = null; this.loading = null; }

  ready() {
    return (this.loading ||= (async () => {
      env.allowLocalModels = false;
      env.cacheDir = path.join(this.cacheDir, "models");
      this.pipe = await pipeline("feature-extraction", MODEL, { dtype: "fp32" });
      this.mu = await this.mean();
    })());
  }

  async mean() {
    const f = path.join(this.cacheDir, "models", "mean_shipped.json");
    if (!fs.existsSync(f)) {
      const r = await fetch(MEAN);
      if (!r.ok) throw new Error(`the model's mean did not download (${r.status})`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f + ".tmp", await r.text());
      fs.renameSync(f + ".tmp", f);
    }
    return Float32Array.from(JSON.parse(fs.readFileSync(f, "utf8")).mu);
  }

  async embed(texts) {
    await this.ready();
    const out = await this.pipe(texts, { pooling: "cls", normalize: true });
    const [n, d] = out.dims, x = out.data, mu = this.mu, rows = new Float32Array(n * d);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < d; k++) { const v = x[i * d + k] - mu[k]; rows[i * d + k] = v; s += v * v; }
      s = Math.sqrt(s);
      for (let k = 0; k < d; k++) rows[i * d + k] = Number.isFinite(s) && s > 0 ? rows[i * d + k] / s : 0;
    }
    out.dispose?.();
    return { rows, n, d };
  }
}
