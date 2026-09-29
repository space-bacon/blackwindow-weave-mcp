// Passages as Black Window's engine cuts them (engine/index.html, chunkCode and chunkText), so the reader sees the
// shapes it was measured on. Each passage also keeps the line range it came from, which the engine does not need.

const DEF = /^\s*(?:export\s+|pub(?:\([^)]*\))?\s+|static\s+|async\s+|default\s+|abstract\s+|private\s+|public\s+|protected\s+|final\s+)*(?:def|fn|func|function|class|struct|enum|impl|trait|interface|type|const|let|var|module|package|proc|sub|macro_rules!|@\w+)\b\s*([A-Za-z_$][\w$]*)?|^\s*([A-Za-z_$][\w$.]*)\s*(?:=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|\([^)]*\)\s*(?::[^{]*)?\{\s*$)/;

/** Source code: blank-line blocks packed into windows of about `target` characters, cut at line ends, each labelled
 *  with the file's name and the nearest definition above it. */
export function chunkCode(text, name = "", target = 700) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out = [];
  let cur = [], curLen = 0, label = "", curLabel = "", curStart = 1, curEnd = 1;
  const base = String(name || "").split("/").pop();
  const flush = () => {
    const t = cur.join("\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
    if (t.length >= 24 && /[A-Za-z]{2}/.test(t)) out.push({ text: `[${base}${curLabel ? `: ${curLabel}` : ""} @L${curStart}] ${t}`, label: curLabel, start: curStart, end: curEnd });
    cur = []; curLen = 0; curLabel = label;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const m = raw.match(DEF); if (m) label = (m[1] || m[2] || raw.trim().slice(0, 40)).slice(0, 48);
    if (!cur.length) { curLabel = label; curStart = i + 1; }
    if (curLen + raw.length > target && cur.length) { flush(); curLabel = label; curStart = i + 1; }
    if (!raw.trim() && !cur.length) continue;
    if (raw.length > target * 2) {
      if (cur.length) flush();
      for (let o = 0; o < raw.length; o += target * 2) { cur = [raw.slice(o, o + target * 2)]; curLen = cur[0].length; curLabel = label; curStart = curEnd = i + 1; flush(); }
      continue;
    }
    cur.push(raw); curLen += raw.length + 1; curEnd = i + 1;
  }
  flush();
  return out;
}

/** Prose (Markdown, reStructuredText, plain text): paragraphs and table rows under their section heading, packed to
 *  about `target` characters. Line ranges are the paragraph's. */
export function chunkText(text, name = "", target = 420) {
  const lines = text.replace(/\r/g, "").split("\n");
  const clean = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`]{1,3}/g, "").replace(/(^|[\s(])_{1,3}(?=\S)|(?<=\S)_{1,3}(?=[\s).,;:]|$)/g, "$1");
  const blocks = [];
  let cur = [], start = 0, end = 0, section = "", head = null, fence = false;
  const flush = () => { if (cur.length) { blocks.push({ section, text: cur.join(" "), start, end }); cur = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^```/.test(l)) { fence = !fence; flush(); continue; }
    if (fence) continue;
    if (!l) { flush(); head = null; continue; }
    if (l.startsWith("|")) {
      if (/^\|[\s:|-]+\|?$/.test(l)) continue;
      const cells = l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => clean(c.trim()));
      if (!head) { head = cells; continue; }
      flush();
      blocks.push({ section, text: cells.map((v, k) => (head[k] && v ? `${head[k]} ${v}` : v)).filter(Boolean).join("; "), start: i + 1, end: i + 1 });
      continue;
    }
    head = null;
    if (/^[-|:\s]+$/.test(l) || /^!\[/.test(l) || /^<\/?\w/.test(l)) continue;
    const h = l.match(/^#{1,6}\s+(.*)$/);
    if (h) { flush(); section = h[1].replace(/[*`]/g, "").replace(/^[\d.]+\s*/, "").trim(); continue; }
    if (!cur.length) start = i + 1;
    cur.push(clean(l).replace(/^\s*[-*>]\s+/, "")); end = i + 1;
  }
  flush();
  const base = String(name || "").split("/").pop(), out = [];
  for (const b of blocks) {
    const p = b.text.replace(/\s+/g, " ").trim();
    if (p.length < 60 || !/[a-z]{3}/i.test(p)) continue;
    const pre = `[${base}${b.section ? `: ${b.section}` : ""}] `;
    if (p.length <= target * 1.5) { out.push({ text: pre + p, label: b.section, start: b.start, end: b.end }); continue; }
    let c = "";
    const pieces = p.split(/(?<=[.!?])\s+/).flatMap((s) => s.length <= target * 2 ? [s] : (s.match(new RegExp(`.{1,${target}}(?:\\s|$)`, "g")) || [s]).map((x) => x.trim()));
    for (const s of pieces) { if (c && c.length + s.length > target) { out.push({ text: pre + c, label: b.section, start: b.start, end: b.end }); c = s; } else c = c ? c + " " + s : s; }
    if (c.length >= 60) out.push({ text: pre + c, label: b.section, start: b.start, end: b.end });
  }
  return out;
}

const PROSE = /\.(md|markdown|mdx|rst|txt|adoc)$/i;
export const chunk = (text, file) => (PROSE.test(file) ? chunkText(text, file) : chunkCode(text, file));
