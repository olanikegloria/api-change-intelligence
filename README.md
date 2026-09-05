# API Change Intelligence Platform

**Status:** SaaS foundation (auth, metering, commercial docs) on a runnable OpenAPI diff MVP  
**Folder:** `06-api-change-intelligence`  
**Free-stack:** No paid APIs. Local auth + JSON store. Billing checkout is a stub that upgrades the plan in the local DB (set `STRIPE_SECRET_KEY` later for real Stripe).

Detect breaking OpenAPI changes and estimate downstream blast radius via static consumer scanning.

---

## Path to selling

| Stage | What ships here | Next production step |
|-------|-----------------|----------------------|
| **1. Prove value** | Landing `/`, product `/app`, fixture diff + consumer scan | Wire real OpenAPI from PRs / CI |
| **2. Capture account** | `POST /auth/signup` + `/auth/login` → API token; orgs in `data/accounts.json` | Managed Postgres + password reset |
| **3. Meter Free** | 30 diffs/mo; **HTTP 402** on quota | Soft alerts + in-app upgrade CTA |
| **4. Take payment** | `POST /billing/checkout-session` stub (upgrades plan locally) | Real Stripe Checkout + webhooks |
| **5. Close Team/Business** | Pricing/Sales docs; seat+API narrative | Enforce seats/APIs; SSO for Business |

Commercial docs:

- [docs/PRICING.md](./docs/PRICING.md) — Free / Team ($59) / Business ($179)
- [docs/SALES.md](./docs/SALES.md) — ICP, demo script, objections

Legal stubs: `/legal/terms`, `/legal/privacy`

---

## What works

- Marketing landing at `/`; product dashboard at `/app`
- OpenAPI fixture diff + consumer blast-radius scan
- Bearer-protected `/diff` and `/report` (`demo` token for local eval)
- Org signup/login with API tokens; usage metering; checkout stub
- Risk badges HIGH/MED/LOW + AI explanation stub that cites engine output

## Stack

| Layer | Choice |
|-------|--------|
| API + UI | TypeScript Express + HTML |
| Store | JSON under `data/` (`accounts.json`) |
| Auth | PBKDF2 password hashes + opaque API tokens |
| Billing | Stub checkout (optional `STRIPE_SECRET_KEY` later) |
| Tests | Node test runner |
| Infra | Docker Compose |

## Quick start (local)

```bash
cd 06-api-change-intelligence
npm install
npm run dev
```

Open http://localhost:8006/ (landing) and http://localhost:8006/app (product).

### Commercial demo flow

```bash
export TOKEN=demo

curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8006/diff -d '{}'

curl -H "Authorization: Bearer $TOKEN" http://localhost:8006/report | head

curl -X POST http://localhost:8006/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@acme.dev","password":"demo-pass","org_name":"Acme Platform"}'

curl -X POST http://localhost:8006/billing/checkout-session \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"plan":"team"}'
```

Free orgs that exceed **30 diffs/month** receive **402** with upgrade hints.

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
| GET | `/billing/usage` | Bearer | Plan + diff usage |
| POST | `/billing/checkout-session` | Bearer | Stub checkout; upgrades plan locally |
| POST | `/diff` | Bearer | Diff fixtures; meters usage; 402 on Free limit |
| GET | `/report` | Bearer | Last (or freshly built) report JSON |

Local eval: `Authorization: Bearer demo`

## Env

| Variable | Purpose |
|----------|---------|
| `DATA_DIR` | JSON persistence (default `./data`) |
| `PORT` | Default `8006` |
| `STRIPE_SECRET_KEY` | Optional; documented for live Checkout later |

## Layout

```text
parser/               OpenAPI load + normalize
dependency-engine/    Schema diff + consumer scanner
backend/              Express API, accounts, landing + /app UI
docs/                 PRICING.md, SALES.md
fixtures/             openapi-v1.json, openapi-v2.json
sample-consumers/     Fake services referencing /users
tests/                Diff + consumer scanner tests
```

## Docs

- [PROPOSAL.md](./PROPOSAL.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [INTERVIEW.md](./INTERVIEW.md)
- [docs/PRICING.md](./docs/PRICING.md)
- [docs/SALES.md](./docs/SALES.md)
