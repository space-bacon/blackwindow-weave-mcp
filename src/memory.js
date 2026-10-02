import fs from "node:fs";
import path from "node:path";

const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

/** Write one note as <dir>/<day>/<time>-<label>.md, readable by this user only, and return its path and its path
 *  relative to <dir>. The file name is built from the label's letters and digits alone, so a label cannot leave <dir>. */
export function keepNote(dir, { note, label }, now = new Date()) {
  const iso = now.toISOString(), day = iso.slice(0, 10), time = iso.slice(11, 19).replace(/:/g, "");
  const title = (label || "").replace(/\s+/g, " ").trim() || "Note";
  const folder = path.join(dir, day);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const base = `${time}-${slug(title) || "note"}`, body = `# ${title}\n\nKept ${iso}\n\n${note.trim()}\n`;
  for (let n = 1; ; n++) {
    const name = `${base}${n > 1 ? `-${n}` : ""}.md`;
    try {
      fs.writeFileSync(path.join(folder, name), body, { flag: "wx", mode: 0o600 });
      return { file: path.join(folder, name), rel: `${day}/${name}` };
    } catch (e) { if (e.code !== "EEXIST" || n > 99) throw e; }
  }
}
