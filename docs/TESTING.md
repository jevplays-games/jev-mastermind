# Tests and benchmarks

## Run the supplied checks

```sh
npm test
npm run test:exhaustive
npm run bench:smoke
npm run bench:exhaustive
npm run verify -- reports/examples/sample-replay.json
```

The native suite uses actual SQLite persistence, actual Web Crypto hashes/signatures, and the actual API handler. Network providers are controlled fixtures. Test-only keys/account IDs and synthetic query fixtures are not real credentials or benchmark populations. Its JavaScript-parse check includes browser modules to catch syntax errors not imported by server tests.

`test:exhaustive` checks all 1,679,616 ordered secret/guess pairs against an independent algorithm which consumes unmatched symbols. It also checks the lookup table, symmetry, exact-match constraints and impossible feedback, plus all 1,296 ID round trips. This proves those finite feedback properties, not every possible sequence of 20 moves.

## Conventional browser suite

In an environment that permits normal browser navigation:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

The JS Playwright config can start/reuse the loopback development server. `tests/browser-smoke.py` is a more extensive optional Python harness for a system Chromium path; it requires an already running server. The packaged evidence does not claim this ordinary HTTP-navigation harness passed: managed Chromium navigation was blocked during creation.

Instead, `tests/dom-smoke.py` used real Chromium DOM and a real module Web Worker on an offline document, importing original module logic through data URLs. A test-only bridge forwards calls to the real loopback HTTP server and supplies storage/digest/download plumbing unavailable to the opaque offline origin. This exercised keyboard input, both game legs, secret withholding, analysis, all exports, replay tamper rejection, records, unauthorized community access, mobile layout, reduced motion and API-unavailable practice. It deliberately does not establish browser-origin cookie/CSP/CORS behavior. No managed browser policy was changed.

## Deterministic benchmark

```sh
node bench/run.mjs --exhaustive
node bench/run.mjs --secrets=16 --policies=local-normal,reference-minimax --out=reports/my-smoke
```

Full runs enumerate every code for each requested policy. Partial runs select evenly spaced secret IDs and declare coverage. Default policies:

```
local-easy, local-normal, local-hard, local-jev,
reference-minimax, reference-expected,
random-consistent, random-legal
```

Local policies are deterministic substitutes for the model-selection stage with the same candidate policies. They are ablations, **not** live JEV. Random baselines are seeded by configured seed and secret ID. Even random-legal avoids repeating already attempted codes and restricts its final attempt to possible secrets; it is the documented harness baseline, not unrestricted IID color guessing.

The `reference-minimax` implementation uses a fixed AABB opening and a documented tie hierarchy. The included all-secret result is a measurement of this implementation; no unrelated published guarantee is silently transferred to arbitrary JEV outputs.

Outputs: summary JSON, per-game CSV and NDJSON, per-move CSV, secret-pattern CSV, paired same-secret cost comparisons, checkpoint and a human-readable results table. Every recorded state is compared with all legal alternative guesses for one-step regret. Source hashes, seed, Node version, duration, coverage, fallbacks and actual provider calls are recorded.

## Paid live-provider benchmark: explicit opt-in

Set `TYPESAFE_API_KEY` privately before running:

```sh
node bench/run.mjs --live --confirm-spend --secrets=16 --policies=jev-normal --max-calls=100 --out=reports/live-normal
```

The spend acknowledgement and bounded call count are required. Increasing `--max-calls` permits additional billable requests; it is not a currency budget. Provider retry attempts count toward the bound. A budget-exhausted partial game is saved separately, not counted as completed. Audit decisions are flushed to NDJSON as they happen.

Use new output folders for separate experiments. Live provider calls were not performed for this package. Evaluate identical secret sets/configurations against the deterministic selector ablations before assigning improvements to JEV. Preserve fallback labels: a mixed run does not establish pure model strength. Repeat live configurations to measure variability; a recorded-action replay guarantees rules determinism but fresh inference may differ.

## Interpretation

The full enumeration gives exact finite-configuration performance for the measured local policies. It is not a sample of human players, an estimate of the human-secret distribution, or a win-rate study of all future deployments. Cached local selector timing is marked; it is not JEV latency. Pattern and paired tables support diagnosis without turning descriptive baselines into untested product claims.

See `reports/VALIDATION.md` for actual completed execution, limitations and counts. Re-run all checks after code changes; the benchmark source hashes make stale results detectable.
