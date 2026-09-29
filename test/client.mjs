// Checks any stdio MCP server with the reference SDK's own client: connect, list the tools, call one, print JSON.
//
//   MCP_TOOL=<name> MCP_ARGS='<json>' node test/client.mjs <command> [args...]
//
// Exits 0 when the server initialises, lists MCP_TOOL and answers the call without an error.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [command, ...args] = process.argv.slice(2);
const tool = process.env.MCP_TOOL || "", input = JSON.parse(process.env.MCP_ARGS || "{}");
const client = new Client({ name: "client-check", version: "0" });
const out = { command: [command, ...args].join(" ") };
try {
  const transport = new StdioClientTransport({ command, args, stderr: "pipe" });
  // The client hands the negotiated version to a transport that asks for it; stdio does not, so ask here.
  out.protocol = null;
  transport.setProtocolVersion = (v) => { out.protocol = v; };
  await client.connect(transport);
  out.server = client.getServerVersion();
  out.instructions = client.getInstructions() ?? null;
  out.tools = (await client.listTools()).tools.map((t) => t.name);
  if (tool) {
    const t0 = Date.now(), r = await client.callTool({ name: tool, arguments: input }, undefined, { timeout: 300_000 });
    out.call = { tool, isError: !!r.isError, secs: (Date.now() - t0) / 1000, text: r.content.map((c) => c.text).join("\n") };
  }
  out.ok = !tool || (out.tools.includes(tool) && !out.call.isError);
} catch (e) {
  out.ok = false;
  out.error = String(e?.message || e);
}
await client.close().catch(() => {});
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
