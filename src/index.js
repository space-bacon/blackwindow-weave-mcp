#!/usr/bin/env node
// Black Window's weave as an MCP server over stdio: index folders on this machine with the Motherlode encoder, then
// search them in plain language from any MCP client. Nothing leaves the machine except the model's first download.
//
//   npx blackwindow-weave-mcp [--folder <path> ...] [--cache <dir>]
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Embedder } from "./embed.js";
import { Store } from "./store.js";
import { Weave, canon } from "./weave.js";

const VERSION = "0.1.2";
const ICON = `https://raw.githubusercontent.com/space-bacon/blackwindow-weave-mcp/v${VERSION}/icon.png`;
const WAIT_MS = Number(process.env.BLACKWINDOW_WEAVE_WAIT_MS) || 25_000;
const argv = process.argv.slice(2);
// Run once in a terminal, --version installs the package and loads its native runtime outside a client's start-up
// timeout, which a first install through npx can exceed.
if (argv.includes("--version") || argv.includes("-v")) { process.stdout.write(`${VERSION}\n`); process.exit(0); }
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(`blackwindow-weave-mcp ${VERSION}: an MCP server over stdio, started by an MCP client.\n\n` +
    "  --folder <path>   weave this folder at start-up (repeatable)\n  --cache <dir>     where the encoder and the indexes live\n" +
    "  --version         print the version and exit\n");
  process.exit(0);
}
const many = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const cache = many("--cache")[0] || process.env.BLACKWINDOW_WEAVE_CACHE || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "blackwindow-weave");
const log = (s) => process.stderr.write(`[weave] ${s}\n`);

const weave = new Weave(new Store(cache), new Embedder(cache));
const server = new McpServer({
  name: "blackwindow-weave",
  title: "Sunstone Weave: Local Semantic Code Search",
  version: VERSION,
  icons: [{ src: ICON, mimeType: "image/png", sizes: ["256x256"] }],
});
const text = (s) => ({ content: [{ type: "text", text: s }] });

server.registerTool("weave_folder", {
  title: "Weave a folder",
  description: "Index a folder on this machine (source code and docs) for semantic search, or bring its index up to date: only files that changed since the last run are read again. Call it once per project. The first run downloads the 33M-parameter encoder (133 MB) and embeds every passage on the CPU; a run longer than 25 s continues in the background and weave_list reports its progress.",
  inputSchema: { path: z.string().describe("Absolute path of the folder, or a path relative to the server's working directory") },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ path: p }, extra) => {
  const token = extra?._meta?.progressToken;
  const progress = (done, total, message) => { if (token !== undefined) extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: done, total, message } }).catch(() => {}); };
  const job = weave.weave(p, progress);
  const r = await Promise.race([job, new Promise((ok) => setTimeout(ok, WAIT_MS, null))]);
  if (!r) {
    job.catch((e) => log(`${p}: ${e.message || e}`));
    const s = weave.progress.get(canon(p));
    return text(`Still weaving ${canon(p)}${s ? ` (${s.done} of ${s.total} passages embedded)` : ""}. It continues in the background; call weave_list to see where it is. Searches include the folder once it finishes.`);
  }
  return text(`Wove ${r.folder}: ${r.files} files, ${r.passages} passages (${r.embedded} embedded now, ${r.reused} files unchanged, ${r.removed} removed) in ${r.secs.toFixed(1)} s.`);
});

server.registerTool("weave_search", {
  title: "Search the weave",
  description: "Search the woven folders in plain language: where something is defined, handled, configured or explained. Returns the nearest passages with their file, line range and centred-cosine score. Use it before grep when you do not know the identifier or file name.",
  inputSchema: {
    query: z.string().describe("What to find, in plain words or code"),
    k: z.number().int().min(1).max(24).optional().describe("How many passages (default 8)"),
    folder: z.string().optional().describe("Search only this woven folder"),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ query, k, folder }) => {
  const { hits, notes } = await weave.search(query, k || 8, folder);
  if (!hits.length) return text("No passages matched.");
  const body = hits.map((h, i) => `${i + 1}. ${h.path}:${h.start}-${h.end}${h.label ? ` (${h.label})` : ""}  score ${h.score.toFixed(3)}\n${h.text}`).join("\n\n");
  return text((notes.length ? `Note: ${notes.join("; ")}\n\n` : "") + body);
});

server.registerTool("weave_list", {
  title: "List woven folders",
  description: "List the folders this server has indexed, with their file and passage counts.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async () => {
  const list = weave.store.folders().map((f) => `${f.folder}: ${f.files} files, ${f.passages} passages, updated ${f.updated}`);
  for (const [f, s] of weave.progress) list.push(`${f}: weaving, ${s.done} of ${s.total} passages embedded`);
  return text(list.length ? list.join("\n") : "Nothing is woven yet.");
});

server.registerTool("weave_forget", {
  title: "Forget a woven folder",
  description: "Delete a folder's index from this machine. The folder's own files are not touched.",
  inputSchema: { path: z.string().describe("The woven folder") },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
}, async ({ path: p }) => {
  const folder = canon(p);
  weave.loaded.delete(folder);
  return text(weave.store.forget(folder) ? `Forgot ${folder}.` : `${folder} was not woven.`);
});

await server.connect(new StdioServerTransport());
log(`blackwindow-weave-mcp ${VERSION}, index at ${cache}`);
for (const f of many("--folder")) {
  weave.weave(f, (done, total) => { if (done === total || done % 512 < 32) log(`${f}: ${done} of ${total} passages embedded`); })
    .then((r) => log(`wove ${r.folder}: ${r.files} files, ${r.passages} passages in ${r.secs.toFixed(1)} s`))
    .catch((e) => log(`${f}: ${e.message || e}`));
}
