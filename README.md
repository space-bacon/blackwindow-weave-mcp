# blackwindow-weave-mcp

Semantic search over the folders on your machine, for any MCP client. The server cuts source code and documentation into
passages, embeds them with [Motherlode](https://huggingface.co/RiverRider/motherlode-code-small-en-v0.1), a 33M-parameter
code-search encoder, on your CPU, and answers questions such as "where is a pairing line parsed into url, key and name"
with file paths, line ranges and the passages themselves.

The only network requests are to huggingface.co on the first run: six requests, which leave five files, 133,752,819
bytes, in the cache. With the files cached, a run makes none.

This is the weave from [Black Window](https://blackwindow.xyz) and the
[Sunstone](https://marketplace.visualstudio.com/items?itemName=sunstonenorth.sunstone) VS Code extension, packaged for
clients that speak the Model Context Protocol. It runs on macOS, Linux and Windows with Node 20 or later.

## Install

Install it once from a terminal, before adding it to a client. This installs the package and ONNX Runtime and prints
the version once the runtime has loaded:

```sh
npx -y blackwindow-weave-mcp@0.1.1 --version
```

On GitHub's hosted runners, from an empty npm cache, this first install took 7 to 13 s on Linux and macOS and 55 to
69 s on Windows. Clients wait a limited time for a server to start (the MCP SDK's default is 60 s), and a client that
stops waiting in the middle of an install leaves a broken copy in npm's cache (see [Troubleshooting](#troubleshooting)).
Once installed, the server starts in under 3 s.

Keep the version in the client's configuration the same as here. With a version given, npx starts the copy it
installed; with the bare name, npx (npm 11) looks for a newer version on every start and installs it while the client
waits.

On Linux x64, ONNX Runtime also downloads 236 MB of CUDA libraries during the install. This server runs on the CPU and
never loads them, so you can skip them:

```sh
ONNXRUNTIME_NODE_INSTALL=skip npx -y blackwindow-weave-mcp@0.1.1 --version
```

## Add it to a client

### macOS and Linux

Claude Code:

```sh
claude mcp add weave -- npx -y blackwindow-weave-mcp@0.1.1 --folder /path/to/your/repo
```

VS Code, in `.vscode/mcp.json`:

```json
{
  "servers": {
    "weave": { "type": "stdio", "command": "npx", "args": ["-y", "blackwindow-weave-mcp@0.1.1", "--folder", "${workspaceFolder}"] }
  }
}
```

Cursor, Claude Desktop, Windsurf and most other clients:

```json
{
  "mcpServers": {
    "weave": { "command": "npx", "args": ["-y", "blackwindow-weave-mcp@0.1.1", "--folder", "/path/to/your/repo"] }
  }
}
```

### Windows

On Windows `npx` is a batch file, which a client can only start through `cmd /c`. Claude Code:

```sh
claude mcp add weave -- cmd /c npx -y blackwindow-weave-mcp@0.1.1 --folder C:\path\to\your\repo
```

Cursor, Claude Desktop, Windsurf and most other clients:

```json
{
  "mcpServers": {
    "weave": { "command": "cmd", "args": ["/c", "npx", "-y", "blackwindow-weave-mcp@0.1.1", "--folder", "C:/path/to/your/repo"] }
  }
}
```

In VS Code the same `command` and `args` go under `servers` in `.vscode/mcp.json`, with `"type": "stdio"`.

### Installed globally

`npm install -g blackwindow-weave-mcp@0.1.1` installs a `blackwindow-weave-mcp` command, which a client can start
directly (`cmd /c blackwindow-weave-mcp` on Windows). To run from this repository instead of npm, replace
`blackwindow-weave-mcp@0.1.1` in the arguments with `github:space-bacon/blackwindow-weave-mcp`.

| option | meaning |
| --- | --- |
| `--folder <path>` | Weave this folder when the server starts. Repeatable. Optional: the model can call `weave_folder` itself. |
| `--cache <dir>` | Where the encoder and the indexes live. Default `~/.cache/blackwindow-weave` (on Windows `%USERPROFILE%\.cache\blackwindow-weave`), or `BLACKWINDOW_WEAVE_CACHE`. |
| `--version` | Print the version and exit. |

## Platforms

Every push runs [CI](.github/workflows/test.yml) on Linux (x64 and arm64), Windows (x64) and macOS (Apple silicon),
each with Node 20, 22 and 24. Each job runs the stdio smoke test below from a checkout. It then installs the packed
package through npx from an empty npm cache, starts it the way a client does and weaves a folder. On Windows it also
starts it through `cmd /c`. Last, it installs the package globally and starts it by its command. Other platforms,
such as Windows on Arm, Intel Macs and Alpine Linux, are not tested.

## Troubleshooting

**The client times out when it first starts the server, or the server stops with `Cannot find module ...
transformers.node.mjs`.** A first install was interrupted, usually by a client that stopped waiting, and npm kept the
half-installed copy. Delete npm's npx cache and install again from a terminal with the line under [Install](#install):

- macOS and Linux: `rm -rf ~/.npm/_npx`
- Windows (PowerShell): `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\npm-cache\_npx"`

**Updating.** Install the new version from a terminal as above, then change the version in the client's
configuration.

## Tools

| tool | what it does |
| --- | --- |
| `weave_folder` | Index a folder, or bring its index up to date. Only files whose size or modification time changed are read again. A run longer than 25 s returns at once and continues in the background. |
| `weave_search` | The passages nearest a plain-language or code query, with file, line range and score. Searches the folders woven in this session, or every woven folder if none was, or one folder when asked. |
| `weave_list` | The woven folders with their file and passage counts, and any weave still running. |
| `weave_forget` | Delete a folder's index. The folder's files are not touched. |

## Measured

On an Apple M2 Ultra (24 CPU cores, Node 24.4.1), through the MCP SDK's own stdio client, in `test/smoke.mjs`:

| folder | files | passages | first weave | second weave | search |
| --- | --- | --- | --- | --- | --- |
| this package's `src/` | 6 | 42 | 3.8 s, with the encoder's download | 0.013 s | 5 to 6 ms |
| the Sunstone repository | 57 | 1,367 | 20.2 s | 0.014 s | 6 ms |

Embedding runs at about 68 passages a second on that machine, so a repository of 10,000 passages takes about two and a
half minutes the first time. Those figures are one run each on one machine. The smoke test's three questions about this
package's own source each return the expected file first; they are a check that the pieces are wired together, not a
measure of retrieval quality. For retrieval quality see the [model card](https://huggingface.co/RiverRider/motherlode-code-small-en-v0.1).

## How it works

- **Files.** A git work tree is listed by git, so `.gitignore` holds. Any other folder is walked, skipping
  `node_modules`, build output, virtual environments, lock files and minified files. Files over 1 MB and files that
  read as binary are skipped. JSON and XML are left out: in the Sunstone repository, result files under
  `bench/results/` took ranks 2 and 3 of the question above when they were included.
- **Passages.** Code is cut at definitions into passages of about 700 characters, each labelled with the nearest
  definition. Prose is cut at paragraphs and sentences into passages of about 420 characters. The chunkers are Black
  Window's.
- **Encoder.** `onnx/model.onnx` (fp32) through [transformers.js](https://github.com/huggingface/transformers.js) and
  ONNX Runtime on the CPU, CLS pooling.
- **Centring.** Every vector has the model's shipped mean (`centring/mean_shipped.json`) subtracted and is brought back
  to unit length, so a score is a cosine after centring.
- **Search.** Exact: every passage is scored. Before answering, a folder not checked in the last 30 s is brought up to
  date if fewer than 200 of its files changed; otherwise the answer says the index is stale.
- **Index.** One per folder under `<cache>/index/`: a Float32 matrix and a JSONL of passages, named by a manifest that
  is written to a temporary file and renamed into place, so an interrupted write leaves the previous index. An index
  that cannot be read is moved aside rather than overwritten.

## Licence

[Business Source License 1.1](LICENSE) with an internal-use grant. You may use it for any internal purpose, including
commercial development on your own or your employer's code, with no limit on seats. You may not offer it to others as
a hosted search service or ship it inside a product you supply. On 15 September 2030 it becomes Apache-2.0. The encoder
is downloaded under its own licence, which has the same shape. For other terms, write to burton@sunstonenorth.com.
