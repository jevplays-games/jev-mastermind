# Engineering guardrails

Read README, docs/ANALYTICS.md, docs/SECURITY.md and reports/VALIDATION.md before changing behavior.

Never send either secret, the human's guess history or the human's result to JEV. Keep numeric feedback/candidate calculations in pure code. A provider response is only a proposed member of a supplied finite candidate set.

Never silently turn `local`, `forced` or `fallback` into `jev`. Only verified eligible server records rank. Never add a score-write endpoint or allow imported replay data to finalize official results.

Preserve idempotency, CAS revision checks, durable AI leases and quota reservations. A network failure does not prove a mutation failed. Do not reissue an expired unknown provider call without its recorded recovery semantics.

Bump rules/policy/prompt/config versions when behavior changes. Update documentation, tests and benchmark source hashes. Do not relabel existing cohorts. Do not claim live integration performance from local simulations or fixture providers.

Test with `npm test`, `npm run test:exhaustive`, the appropriate browser suite and a benchmark smoke run. Generate new real reports; never edit outputs to make checks pass. Keep test-only bridge/shim code out of the production bundle.

Use native APIs and the smallest justified component. No credentials, `.env`, `.data`, node_modules or fabricated production records belong in a shared artifact.
