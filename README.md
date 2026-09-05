# API Change Intelligence Platform

**Status:** Runnable MVP scaffold  
**Folder:** `06-api-change-intelligence`

Detect breaking OpenAPI changes and estimate downstream blast radius via static consumer scanning.

---

## What works in this MVP

- Load OpenAPI fixtures (`fixtures/openapi-v1.json` vs `openapi-v2.json`)
- Diff: removed paths, removed properties, type changes, required-field changes
- Consumer scanner over `sample-consumers/` for path/field string references
- `POST /diff` and `GET /report`
- HTML UI with breaking changes, consumers, and HIGH/MED/LOW risk

## Stack

| Layer | Choice |
|-------|--------|
| Parser / dependency engine / API | TypeScript (Node + Express) |
| UI | HTML served by Express |
| Fixtures | OpenAPI 3 JSON + fake consumer services |

## Quick start (local)

```bash
cd 06-api-change-intelligence
npm install
npm run dev
```

Open http://localhost:8006/

```bash
curl -X POST http://localhost:8006/diff -H 'Content-Type: application/json' -d '{}'
curl http://localhost:8006/report | head
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

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Risk report dashboard |
| POST | `/diff` | Diff fixtures (optional body paths) and scan consumers |
| GET | `/report` | Last (or freshly built) report JSON |
| GET | `/health` | Liveness |

## Layout

```text
parser/               OpenAPI load + normalize
dependency-engine/    Schema diff + consumer scanner
backend/              Express API + HTML UI
fixtures/             openapi-v1.json, openapi-v2.json
sample-consumers/     Fake services referencing /users
tests/                Node test runner
frontend/             Reserved; MVP UI is served at /
```

## Docs

- [PROPOSAL.md](./PROPOSAL.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [INTERVIEW.md](./INTERVIEW.md)
