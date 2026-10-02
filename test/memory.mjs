// End to end over stdio: keep notes with weave_remember, find them with weave_search beside code, write several at once,
// and find them again from a second server that shares the folders. Exits 1 on any miss.
//
//   node test/memory.mjs      (WEAVE_TEST_CACHE=<dir> reuses a downloaded encoder between runs)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "..");
const ownCache = !process.env.WEAVE_TEST_CACHE;
const cache = process.env.WEAVE_TEST_CACHE || fs.mkdtempSync(path.join(os.tmpdir(), "weave-notes-cache-"));
const notes = fs.mkdtempSync(path.join(os.tmpdir(), "weave-notes-"));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };

async function open() {
  const client = new Client({ name: "notes", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [path.join(root, "src/index.js"), "--cache", cache, "--memory", notes],
    env: { ...process.env, BLACKWINDOW_WEAVE_WAIT_MS: "600000" }, stderr: "ignore",
  }));
  const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 600_000 }); return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError }; };
  return { client, call };
}
const allNotes = () => fs.existsSync(notes) ? fs.readdirSync(notes, { recursive: true }).filter((f) => f.endsWith(".md")).map((f) => path.join(notes, f)).sort() : [];
const topFile = (text) => ([...text.matchAll(/^\d+\. (\S+?):\d+-\d+/gm)][0] || [])[1] || "";
const same = (a, b) => path.resolve(a) === path.resolve(b);

const PUMPKIN = { label: "Pumpkin store", note: "Q: Which database file holds the pumpkin inventory? A: The pumpkin inventory lives in a SQLite file called gourds.db, decided on 2 October." };
const FERRY = { label: "Ferry", note: "The ferry to Tangier leaves at 07:40 from the new terminal, and the user prefers the window seat." };
const AT_ONCE = [
  [{ label: "Lamp", note: "The brass lamp in the hall was repaired on Tuesday by Ines, who charged forty euros." }, "who repaired the brass lamp and what did it cost"],
  [{ label: "Harbour", note: "The harbour master in Essaouira is called Rachid, and the boats come in at five in the morning." }, "who is the harbour master and when do the boats come in"],
  [{ label: "Cheese", note: "The goat cheese from the market in Chefchaouen costs twelve dirhams a round, and Salma sells it on Fridays." }, "how much is the goat cheese and who sells it"],
];

// One server: a folder of code and the notes, searched together.
const a = await open();
check((await a.client.listTools()).tools.some((t) => t.name === "weave_remember"), "weave_remember is listed");
check((await a.call("weave_folder", { path: path.join(root, "src") })).text.startsWith("Wove "), "a code folder is woven");

const kept = [];
for (const n of [PUMPKIN, FERRY]) {
  const before = new Set(allNotes()), r = await a.call("weave_remember", n);
  const file = allNotes().find((f) => !before.has(f));
  kept.push(file);
  check(r.text.startsWith("Kept ") && !!file, `"${n.label}" is kept: ${path.relative(notes, file || "") || r.text.slice(0, 80)}`);
  if (file && process.platform !== "win32") check((fs.statSync(file).mode & 0o777) === 0o600, `"${n.label}" is readable by this user only`);
  if (file) check(fs.readFileSync(file, "utf8").includes(n.note), `"${n.label}" holds the note's text`);
}
check(same(topFile((await a.call("weave_search", { query: "which database file holds the pumpkin inventory", k: 3 })).text), kept[0]), "a note is found beside the code, with no folder named");
check(same(topFile((await a.call("weave_search", { query: "what time does the ferry leave and which seat does the user like", k: 3 })).text), kept[1]), "a second note is found");
check(topFile((await a.call("weave_search", { query: "where is the index written to disk so an interrupted write keeps the old one", k: 3 })).text).endsWith("store.js"), "the code question still ranks store.js first");
check(same(topFile((await a.call("weave_search", { query: "which database file holds the pumpkin inventory", k: 3, folder: notes })).text), kept[0]), "a search limited to the notes folder finds it");
check((await a.call("weave_list", {})).text.includes("(kept notes)"), "weave_list marks the notes folder");

// Notes written at once from one client: each is indexed, though a weave may already be running when it is written.
const before = new Set(allNotes());
const results = await Promise.all(AT_ONCE.map(([n]) => a.call("weave_remember", n)));
const fresh = allNotes().filter((f) => !before.has(f));
check(results.every((r) => r.text.startsWith("Kept ")) && fresh.length === AT_ONCE.length, `${AT_ONCE.length} notes written at once are all kept`);
for (const [n, q] of AT_ONCE) {
  const top = topFile((await a.call("weave_search", { query: q, k: 3 })).text);
  check(!!top && fs.readFileSync(top, "utf8").includes(n.note), `"${n.label}", written at once, is found`);
}
await a.client.close();

// A second server on the same folders, with no weave_folder call: the notes are still there.
const b = await open();
check(same(topFile((await b.call("weave_search", { query: "which database file holds the pumpkin inventory", k: 3 })).text), kept[0]), "a new server finds the first note");
const top = topFile((await b.call("weave_search", { query: AT_ONCE[0][1], k: 3 })).text);
check(!!top && fs.readFileSync(top, "utf8").includes(AT_ONCE[0][0].note), "a new server finds a note written at once");
await b.client.close();

fs.rmSync(notes, { recursive: true, force: true });
if (ownCache) fs.rmSync(cache, { recursive: true, force: true });
console.log(`${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
