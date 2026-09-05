import cors from "cors";
import express, { Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { loadOpenApi } from "../parser";
import { diffOpenApi, overallRisk, scanConsumers } from "../dependency-engine";
import type { BreakingChange, ConsumerHit } from "../dependency-engine";

const ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "fixtures");
const CONSUMERS = path.join(ROOT, "sample-consumers");

export type Report = {
  generatedAt: string;
  risk: "HIGH" | "MED" | "LOW";
  summary: string;
  breakingChanges: BreakingChange[];
  consumers: ConsumerHit[];
  aiExplanation: string;
};

let lastReport: Report | null = null;

export function buildReport(v1Path?: string, v2Path?: string, consumersDir?: string): Report {
  const left = v1Path || path.join(FIXTURES, "openapi-v1.json");
  const right = v2Path || path.join(FIXTURES, "openapi-v2.json");
  const scanRoot = consumersDir || CONSUMERS;

  const v1 = loadOpenApi(JSON.parse(fs.readFileSync(left, "utf8")));
  const v2 = loadOpenApi(JSON.parse(fs.readFileSync(right, "utf8")));
  const breakingChanges = diffOpenApi(v1, v2);
  const consumers = scanConsumers(scanRoot, breakingChanges);
  const risk = overallRisk(breakingChanges);

  const summary = [
    `Compared ${path.basename(left)} → ${path.basename(right)}.`,
    `Found ${breakingChanges.length} breaking/notable change(s).`,
    `Overall risk: ${risk}.`,
    `Matched ${consumers.length} consumer reference(s) under ${path.basename(scanRoot)}.`,
  ].join(" ");

  const aiExplanation = [
    "[AI stub] Breaking-change narrative based only on the diff engine output:",
    ...breakingChanges.slice(0, 8).map((c) => `- (${c.severity}) ${c.summary}`),
    consumers.length
      ? `Potential blast radius includes: ${[...new Set(consumers.map((c) => c.consumer))].join(", ")}.`
      : "No static consumer references matched (false negatives possible).",
    "Citations: change kinds from diffOpenApi; consumer hits from scanConsumers.",
  ].join("\n");

  return {
    generatedAt: new Date().toISOString(),
    risk,
    summary,
    breakingChanges,
    consumers,
    aiExplanation,
  };
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", root: ROOT });
  });

  app.post("/diff", (req: Request, res: Response) => {
    try {
      const report = buildReport(req.body?.v1Path, req.body?.v2Path, req.body?.consumersDir);
      lastReport = report;
      res.json(report);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/report", (_req, res) => {
    if (!lastReport) {
      lastReport = buildReport();
    }
    res.json(lastReport);
  });

  app.get("/", (_req, res) => {
    res.type("html").send(renderDashboard(lastReport || buildReport()));
  });

  return app;
}

function badge(risk: string): string {
  const cls = risk === "HIGH" ? "high" : risk === "MED" ? "med" : "low";
  return `<span class="badge ${cls}">${risk}</span>`;
}

function renderDashboard(report: Report): string {
  const changesRows = report.breakingChanges
    .map(
      (c) => `<tr>
      <td>${badge(c.severity)}</td>
      <td>${c.kind}</td>
      <td class="mono">${c.method ? c.method.toUpperCase() + " " : ""}${escapeHtml(c.path)}</td>
      <td>${escapeHtml(c.property || "—")}</td>
      <td>${escapeHtml(c.summary)}</td>
    </tr>`
    )
    .join("");

  const consumerRows = report.consumers
    .map(
      (c) => `<tr>
      <td>${badge(c.risk)}</td>
      <td>${escapeHtml(c.consumer)}</td>
      <td class="mono">${escapeHtml(c.file)}:${c.line}</td>
      <td class="mono">${escapeHtml(c.matched)}</td>
      <td>${escapeHtml(c.snippet)}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API Change Intelligence</title>
  <style>
    :root {
      --bg: #10150f; --panel: #1a2318; --border: #2f3d2c; --text: #eef5ea;
      --muted: #93a490; --accent: #6fbf73; --fail: #e86b5c; --warn: #e0b34d; --ok: #6fbf73;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
      color: var(--text);
      background: radial-gradient(ellipse at top left, #243322 0%, var(--bg) 50%);
      min-height: 100vh;
    }
    header { padding: 1.5rem 2rem 1rem; border-bottom: 1px solid var(--border); }
    h1 { margin: 0; font-size: 1.4rem; }
    p { color: var(--muted); }
    .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    button {
      background: var(--accent); color: #0b120c; border: none; border-radius: 6px;
      padding: 0.5rem 0.9rem; font-weight: 700; cursor: pointer;
    }
    main { padding: 1rem 2rem 2rem; display: grid; gap: 1rem; }
    section {
      background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 1rem;
    }
    h2 { margin: 0 0 0.75rem; font-size: 0.85rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th, td { text-align: left; padding: 0.45rem 0.35rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; }
    .badge { display: inline-block; padding: 0.12rem 0.45rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
    .high { background: rgba(232,107,92,0.2); color: var(--fail); }
    .med { background: rgba(224,179,77,0.2); color: var(--warn); }
    .low { background: rgba(111,191,115,0.18); color: var(--ok); }
    pre { white-space: pre-wrap; background: #0d120c; border: 1px solid var(--border); border-radius: 8px; padding: 0.9rem; }
  </style>
</head>
<body>
  <header>
    <h1>API Change Intelligence</h1>
    <p>${escapeHtml(report.summary)} Overall risk: ${badge(report.risk)}</p>
    <div class="actions">
      <button type="button" onclick="runDiff()">Run diff (v1 → v2)</button>
    </div>
  </header>
  <main>
    <section>
      <h2>Breaking changes</h2>
      <table>
        <thead><tr><th>Risk</th><th>Kind</th><th>Endpoint</th><th>Property</th><th>Summary</th></tr></thead>
        <tbody>${changesRows || '<tr><td colspan="5">No changes</td></tr>'}</tbody>
      </table>
    </section>
    <section>
      <h2>Potential consumers</h2>
      <table>
        <thead><tr><th>Risk</th><th>Consumer</th><th>Location</th><th>Matched</th><th>Snippet</th></tr></thead>
        <tbody>${consumerRows || '<tr><td colspan="5">No consumer hits</td></tr>'}</tbody>
      </table>
    </section>
    <section>
      <h2>AI explanation (stub)</h2>
      <pre>${escapeHtml(report.aiExplanation)}</pre>
    </section>
  </main>
  <script>
    async function runDiff() {
      const res = await fetch('/diff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) { alert('Diff failed'); return; }
      location.reload();
    }
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const port = Number(process.env.PORT || 8006);
if (require.main === module) {
  const app = createApp();
  app.listen(port, () => {
    console.log(`API Change Intelligence listening on http://localhost:${port}`);
  });
}
