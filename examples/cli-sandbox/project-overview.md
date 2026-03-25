# Payment Platform Overview

The payment platform is composed of three main services:

- `payments-api`: user-facing payment orchestration API
- `ledger-writer`: writes finalized transactions into the ledger
- `risk-evaluator`: applies anti-fraud checks before authorization

Known operational notes:

- `payments-api` depends on the shared PostgreSQL connection pool.
- Recent release `2026.03.25-rc4` introduced a new `db-pool-config`.
- The on-call runbook says any sustained `p95 latency > 1200ms` after deploy should trigger rollback review.
