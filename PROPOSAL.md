# PROJECT PROPOSAL — 06 API Change Intelligence Platform

**Status:** Awaiting review. Do not implement until accepted.  
**Working name:** API Change Intelligence  
**One-liner:** Detect breaking API changes and estimate downstream blast radius — AI explains the risk in plain language.

---

## PROBLEM

Service A changes a response field. Service B and a mobile app break. Teams lack automated answers to: **what will break over there if we merge this?**

---

## TARGET USER

- Backend / API owners
- Platform engineers
- Mobile/web client teams consuming shared APIs
- Reviewers of API-heavy PRs

---

## WHY THEY CARE

Breaking changes are costly and often invisible until runtime. Catching removed fields, type changes, and auth changes before merge saves incidents.

---

## EXISTING ALTERNATIVES

| Alternative | Strength | Gap |
|-------------|----------|-----|
| OpenAPI diff CLIs / oasdiff | Solid schema diff | Weak consumer blast-radius product UX |
| Contract testing (Pact) | Strong consumer-driven contracts | Requires discipline upfront; different workflow |
| API gateways | Runtime enforcement | Not PR-time intelligence |
| Manual review | Contextual | Doesn’t scale |

---

## OUR DIFFERENTIATOR

1. **Schema diff + consumer reference scan** in one workflow.
2. PR-oriented risk report (HIGH/MED/LOW) with listed potential consumers.
3. AI explains the change for humans; **diff engine decides what changed**.
4. Honest about incomplete consumer detection (static analysis limits).

---

## MVP

- Ingest OpenAPI 3.x specs (from repo paths)
- Diff two versions (PR base vs head, or two tags)
- Detect: removed endpoints/fields, type changes, required-field changes, auth scheme changes
- Scan connected repos for references (path strings, generated client hints)
- Emit risk report
- AI: human-language summary of breaking changes + consumer list

**Non-goals:** GraphQL (later), perfect dynamic traffic-based consumer maps, auto-blocking merges without human policy.

---

## V2

- GitHub PR Check annotation
- Better consumer graph (import of generated clients)
- Compatibility score over time
- Ignore rules / approved breakages

---

## V3

- Org-wide API catalog
- Gateway integration
- GraphQL support

---

## TECH STACK

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js, TS, React, Tailwind | Risk report UX |
| Parser / dependency engine | Node.js / TypeScript | OpenAPI ecosystem, git integration |
| Backend | Node/TS | Webhooks + reports |
| DB | PostgreSQL | Specs, diffs, consumers |
| AI | Ollama | Summaries only |

---

## ARCHITECTURE

See [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## AI COMPONENT

- Explain removed fields / type changes
- Summarise blast radius for PR descriptions
- Must not invent consumers not found by the scanner

---

## SECURITY

- GitHub webhook verification
- Least-privilege repo access
- No leaking private spec contents in public demos

---

## SCALABILITY

| Scale | Plan |
|-------|------|
| 10 | Pairwise diff on demand |
| 10k | Cached specs, incremental consumer index |
| 1M | Catalog service, streaming change events, partitioned indexes |

---

## TESTING

- Fixture specs: breaking vs non-breaking
- Diff engine unit tests
- Consumer scanner tests on sample repos
- API/webhook integration tests
- AI summary citation of actual diff items

---

## DEPLOYMENT

- Docker Compose
- CI: lint → diff fixtures → build

---

## ESTIMATED COMPLEXITY

**Medium–high.** Diff engine is tractable; consumer detection quality is the long pole.

---

## RISKS

| Risk | Mitigation |
|------|------------|
| False consumer negatives | Document confidence; prefer precision in UI language |
| Undocumented APIs | Require OpenAPI for MVP |
| Noise on additive changes | Classify breaking vs non-breaking clearly |
| Overlap with oasdiff | Productise report + consumers + AI narrative |

---

## ACCEPTANCE

- [ ] OpenAPI-only MVP approved
- [ ] Consumer-detection honesty approved
- [ ] **I accept this** / revise / cut
