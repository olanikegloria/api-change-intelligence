# API Change Intelligence Platform

**Status:** Production-ready local product (auth + OpenAPI diff + consumer scan)  
**Folder:** `06-api-change-intelligence`  
**Free-stack:** No paid APIs. Local auth + JSON store + optional free Ollama for grounded merge narratives.

Detect breaking OpenAPI changes and estimate downstream blast radius via static consumer scanning.

---

## What works

- Marketing landing at `/`; product dashboard at `/app`
- OpenAPI fixture diff + consumer blast-radius scan
- Bearer-protected `/diff`, `/report`, `/merge-risk` (`demo` token for local eval)
- Org signup/login with API tokens
- Risk badges HIGH/MED/LOW + deterministic merge recommendation + optional Ollama narrative

Legal stubs: `/legal/terms`, `/legal/privacy`

## Stack

| Layer | Choice |
|-------|--------|
| API + UI | TypeScript Express + HTML |
| Store | JSON under `data/` (`accounts.json`) |
| Auth | PBKDF2 password hashes + opaque API tokens |
| Tests | Node test runner |
| Infra | Docker Compose |

## Quick start (local)

```bash
cd 06-api-change-intelligence
npm install
npm run dev
```

Open http://localhost:8006/ (landing) and http://localhost:8006/app (product).

```bash
export TOKEN=demo

curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8006/diff -d '{}'

curl -H "Authorization: Bearer $TOKEN" http://localhost:8006/report | head

curl -H "Authorization: Bearer $TOKEN" http://localhost:8006/merge-risk

curl -X POST http://localhost:8006/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@acme.dev","password":"demo-pass","org_name":"Acme Platform"}'
```

### Tests

```bash
npm test
```

## Docker

```bash
cd 06-api-change-intelligence
docker compose up --build
```

UI/API: http://localhost:8006/

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | Marketing landing |
| GET | `/app` | — | Diff / consumer dashboard |
| GET | `/legal/terms`, `/legal/privacy` | — | Legal stubs |
| GET | `/health` | — | Liveness |
| POST | `/auth/signup` | — | Create org + user + API token |
| POST | `/auth/login` | — | Return API token |
| GET | `/usage` | Bearer | Diffs used this month |
| POST | `/diff` | Bearer | Diff fixtures (+ optional Ollama narrative) |
| GET | `/report` | Bearer | Last (or freshly built) report JSON |
| GET | `/merge-risk` | Bearer | `{ can_merge_recommendation, reasons }` (+ AI narrative) |

Local eval: `Authorization: Bearer demo`

## Env

| Variable | Purpose |
|----------|---------|
| `DATA_DIR` | JSON persistence (default `./data`) |
| `PORT` | Default `8006` |
| `OLLAMA_HOST` | Ollama base URL (default `http://127.0.0.1:11434`) |
| `OLLAMA_MODEL` | Model name (default `qwen2.5-coder:3b`) |
| `OLLAMA_TIMEOUT_MS` | Chat timeout (default `90000`) |

Optional free local AI via Ollama. If unavailable, `aiExplanation` falls back to a deterministic diff summary (`ai_provider: "fallback"`). Merge recommendation stays rule-based either way.

## Layout

```text
parser/               OpenAPI load + normalize
dependency-engine/    Schema diff + consumer scanner
backend/              Express API, accounts, landing + /app UI
fixtures/             openapi-v1.json, openapi-v2.json
sample-consumers/     Fake services referencing /users
tests/                Diff + consumer scanner tests
```

## Docs

- [PROPOSAL.md](./PROPOSAL.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [INTERVIEW.md](./INTERVIEW.md)
