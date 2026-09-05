/**
 * Best-effort consumer scanner: find string references to API paths / fields in a folder.
 */

import * as fs from "fs";
import * as path from "path";
import type { BreakingChange } from "./diff";

export type ConsumerHit = {
  consumer: string;
  file: string;
  line: number;
  snippet: string;
  matched: string;
  relatedChanges: string[];
  risk: "HIGH" | "MED" | "LOW";
};

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".kt", ".rb"]);

function walk(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (CODE_EXT.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function tokensFromChanges(changes: BreakingChange[]): Map<string, BreakingChange[]> {
  const map = new Map<string, BreakingChange[]>();
  const add = (token: string, change: BreakingChange) => {
    if (!token) return;
    const list = map.get(token) || [];
    list.push(change);
    map.set(token, list);
  };

  for (const c of changes) {
    add(c.path, c);
    if (c.property) {
      add(c.property, c);
      const leaf = c.property.split(".").pop();
      if (leaf) add(leaf, c);
    }
  }
  return map;
}

export function scanConsumers(
  rootDir: string,
  changes: BreakingChange[]
): ConsumerHit[] {
  const tokenMap = tokensFromChanges(changes);
  const tokens = [...tokenMap.keys()].sort((a, b) => b.length - a.length);
  const hits: ConsumerHit[] = [];
  const files = walk(rootDir);

  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const consumer = rel.split(path.sep)[0] || rel;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

    lines.forEach((line, idx) => {
      for (const token of tokens) {
        if (!line.includes(token)) continue;
        const related = tokenMap.get(token) || [];
        const risk = related.some((c) => c.severity === "HIGH")
          ? "HIGH"
          : related.some((c) => c.severity === "MED")
            ? "MED"
            : "LOW";
        hits.push({
          consumer,
          file: rel,
          line: idx + 1,
          snippet: line.trim().slice(0, 160),
          matched: token,
          relatedChanges: related.map((c) => c.summary),
          risk,
        });
        break; // one match per line is enough for MVP
      }
    });
  }

  return hits.sort((a, b) => {
    const rank = { HIGH: 0, MED: 1, LOW: 2 };
    return rank[a.risk] - rank[b.risk] || a.file.localeCompare(b.file);
  });
}
