import fs from "node:fs";
import path from "node:path";

import type { Catalog } from "./catalog.js";

export const I18N_DIR = path.join(__dirname, "..", "..", "src", "i18n");
const SRC_DIR = path.join(__dirname, "..", "..", "src");

export function readJson(file: string): Catalog {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Catalog) : {};
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

let sources: Array<{ file: string; lines: string[] }> | null = null;

/** Where the app uses a key (`file:line`), as context for translator and reviewer. */
export function usedIn(key: string): string[] {
  sources ??= walk(SRC_DIR)
    .filter((file) => file.endsWith(".ts") && !file.includes(`${path.sep}i18n${path.sep}`))
    .map((file) => ({ file: path.relative(path.join(SRC_DIR, ".."), file), lines: fs.readFileSync(file, "utf8").split("\n") }));
  const base = key.replace(/_(zero|one|two|few|many|other)$/, "");
  const out: string[] = [];
  for (const { file, lines } of sources) {
    lines.forEach((line, i) => {
      if (line.includes(`"${base}"`)) out.push(`${file}:${i + 1}`);
    });
  }
  return out;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );
}
