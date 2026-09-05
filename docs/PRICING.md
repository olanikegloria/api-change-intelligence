# Pricing — API Change Intelligence

**Positioning:** Pay for seats and API surfaces that need breaking-change governance — not another static OpenAPI viewer.

---

## Plans at a glance

| | **Free** | **Team** | **Business** |
|---|----------|----------|--------------|
| **Price** | $0 | **$59 / month** | **$179 / month** |
| **Seats** | 1 | Up to 10 | Up to 50 |
| **API surfaces** | 1 | Up to 10 | Up to 50 |
| **Diffs / month** | 30 | 1,500 | Unlimited\* |
| **Consumer blast-radius scan** | Yes | Yes | Yes + export roadmap |
| **API tokens** | 1 | Per seat | SSO-ready (roadmap) |
| **Support** | Community docs | Email (48h) | Priority |

\*Fair-use rate limits still apply on Business.

---

## Seat + API narrative

### Free — prove the loop on one contract

One engineer, one OpenAPI surface, thirty diffs per month. Enough to compare fixtures (or real specs), see HIGH/MED/LOW risk, and map consumers. When Free quota is hit, the API returns **HTTP 402** with an upgrade path.

### Team ($59/mo) — platform / API squad default

Ten seats cover owners of shared contracts. Ten APIs typically means “public API + internal BFFs + a few domain services.” Fifteen hundred diffs/month covers PR-time reviews without metering every click.

### Business ($179/mo) — multi-team governance

Fifty seats and fifty APIs fit a platform team serving product groups. Unlimited diffs (fair use) removes quota anxiety during migration seasons.

---

## What we meter today (MVP)

| Meter | Free limit | Notes |
|-------|------------|-------|
| `POST /diff` | **30 / calendar month / org** | Enforced; 402 when exceeded |
| Seats / APIs | Soft limits in docs | Hard enforcement ships with billing webhooks |

Auth required for `/diff` and `/report`. Local demos may use Bearer token `demo`.

---

## Upgrade path

1. Sign up → Free org + API token  
2. Hit quota or need more seats → `POST /billing/checkout-session`  
3. Stub upgrades plan in local DB; set `STRIPE_SECRET_KEY` later for live Checkout  

**Free-stack:** no paid APIs required to demo or develop.
