# API Change Intelligence Platform

**Status:** Phase 0 — planning only. Do not implement until proposal is accepted.  
**Folder:** `06-api-change-intelligence`

---

## Problem

One team changes an API; another service breaks. Teams lack a clear answer to: **we changed something here — what breaks over there?**

## Target users

Backend engineers, platform teams, API owners, mobile teams consuming shared APIs.

## Solution (intent)

Connect OpenAPI specs and repos. Detect breaking schema/endpoint changes on PRs. Map potential consumers via dependency/reference analysis. AI explains the blast radius in human language.

## Tech stack (planned)

- Frontend: Next.js, TypeScript, React, Tailwind
- Parser / dependency engine: Node.js / TypeScript
- Backend: Node/TS or FastAPI for APIs + webhooks
- Database: PostgreSQL
- AI: Ollama for change narratives

## Docs

- [PROPOSAL.md](./PROPOSAL.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [INTERVIEW.md](./INTERVIEW.md)

## Setup

Not runnable yet. Scaffold only.
