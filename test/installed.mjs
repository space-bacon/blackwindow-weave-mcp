// The package as a user gets it: installed once from a terminal through `npx ... --version` (timed), then started the
// way MCP clients start it, through npx with the same spec and, installed globally, by its own command. On Windows each
// is also started through `cmd /c`, the form clients that do not resolve npm's .cmd shims need. The first launch weaves
// this repository's src/ into a fresh cache, so the encoder is downloaded and run on this platform, and asks one
// question whose answer file is known. Prints one JSON line per step; exits 1 on a failure.
//
//   npm pack && node test/installed.mjs blackwindow-weave-mcp-<version>.tgz     the packed working tree
//   node test/installed.mjs blackwindow-weave-mcp@<version>                      a published version
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import spawn from "cross-spawn";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2] || "";
const isTarball = arg.endsWith(".tgz");
const target = isTarball ? path.resolve(arg) : arg;
if (!target || (isTarball && !fs.existsSync(target))) { console.error(`usage: node test/installed.mjs <tarball | spec>`); process.exit(2); }
const win = process.platform === "win32", where = { platform: `${process.platform}-${process.arch}`, node: process.version, target: isTarball ? path.basename(target) : target };
// Inside this checkout npx counts its package.json as the spec already installed, installs nothing, and finds no command.
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "weave-user-"));

// npx reads a bare path as a command to run, so a tarball is named as the package and the bin as the command.
const npx = isTarball ? ["-y", "--package", target, "blackwindow-weave-mcp"] : ["-y", target];

const run = (cmd, args) => {
  const t0 = Date.now(), r = spawn.sync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return { status: r.status, printed: (r.stdout || "").trim().split("\n").pop(), secs: (Date.now() - t0) / 1000 };
};

let failed = 0;
const report = (o) => { if (!o.ok) failed++; console.log(JSON.stringify({ ...where, ...o })); };

async function launch(via, command, args, full) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "weave-installed-"));
  const out = { via };
  const client = new Client({ name: "installed", version: "0" });
  try {
    const t0 = Date.now();
    await client.connect(new StdioClientTransport({ command, args, cwd, env: { ...process.env, BLACKWINDOW_WEAVE_CACHE: cache }, stderr: "inherit" }));
    out.startSecs = (Date.now() - t0) / 1000;
    out.tools = (await client.listTools()).tools.map((t) => t.name);
    const call = async (name, a) => {
      const r = await client.callTool({ name, arguments: a }, undefined, { timeout: 900_000 });
      return { isError: !!r.isError, text: r.content.map((c) => c.text).join("\n") };
    };
    if (full) {
      const t1 = Date.now();
      out.weave = await call("weave_folder", { path: path.join(root, "src") });
      out.weaveSecs = (Date.now() - t1) / 1000;
      const s = await call("weave_search", { query: "where is the index written to disk so an interrupted write keeps the old one", k: 3 });
      out.top = s.text.split("\n")[0];
      out.ok = !out.weave.isError && out.weave.text.startsWith("Wove") && !s.isError && /store\.js:\d+-\d+/.test(out.top);
    } else {
      const r = await call("weave_list", {});
      out.list = r.text;
      out.ok = !r.isError && r.text === "Nothing is woven yet.";
    }
  } catch (e) {
    out.ok = false;
    out.error = String(e?.message || e);
  }
  await client.close().catch(() => {});
  fs.rmSync(cache, { recursive: true, force: true, maxRetries: 5 });
  report(out);
}

// The install a user runs once in a terminal before adding the server to a client. Launches below reuse it.
const warm = run("npx", [...npx, "--version"]);
report({ step: "npx --version", ...warm, ok: warm.status === 0 });
if (warm.status !== 0) { fs.rmSync(cwd, { recursive: true, force: true }); process.exit(1); }
await launch("npx", "npx", npx, true);
if (win) await launch("cmd /c npx", "cmd", ["/c", "npx", ...npx], false);

// The same package installed globally and started by its own command.
const global = run("npm", ["install", "-g", "--no-audit", "--no-fund", target]);
report({ step: "npm install -g", ...global, ok: global.status === 0 });
if (global.status === 0) {
  await launch("global command", "blackwindow-weave-mcp", [], false);
  if (win) await launch("cmd /c global command", "cmd", ["/c", "blackwindow-weave-mcp"], false);
  run("npm", ["uninstall", "-g", "blackwindow-weave-mcp"]);
}
fs.rmSync(cwd, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
