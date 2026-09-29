// End to end over stdio, the way an MCP client runs the server: list the tools, weave a folder, weave it again (nothing
// changed, so nothing is embedded), ask three questions whose answer file is known, and check that a weave longer than
// the server's wait returns at once and finishes in the background. Folders and questions given on the command line
// are reported with their ranks and do not decide the exit code. Writes test/smoke.json.
//
//   node test/smoke.mjs [<folder> "<question>" <expected file> ...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "..");
const cases = [[path.join(root, "src"), [
  ["where is the index written to disk so an interrupted write keeps the old one", "store.js"],
  ["how is source code cut into passages with the nearest definition as a label", "chunk.js"],
  ["which folders and files are skipped when a folder is listed", "files.js"],
]]];
const extra = process.argv.slice(2);
for (let i = 0; i + 2 < extra.length + 1 && extra[i]; i += 3) cases.push([path.resolve(extra[i]), [[extra[i + 1], extra[i + 2]]]]);

const cache = fs.mkdtempSync(path.join(os.tmpdir(), "weave-smoke-"));
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, "src/index.js"), "--cache", cache], stderr: "inherit" }));
const call = async (name, args) => { const t0 = Date.now(); const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 1_800_000 }); return { text: r.content.map((c) => c.text).join("\n"), secs: (Date.now() - t0) / 1000, isError: !!r.isError }; };
const out = { node: process.version, platform: `${process.platform}-${process.arch}`, cpus: os.cpus().length, tools: (await client.listTools()).tools.map((t) => t.name), runs: [] };
let failed = 0;
for (const [ci, [folder, qs]] of cases.entries()) {
  const first = await call("weave_folder", { path: folder });
  const second = await call("weave_folder", { path: folder });
  const run = { folder, first, second, questions: [] };
  for (const [q, want] of qs) {
    const r = await call("weave_search", { query: q, k: 5, folder });
    const files = [...r.text.matchAll(/^\d+\. (\S+?):\d+-\d+/gm)].map((m) => m[1]);
    const rank = files.findIndex((f) => f.endsWith(`/${want}`) || f.endsWith(want)) + 1;
    if (rank !== 1 && ci === 0) failed++;
    run.questions.push({ q, want, rank, top: files.slice(0, 3).map((f) => path.relative(folder, f)), secs: r.secs });
  }
  out.runs.push(run);
  console.log(JSON.stringify({ folder, first: first.text, second: second.text, ranks: run.questions.map((x) => x.rank) }));
}
out.list = (await call("weave_list", {})).text;
await client.close();

// A weave longer than the server's wait returns at once and finishes in the background.
const bgCache = fs.mkdtempSync(path.join(os.tmpdir(), "weave-smoke-"));
const bg = new Client({ name: "smoke-bg", version: "0" });
await bg.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, "src/index.js"), "--cache", bgCache], env: { ...process.env, BLACKWINDOW_WEAVE_WAIT_MS: "1" }, stderr: "ignore" }));
const bgCall = async (name, args) => (await bg.callTool({ name, arguments: args })).content.map((c) => c.text).join("\n");
const started = await bgCall("weave_folder", { path: path.join(root, "src") });
let polls = 0, listed = "";
while ((listed = await bgCall("weave_list", {})).includes("weaving") || !listed.includes("passages")) { polls++; await new Promise((ok) => setTimeout(ok, 250)); }
const after = await bgCall("weave_search", { query: cases[0][1][0][0], k: 1 });
out.background = { started, polls, listed, top: after.split("\n")[0] };
if (!started.startsWith("Still weaving") || !after.includes("store.js")) failed++;
await bg.close();
fs.rmSync(bgCache, { recursive: true, force: true });

out.failed = failed;
fs.rmSync(cache, { recursive: true, force: true });
fs.writeFileSync(path.join(here, "smoke.json.tmp"), JSON.stringify(out, null, 1));
fs.renameSync(path.join(here, "smoke.json.tmp"), path.join(here, "smoke.json"));
console.log(`tools ${out.tools.join(", ")}; ${failed} question(s) without the expected file first`);
process.exit(failed ? 1 : 0);
