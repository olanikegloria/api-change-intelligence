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
  <title>API Change Intelligence - catch breaking changes</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #000; --panel: #000; --text: #fff; --muted: #9aa0a6;
      --accent: #00e5ff; --accent-hover: #5ef0ff;
      --border: #fff; --border-dim: rgba(255,255,255,.35);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "Space Mono", ui-monospace, monospace; color: var(--text);
      background: var(--bg); min-height: 100vh; -webkit-font-smoothing: antialiased;
    }
    .wrap { width: min(960px, calc(100% - 2.5rem)); margin: 0 auto; }
    nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1.5rem 0; border-bottom: 2px solid var(--border);
    }
    .brand { font-family: "Syne", system-ui, sans-serif; font-weight: 800; letter-spacing: -.02em; font-size: 1.1rem; text-transform: uppercase; }
    .brand span { color: var(--accent); }
    .nav-links { display: flex; gap: 1.25rem; align-items: center; font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; }
    .nav-links a { text-decoration: none; color: var(--muted); }
    .nav-links a:hover { color: var(--accent); }
    .btn {
      display: inline-flex; text-decoration: none; border-radius: 0; padding: .65rem 1.1rem;
      font-weight: 700; font-size: .75rem; border: 2px solid transparent;
      font-family: inherit; letter-spacing: .06em; text-transform: uppercase;
      transition: background .12s ease, color .12s ease, border-color .12s ease;
    }
    .btn-primary { background: var(--accent); color: #000; border-color: var(--accent); }
    .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    .btn-ghost { background: transparent; border-color: var(--border); color: var(--text); }
    .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
    .hero { padding: 3.5rem 0 2.75rem; border-bottom: 2px solid var(--border); }
    .product {
      font-size: .65rem; font-weight: 700; letter-spacing: .18em;
      text-transform: uppercase; color: var(--accent); margin-bottom: 1rem;
    }
    h1 {
      margin: 0 0 1rem; font-family: "Syne", system-ui, sans-serif;
      font-size: clamp(2.2rem, 5.5vw, 3.4rem); line-height: 1.05;
      letter-spacing: -.03em; max-width: 14ch; font-weight: 800; text-transform: uppercase;
    }
    .lede { margin: 0 0 1.75rem; color: var(--muted); font-size: .9rem; line-height: 1.6; max-width: 48ch; }
    .cta-row { display: flex; flex-wrap: wrap; gap: .75rem; }
    .features {
      padding: 0; border-top: none; display: grid; gap: 0;
    }
    @media (min-width: 720px) { .features { grid-template-columns: repeat(3, 1fr); } }
    .feature {
      padding: 1.5rem 1.25rem; background: transparent;
      border: none; border-right: 1px solid var(--border-dim); border-bottom: 2px solid var(--border);
      border-radius: 0;
    }
    .feature:last-child { border-right: none; }
    .feature h3 {
      margin: 0 0 .65rem; font-size: .7rem; font-weight: 700; letter-spacing: .12em;
      text-transform: uppercase; color: var(--accent); font-family: inherit;
    }
    .feature p { margin: 0; color: var(--muted); font-size: .8rem; line-height: 1.55; }
    footer {
      border-top: 2px solid var(--border); padding: 1.5rem 0 2.5rem; display: flex; flex-wrap: wrap;
      gap: 1rem; justify-content: space-between; color: var(--muted); font-size: .7rem;
      letter-spacing: .06em; text-transform: uppercase;
    }
    footer a { color: var(--muted); text-decoration: none; }
    footer a:hover { color: var(--accent); }
  </style>
</head>
<body>
  <div class="wrap">
    <nav>
      <div class="brand">API <span>Change Intelligence</span></div>
      <div class="nav-links">
        <a href="#features">Features</a>
        <a href="/legal/terms">Terms</a>
        <a class="btn btn-primary" href="/app">Open app</a>
      </div>
    </nav>
    <header class="hero">
      <div class="product">API Change Intelligence</div>
      <h1>Catch breaking API changes before they ship.</h1>
      <p class="lede">Diff OpenAPI specs, score risk, and map blast radius across consumers - with orgs and API tokens on a free local stack.</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="/app">Open app</a>
        <a class="btn btn-ghost" href="#features">See features</a>
      </div>
    </header>
    <section class="features" id="features">
      <div class="feature">
        <h3>OpenAPI diff</h3>
        <p>Surface removals, type changes, and required fields before merge.</p>
      </div>
      <div class="feature">
        <h3>Consumer blast radius</h3>
        <p>Static scan maps which services still reference changed paths and fields.</p>
      </div>
      <div class="feature">
        <h3>Merge-risk summary</h3>
        <p>HIGH/MED/LOW risk with an evidence-bound AI brief - Bearer token <code>demo</code> ready.</p>
      </div>
    </section>
    <footer>
      <div>© 2026 API Change Intelligence</div>
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
      <td>${escapeHtml(c.property || "-")}</td>
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
  <title>API Change Intelligence - App</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #000; --panel: #000; --border: #fff; --border-dim: rgba(255,255,255,.3);
      --text: #fff; --muted: #9aa0a6; --accent: #00e5ff; --accent-hover: #5ef0ff;
      --fail: #ff4d4f; --warn: #ffd666; --ok: #00e5ff; --input: #0a0a0a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "Space Mono", ui-monospace, monospace; color: var(--text);
      background: var(--bg); min-height: 100vh; -webkit-font-smoothing: antialiased;
    }
    .shell { width: min(1120px, calc(100% - 2rem)); margin: 0 auto; }
    header { padding: 1.5rem 0 1.15rem; border-bottom: 2px solid var(--border); }
    h1 {
      margin: .35rem 0 0; font-family: "Syne", system-ui, sans-serif;
      font-size: 1.35rem; letter-spacing: -.02em; font-weight: 800; text-transform: uppercase;
    }
    p { color: var(--muted); margin: .45rem 0 1rem; font-size: .8rem; }
    .actions { display: flex; gap: .55rem; flex-wrap: wrap; align-items: center; }
    a.home { color: var(--muted); text-decoration: none; font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; }
    a.home:hover { color: var(--accent); }
    button {
      background: var(--accent); color: #000; border: 2px solid var(--accent); border-radius: 0;
      padding: .5rem .95rem; font-weight: 700; font-size: .72rem; font-family: inherit;
      cursor: pointer; letter-spacing: .06em; text-transform: uppercase;
    }
    button:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    main { padding: 0 0 2.5rem; display: grid; gap: 0; }
    section {
      background: transparent; border: none; border-bottom: 2px solid var(--border);
      border-radius: 0; padding: 1.15rem 0;
    }
    h2 {
      margin: 0 0 .85rem; font-size: .65rem; letter-spacing: .14em; text-transform: uppercase;
      color: var(--accent); font-weight: 700;
    }
    table { width: 100%; border-collapse: collapse; font-size: .78rem; }
    th, td { text-align: left; padding: .5rem .35rem; border-bottom: 1px solid var(--border-dim); vertical-align: top; }
    th { color: var(--muted); font-weight: 700; font-size: .65rem; letter-spacing: .1em; text-transform: uppercase; }
    .mono { font-size: .75rem; }
    .badge { display: inline-block; padding: .1rem .4rem; border-radius: 0; font-size: .65rem; font-weight: 700; border: 1px solid currentColor; background: transparent; letter-spacing: .04em; }
    .high { color: var(--fail); }
    .med { color: var(--warn); }
    .low { color: var(--ok); }
    pre {
      white-space: pre-wrap; background: var(--input); border: 1px solid var(--border-dim);
      border-radius: 0; padding: .9rem; font-family: inherit;
      font-size: .78rem; line-height: 1.5; margin: 0;
    }
    #usage { font-size: .75rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    ul { margin: 0; padding-left: 1.2rem; color: var(--muted); line-height: 1.55; font-size: .8rem; }
  </style>
