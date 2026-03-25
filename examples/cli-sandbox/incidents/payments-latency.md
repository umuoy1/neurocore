# Incident: Payments API Latency After Deploy

Date: 2026-03-25

Observed symptoms:

- `payments-api` p95 latency increased to `1840ms`
- error rate rose to `3.8%`
- saturation reported as `high`

Preliminary hypothesis:

- the regression correlates with release `2026.03.25-rc4`
- likely risky area: `db-pool-config`

Recommended response:

1. freeze further rollout
2. verify the new pool configuration against last known good
3. rollback if p95 latency stays above `1200ms` for `10 minutes`
