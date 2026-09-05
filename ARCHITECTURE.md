# Architecture — API Change Intelligence

**Status:** Planning. Subject to change after proposal review.

---

## System overview

```text
GitHub PR / OpenAPI files
      │
      ▼
Spec parser (OpenAPI)
      │
      ▼
Schema diff engine
  - removed fields
  - type / required changes
  - endpoint removals
  - auth scheme changes
      │
      ▼
Consumer scanner (repo references, clients, path strings)
      │
      ▼
Risk report + AI summary
```

---

## Core components

| Path | Role |
|------|------|
| `parser/` | OpenAPI load + normalize |
| `dependency-engine/` | Diff + consumer graph |
| `backend/` | Webhooks, report API |
| `frontend/` | PR risk views |
| `ai/` | Human-readable change explanations |
| `tests/` | Spec fixtures for breaking/non-breaking cases |

---

## MVP scope

- REST + OpenAPI only
- GraphQL deferred
- Consumer detection = best-effort static references (honest about false negatives)

---

## Open questions

1. Compare specs from git history vs uploaded pairs?
2. How to model gateway / BFF layers?
