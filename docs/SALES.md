# Sales playbook — API Change Intelligence

---

## ICP (ideal customer profile)

| Dimension | Fit |
|-----------|-----|
| **Company** | 20–300 engineers; OpenAPI (or OpenAPI-like) contracts for public/internal APIs |
| **Buyer** | Platform / API governance lead, Eng Manager owning contract compatibility |
| **Champion** | IC who already reviews OpenAPI PRs and gets paged when clients break |
| **Trigger** | Client outage after a “compatible” API change; multi-consumer BFF sprawl |
| **Anti-ICP** | Single-service teams with no external consumers; GraphQL-only orgs without OpenAPI |

**One sentence:** Teams that ship shared APIs and still discover breakages in production or late QA.

---

## Pain

1. **Spec diffs without blast radius** — OpenAPI PR reviews show YAML, not which consumers call the field.  
2. **Tribal consumer maps** — “Who still hits DELETE /users?” lives in Slack memory.  
3. **AI theater** — LLM summaries of OpenAPI that invent endpoints destroy trust.

Our wedge: **deterministic OpenAPI diff + static consumer scan first; AI only narrates cited engine output.**

---

## Demo script (12–15 minutes)

### 0. Setup

- Open landing `/` → **Open app** → `/app`  
- Bearer token for local eval: `demo`

### 1. Problem frame (2 min)

> “Your OpenAPI PR answers ‘what changed in YAML.’ We answer: what broke, how severe, and which consumers still reference it.”

Show Free → Team pricing on the landing.

### 2. Diff + consumers (5 min)

```bash
export TOKEN=demo
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8006/diff -d '{}'
curl -H "Authorization: Bearer $TOKEN" http://localhost:8006/report | head
```

Walk HIGH risk removals, type changes, and billing-service / mobile-bff hits.

### 3. Commercial motion (4 min)

```bash
curl -X POST http://localhost:8006/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@acme.dev","password":"demo-pass","org_name":"Acme Platform"}'

curl -X POST http://localhost:8006/billing/checkout-session \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"plan":"team"}'
```

Stub upgrades plan in local DB; mention Stripe when ready. Optionally burn Free quota until **402**.

### 4. Close

> “Team at $59/mo covers a platform squad and ten API surfaces — same diff loop you just saw, with seats and quota that match PR-time review.”

---

## Objection handling

| Objection | Response |
|-----------|----------|
| “We already have Spectral / oasdiff.” | Complementary: we add **consumer blast radius + org metering + sellable upgrade path**, not only lint. |
| “Static scan will miss dynamic clients.” | Honest: regex consumer scan has false negatives; still beats tribal knowledge for path/field hits. |
| “$59 for a diff tool?” | You’re buying **merge confidence and avoided client outages**, not a YAML viewer. |
| “We need GraphQL.” | OpenAPI-first wedge; adapters are roadmap — don’t overclaim. |

---

## Qualification questions

1. How many services consume your public/internal OpenAPI contracts?  
2. Who owns API compatibility reviews today?  
3. Last breaking change that reached production — how was it found?