</head>
<body>
  <div class="shell">
  <header>
    <a class="home" href="/">← Landing</a>
    <h1>API Change Intelligence</h1>
    <p>${escapeHtml(report.summary)} Overall risk: ${badge(report.risk)} · merge: <strong>${escapeHtml(report.can_merge_recommendation)}</strong></p>
    <div class="actions">
      <button type="button" id="btnDiff" onclick="runDiff()">Run diff (v1 → v2)</button>
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
      <p>Recommendation: <strong style="color:var(--text)">${escapeHtml(report.can_merge_recommendation)}</strong></p>
      <ul>${report.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
    </section>
    <section>
      <h2>AI explanation (${escapeHtml(report.ai_provider)})</h2>
      <pre>${escapeHtml(report.aiExplanation)}</pre>
    </section>
  </main>
  </div>
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
      const btn = document.getElementById('btnDiff');
      btn.disabled = true;
      btn.textContent = 'Running…';
      try {
        const res = await fetch('/diff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
          body: '{}'
        });
        if (!res.ok) { alert('Diff failed'); return; }
        location.reload();
      } catch (_) {
        alert('Diff failed: network error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Run diff (v1 → v2)';
      }
    }
    refreshUsage();
  </script>
</body>
</html>`;
}

function renderLegalTerms(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Terms of Service - API Change Intelligence</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700&display=swap" rel="stylesheet"/>
<style>body{margin:0;font-family:"Space Mono",ui-monospace,monospace;background:#000;color:#fff;line-height:1.55}
main{width:min(720px,calc(100% - 2rem));margin:2rem auto 3rem}a{color:#00e5ff}h1{font-family:"Syne",system-ui,sans-serif;text-transform:uppercase}.muted{color:#9aa0a6;font-size:.85rem}</style>
</head><body><main>
<p><a href="/">← API Change Intelligence</a></p>
<h1>Terms of Service</h1>
<p class="muted">Stub - last updated September 5, 2026. Not legal advice.</p>
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
<title>Privacy Policy - API Change Intelligence</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@700&display=swap" rel="stylesheet"/>
<style>body{margin:0;font-family:"Space Mono",ui-monospace,monospace;background:#000;color:#fff;line-height:1.55}
main{width:min(720px,calc(100% - 2rem));margin:2rem auto 3rem}a{color:#00e5ff}h1{font-family:"Syne",system-ui,sans-serif;text-transform:uppercase}.muted{color:#9aa0a6;font-size:.85rem}</style>
</head><body><main>
<p><a href="/">← API Change Intelligence</a></p>
<h1>Privacy Policy</h1>
<p class="muted">Stub - last updated September 5, 2026. Not legal advice.</p>
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
