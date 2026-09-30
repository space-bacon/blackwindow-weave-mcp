// The package as a user gets it: packed, installed once through `npx ... --version` (timed), then started the way MCP
// clients start it. On Windows it is also started through `cmd /c`, the form clients that do not resolve npm's .cmd
// shims need. It weaves this repository's src/ into a fresh cache, so the encoder is downloaded and run on this
// platform, and asks one question whose answer file is known. Prints one JSON line per step; exits 1 on a failure.
//
//   npm pack && node test/installed.mjs blackwindow-weave-mcp-<version>.tgz
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import spawn from "cross-spawn";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tarball = path.resolve(process.argv[2] || "");
if (!fs.existsSync(tarball)) { console.error(`no tarball at ${tarball}`); process.exit(2); }

// npx reads a bare path as a command to run, so the tarball is named as the package and the bin as the command.
const npx = ["-y", "--package", tarball, "blackwindow-weave-mcp"];

// The install a user runs once in a terminal before adding the server to a client, timed. Launches below reuse it.
const t0 = Date.now(), warm = spawn.sync("npx", [...npx, "--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
console.log(JSON.stringify({ platform: `${process.platform}-${process.arch}`, node: process.version, install: "npx --version", status: warm.status, printed: (warm.stdout || "").trim(), secs: (Date.now() - t0) / 1000 }));
if (warm.status !== 0) process.exit(1);

const launches = [{ via: "npx", command: "npx", args: npx }];
if (process.platform === "win32") launches.push({ via: "cmd /c npx", command: "cmd", args: ["/c", "npx", ...npx] });

let failed = 0;
for (const [n, l] of launches.entries()) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "weave-installed-"));
  const out = { platform: `${process.platform}-${process.arch}`, node: process.version, via: l.via };
  const client = new Client({ name: "installed", version: "0" });
  try {
    const t0 = Date.now();
    await client.connect(new StdioClientTransport({ command: l.command, args: l.args, env: { ...process.env, BLACKWINDOW_WEAVE_CACHE: cache }, stderr: "inherit" }));
    out.startSecs = (Date.now() - t0) / 1000;
    out.tools = (await client.listTools()).tools.map((t) => t.name);
    const call = async (name, args) => {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 900_000 });
      return { isError: !!r.isError, text: r.content.map((c) => c.text).join("\n") };
    };
    if (n === 0) {
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
  if (!out.ok) failed++;
  console.log(JSON.stringify(out));
}
process.exit(failed ? 1 : 0);
