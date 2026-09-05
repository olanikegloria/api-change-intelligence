import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { loadOpenApi } from "../parser";
import { diffOpenApi, overallRisk, scanConsumers } from "../dependency-engine";
import type { BreakingChange, ConsumerHit } from "../dependency-engine";
import { accounts, type AuthContext } from "./accounts";
import { groundedComplete } from "../ai/ollamaClient";

const ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "fixtures");
const CONSUMERS = path.join(ROOT, "sample-consumers");

export type MergeRisk = {
  can_merge_recommendation: "block" | "review" | "allow";
  reasons: string[];
};

export type Report = {
  generatedAt: string;
  risk: "HIGH" | "MED" | "LOW";
  summary: string;
  breakingChanges: BreakingChange[];
  consumers: ConsumerHit[];
  aiExplanation: string;
  ai_provider: "ollama" | "fallback";
  can_merge_recommendation: MergeRisk["can_merge_recommendation"];
  reasons: string[];
};

let lastReport: Report | null = null;

/** Deterministic merge gate from breaking-change count + consumer hits. */
export function computeMergeRisk(
  breakingChanges: BreakingChange[],
  consumers: ConsumerHit[]
): MergeRisk {
  const high = breakingChanges.filter((c) => c.severity === "HIGH").length;
  const med = breakingChanges.filter((c) => c.severity === "MED").length;
  const consumerOrgs = [...new Set(consumers.map((c) => c.consumer))];
  const reasons: string[] = [];

  if (breakingChanges.length === 0) {
    reasons.push("No breaking/notable OpenAPI changes detected.");
    return { can_merge_recommendation: "allow", reasons };
  }

  reasons.push(
    `${breakingChanges.length} breaking/notable change(s) (${high} HIGH, ${med} MED).`
  );
  if (consumers.length > 0) {
    reasons.push(
      `${consumers.length} consumer hit(s) across: ${consumerOrgs.join(", ")}.`
    );
  } else {
    reasons.push("No static consumer references matched (false negatives possible).");
  }

  if (high >= 1 && consumers.length > 0) {
    reasons.push("HIGH-severity change(s) with known consumer blast radius → block.");
    return { can_merge_recommendation: "block", reasons };
  }
  if (high >= 2) {
    reasons.push("Multiple HIGH-severity changes without confirmed consumers → review.");
    return { can_merge_recommendation: "review", reasons };
  }
  if (breakingChanges.length > 0) {
    reasons.push("Breaking or notable changes present → human review before merge.");
    return { can_merge_recommendation: "review", reasons };
  }
  return { can_merge_recommendation: "allow", reasons };
}

function fallbackAiExplanation(
  breakingChanges: BreakingChange[],
  consumers: ConsumerHit[]
): string {
  return [
    "Breaking-change narrative based only on the diff engine output:",
    ...breakingChanges.slice(0, 8).map((c) => `- (${c.severity}) ${c.summary}`),
    consumers.length
      ? `Potential blast radius includes: ${[...new Set(consumers.map((c) => c.consumer))].join(", ")}.`
      : "No static consumer references matched (false negatives possible).",
    "Citations: change kinds from diffOpenApi; consumer hits from scanConsumers.",
  ].join("\n");
}

export async function buildReport(
  v1Path?: string,
  v2Path?: string,
  consumersDir?: string
): Promise<Report> {
  const left = v1Path || path.join(FIXTURES, "openapi-v1.json");
  const right = v2Path || path.join(FIXTURES, "openapi-v2.json");
  const scanRoot = consumersDir || CONSUMERS;

  const v1 = loadOpenApi(JSON.parse(fs.readFileSync(left, "utf8")));
  const v2 = loadOpenApi(JSON.parse(fs.readFileSync(right, "utf8")));
  const breakingChanges = diffOpenApi(v1, v2);
  const consumers = scanConsumers(scanRoot, breakingChanges);
  const risk = overallRisk(breakingChanges);
  const merge = computeMergeRisk(breakingChanges, consumers);

  const summary = [
    `Compared ${path.basename(left)} → ${path.basename(right)}.`,
    `Found ${breakingChanges.length} breaking/notable change(s).`,
    `Overall risk: ${risk}.`,
    `Matched ${consumers.length} consumer reference(s) under ${path.basename(scanRoot)}.`,
    `Merge recommendation: ${merge.can_merge_recommendation}.`,
  ].join(" ");

  const deterministic = fallbackAiExplanation(breakingChanges, consumers);
  const evidence = JSON.stringify(
    {
      summary,
      risk,
      merge,
      breakingChanges,
      consumers,
    },
    null,
    2
  );

  const ai = await groundedComplete({
    task:
      "Write a concise merge-review narrative for this OpenAPI diff. " +
      "Use ONLY the JSON evidence (diff + consumers). Do not invent endpoints or services.",
    evidence,
    question: "What should reviewers know before merging this API change?",
  });

  return {
    generatedAt: new Date().toISOString(),
    risk,
    summary,
    breakingChanges,
    consumers,
    aiExplanation: ai.ok && ai.text ? ai.text : deterministic,
    ai_provider: ai.provider,
    can_merge_recommendation: merge.can_merge_recommendation,
    reasons: merge.reasons,
  };
}

