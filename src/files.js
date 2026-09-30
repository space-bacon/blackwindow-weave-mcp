import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SKIP_DIR = /(^|\/)(\.git|\.hg|\.svn|node_modules|dist|build|out|vendor|third_party|__pycache__|site-packages|\.?venv[^/]*|env|target|coverage|\.next|\.nuxt|\.turbo|\.cache|\.idea|\.vscode|\.vscode-test|\.tox|\.mypy_cache|\.pytest_cache|Pods|DerivedData)(\/|$)/;
const TEXT = /\.(py|pyi|js|mjs|cjs|jsx|ts|tsx|go|rs|java|kt|kts|scala|c|h|cc|cpp|cxx|hpp|hh|cs|rb|php|swift|m|mm|lua|pl|sh|bash|zsh|fish|ps1|r|jl|dart|ex|exs|erl|hs|ml|mli|clj|sql|vue|svelte|astro|zig|nim|sol|html?|css|scss|less|md|markdown|mdx|rst|txt|adoc|tex|toml|ya?ml|cfg|ini|gradle|cmake|proto|graphql|tf|hcl)$|(^|\/)(Dockerfile|Makefile|Justfile|README|CHANGELOG)[^/]*$/i;
const SKIP_FILE = /\.min\.(js|css)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum)$/i;
export const MAX_BYTES = 1_000_000;

/** Files worth reading under `folder`, relative, with size and mtime. A git work tree is listed by git, so its ignore
 *  rules hold; anything else is walked with the skip list. */
export function listFiles(folder) {
  let rel = null;
  try {
    const out = execFileSync("git", ["-C", folder, "ls-files", "-co", "--exclude-standard", "-z"], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
    rel = out.toString("utf8").split("\0").filter(Boolean);
  } catch { rel = null; }
  if (!rel) {
    rel = [];
    const walk = (d, depth) => {
      let ents = [];
      try { ents = fs.readdirSync(path.join(folder, d), { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const r = d ? `${d}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!SKIP_DIR.test(r + "/") && depth < 24) walk(r, depth + 1); }
        else if (e.isFile()) rel.push(r);
      }
    };
    walk("", 0);
  }
  const files = [];
  for (const r of rel) {
    if (SKIP_DIR.test(r) || SKIP_FILE.test(r) || !TEXT.test(r)) continue;
    let st;
    try { st = fs.statSync(path.join(folder, r)); } catch { continue; }
    if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) continue;
    files.push({ rel: r, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

/** The file's text, or null for one that reads as binary. */
export function readText(folder, rel) {
  let buf;
  try { buf = fs.readFileSync(path.join(folder, rel)); } catch { return null; }
  if (buf.subarray(0, 8192).includes(0)) return null;
  const s = buf.toString("utf8");
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