type AuthedRequest = Request & { auth?: AuthContext };

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const ctx = accounts.resolveToken(token);
  if (!ctx) {
    res.status(401).json({
      error: "Missing or invalid Bearer token. Sign up/login or use demo token 'demo'.",
    });
    return;
  }
  req.auth = ctx;
  next();
}

export function createApp() {
  accounts.load();
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", root: ROOT, product: "api-change-intelligence" });
  });

  app.post("/auth/signup", (req, res) => {
    try {
      const { email, password, org_name } = req.body || {};
      const result = accounts.signup(String(email || ""), String(password || ""), String(org_name || ""));
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post("/auth/login", (req, res) => {
    try {
      const { email, password } = req.body || {};
      const result = accounts.login(String(email || ""), String(password || ""));
      res.json(result);
    } catch (err) {
      res.status(401).json({ error: (err as Error).message });
    }
  });

  app.get("/usage", requireAuth, (req: AuthedRequest, res) => {
    res.json(accounts.usageSnapshot(req.auth!.org_id));
  });

  app.post("/diff", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const report = await buildReport(req.body?.v1Path, req.body?.v2Path, req.body?.consumersDir);
      lastReport = report;
      accounts.recordDiff(req.auth!.org_id);
      res.json(report);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/report", requireAuth, async (_req, res) => {
    if (!lastReport) {
      lastReport = await buildReport();
    }
    res.json(lastReport);
  });

  app.get("/merge-risk", requireAuth, async (_req, res) => {
    if (!lastReport) {
      lastReport = await buildReport();
    }
    res.json({
      can_merge_recommendation: lastReport.can_merge_recommendation,
      reasons: lastReport.reasons,
      risk: lastReport.risk,
      aiExplanation: lastReport.aiExplanation,
      ai_provider: lastReport.ai_provider,
      generatedAt: lastReport.generatedAt,
    });
  });

  app.get("/", (_req, res) => {
    res.type("html").send(renderLanding());
  });

  app.get("/app", async (_req, res) => {
    if (!lastReport) {
      lastReport = await buildReport();
    }
    res.type("html").send(renderDashboard(lastReport));
  });

  app.get("/legal/terms", (_req, res) => {
    res.type("html").send(renderLegalTerms());
  });

  app.get("/legal/privacy", (_req, res) => {
    res.type("html").send(renderLegalPrivacy());
  });

  return app;
}

function badge(risk: string): string {
  const cls = risk === "HIGH" ? "high" : risk === "MED" ? "med" : "low";
  return `<span class="badge ${cls}">${risk}</span>`;
}

function renderLanding(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API Change Intelligence — catch breaking changes</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #10150f; --paper: #eef3ea; --leaf: #2f6b3a; --leaf-deep: #1a3d22;
      --line: rgba(16,21,15,.12); --muted: #5c6b58;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "Source Sans 3", system-ui, sans-serif; color: var(--ink);
      background:
        radial-gradient(1100px 560px at 80% -10%, rgba(47,107,58,.18), transparent 55%),
        radial-gradient(800px 420px at -8% 40%, rgba(196,122,44,.08), transparent 50%),
        linear-gradient(180deg, #f2f7ef 0%, var(--paper) 45%, #e4ebe0 100%);
      min-height: 100vh;
    }
    .wrap { width: min(1100px, calc(100% - 2.5rem)); margin: 0 auto; }
    nav { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 0; }
    .brand { font-weight: 700; letter-spacing: -0.03em; }
    .brand span { color: var(--leaf); }
    .nav-links { display: flex; gap: 1.25rem; align-items: center; font-size: .92rem; }
    .nav-links a { text-decoration: none; color: var(--muted); }
    .btn {
      display: inline-flex; text-decoration: none; border-radius: 8px; padding: .7rem 1.15rem;
      font-weight: 600; border: 1px solid transparent; transition: transform .2s ease;
    }
    .btn:hover { transform: translateY(-1px); }
    .btn-primary { background: var(--leaf); color: #f4faf5; }
    .btn-primary:hover { background: var(--leaf-deep); }
    .btn-ghost { background: transparent; border-color: var(--line); color: var(--ink); }
    .hero { padding: 3rem 0 4rem; display: grid; gap: 2rem; align-items: end; }
    @media (min-width: 900px) {
      .hero { grid-template-columns: 1.05fr .95fr; min-height: calc(100vh - 5.5rem); padding-top: 2rem; }
    }
    .product { font-size: .8rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--leaf); }
    h1 {
      margin: .35rem 0 .85rem; font-size: clamp(2.3rem, 5vw, 3.4rem); line-height: 1.05;
      letter-spacing: -.045em; max-width: 14ch;
    }
    .hero-copy p { margin: 0 0 1.5rem; color: var(--muted); font-size: 1.08rem; line-height: 1.55; max-width: 38ch; }
    .cta-row { display: flex; flex-wrap: wrap; gap: .75rem; }
    .hero-visual {
      min-height: 300px; border-radius: 18px; overflow: hidden; color: #e8f2ec;
      background: linear-gradient(145deg, #1a3d22 0%, #2f6b3a 45%, #10150f 100%);
      box-shadow: 0 28px 56px rgba(26,61,34,.28); animation: rise .9s ease both;
    }
    .terminal { padding: 1.4rem; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: .78rem; line-height: 1.55; }
    .dim { color: rgba(232,242,236,.55); } .hi { color: #f0c27a; } .fail { color: #ff8f7a; } .ok { color: #7ddeb0; }
    @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
    @keyframes fadeup { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    .hero-copy { animation: fadeup .7s ease both; }
    section.block { padding: 3.5rem 0; border-top: 1px solid var(--line); }
    section.block h2 { margin: 0 0 .6rem; font-size: clamp(1.55rem, 3vw, 2rem); letter-spacing: -.03em; }
    .lede { margin: 0 0 1.75rem; color: var(--muted); max-width: 48ch; line-height: 1.5; }
    .split { display: grid; gap: 1.25rem; }
    @media (min-width: 800px) { .split { grid-template-columns: 1fr 1fr; } }
    .point h3 { margin: 0 0 .4rem; font-size: 1.05rem; }
    .point p { margin: 0; color: var(--muted); line-height: 1.5; }
    footer {
      border-top: 1px solid var(--line); padding: 1.5rem 0 2.5rem; display: flex; flex-wrap: wrap;
      gap: 1rem; justify-content: space-between; color: var(--muted); font-size: .88rem;
    }
    footer a { color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <nav>
      <div class="brand">API <span>Change Intelligence</span></div>
      <div class="nav-links">
        <a href="#product">Product</a>
        <a href="/legal/terms">Terms</a>
        <a class="btn btn-primary" href="/app">Open app</a>
      </div>
    </nav>
    <header class="hero">
      <div class="hero-copy">
        <div class="product">API Change Intelligence</div>
        <h1>Catch breaking API changes before they ship.</h1>
        <p>Diff OpenAPI specs, score risk, and map blast radius across consumers — with orgs and API tokens on a free local stack.</p>
        <div class="cta-row">
          <a class="btn btn-primary" href="/app">Try the product</a>
          <a class="btn btn-ghost" href="#product">How it works</a>
        </div>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="terminal">
          <div class="dim">$ POST /diff</div>
          <div class="fail">risk: HIGH</div>
          <div>removed: <span class="hi">DELETE /users/{id}</span></div>
          <div class="dim">required_added: tenantId on POST /users</div>
          <div class="ok">consumers: billing-service · mobile-bff</div>
          <div class="dim">ai cites diff engine + scanner only</div>
        </div>
      </div>
    </header>
    <section class="block" id="product">
      <h2>Diff → risk → consumer blast radius</h2>
      <p class="lede">Compare OpenAPI fixtures, score HIGH/MED/LOW risk, and scan sample consumers for references. No paid APIs required.</p>
      <div class="split">
        <div class="point">
          <h3>Contract-aware review</h3>
          <p>Surface removals, type changes, and required fields before merge — with consumer hits from static scan.</p>
        </div>
        <div class="point">
          <h3>Local eval in minutes</h3>
          <p>Use Bearer token <code>demo</code>, or sign up for an org token.</p>
        </div>
      </div>
    </section>
    <footer>
      <div>© 2026 API Change Intelligence — local production-ready product</div>
      <div><a href="/legal/terms">Terms</a> · <a href="/legal/privacy">Privacy</a> · <a href="/app">App</a></div>
    </footer>
  </div>
</body>
</html>`;
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
  <title>API Change Intelligence — App</title>
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
    .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    a.home { color: var(--accent); text-decoration: none; font-size: .9rem; margin-right: .5rem; }
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
    #usage { font-size: .85rem; color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <a class="home" href="/">← Marketing</a>
    <h1>API Change Intelligence</h1>
    <p>${escapeHtml(report.summary)} Overall risk: ${badge(report.risk)} · merge: <strong>${escapeHtml(report.can_merge_recommendation)}</strong></p>
    <div class="actions">
      <button type="button" onclick="runDiff()">Run diff (v1 → v2)</button>
      <span id="usage">Token: demo</span>
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
      <h2>Merge risk</h2>
      <p>Recommendation: <strong>${escapeHtml(report.can_merge_recommendation)}</strong></p>
      <ul>${report.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
    </section>
    <section>
      <h2>AI explanation (${escapeHtml(report.ai_provider)})</h2>
      <pre>${escapeHtml(report.aiExplanation)}</pre>
    </section>
  </main>
  <script>
    const TOKEN = localStorage.getItem('aci_token') || 'demo';
    async function refreshUsage() {
      try {
        const res = await fetch('/usage', { headers: { Authorization: 'Bearer ' + TOKEN } });
        if (!res.ok) return;
        const u = await res.json();
        document.getElementById('usage').textContent =
          'Diffs this month: ' + u.diffs_used + ' · token ' + TOKEN.slice(0, 8);
      } catch (_) {}
    }
    async function runDiff() {
      const res = await fetch('/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
        body: '{}'
      });
      if (!res.ok) { alert('Diff failed'); return; }
      location.reload();
    }
    refreshUsage();
  </script>
</body>
</html>`;
}

function renderLegalTerms(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Terms of Service — API Change Intelligence</title>
<style>body{margin:0;font-family:"Source Sans 3",system-ui,sans-serif;background:#eef3ea;color:#10150f;line-height:1.55}
main{width:min(720px,calc(100% - 2rem));margin:2rem auto 3rem}a{color:#2f6b3a}.muted{color:#5c6b58;font-size:.9rem}</style>
</head><body><main>
<p><a href="/">← API Change Intelligence</a></p>
<h1>Terms of Service</h1>
<p class="muted">Stub — last updated September 5, 2026. Not legal advice.</p>
<p>API Change Intelligence (“Service”) analyzes OpenAPI diffs and estimates consumer blast radius for evaluation and local use.</p>
<h2>Accounts</h2>
<ul>
<li>You are responsible for credentials and API tokens issued to your organization.</li>
<li>Abuse or unlawful use is prohibited.</li>
</ul>
<h2>Disclaimer</h2>
<p>The Service is provided “as is.” Diff and consumer scans assist review; you remain responsible for production API decisions.</p>
</main></body></html>`;
}

function renderLegalPrivacy(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Privacy Policy — API Change Intelligence</title>
<style>body{margin:0;font-family:"Source Sans 3",system-ui,sans-serif;background:#eef3ea;color:#10150f;line-height:1.55}
main{width:min(720px,calc(100% - 2rem));margin:2rem auto 3rem}a{color:#2f6b3a}.muted{color:#5c6b58;font-size:.9rem}</style>
</head><body><main>
<p><a href="/">← API Change Intelligence</a></p>
<h1>Privacy Policy</h1>
<p class="muted">Stub — last updated September 5, 2026. Not legal advice.</p>
<h2>Data we store</h2>
<ul>
<li><strong>Account data:</strong> email, password hash, organization name, API tokens.</li>
<li><strong>Usage:</strong> diff counts per organization per calendar month.</li>
<li><strong>Specs:</strong> OpenAPI paths you submit for comparison and consumer scan roots.</li>
</ul>
<h2>Storage</h2>
<p>Local deployments persist JSON under <code>DATA_DIR</code>. The demo Bearer token <code>demo</code> is for local evaluation only.</p>
</main></body></html>`;
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
