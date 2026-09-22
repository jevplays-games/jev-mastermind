# Packaged validation report

Generated: 2026-09-22T05:34:42.830709+00:00. Source project version 1.0.0. Tests ran under Node v22.16.0.

## Completed execution

| Check | Actual result |
|---|---|
| Native unit/integration suite | **77 passed; 0 failed; 0 skipped** |
| Same suite from clean source copy | **77 passed; 0 failed** |
| Independent duplicate-safe feedback enumeration | **1,679,616 ordered secret/guess pairs passed** |
| Base-six ID round trips | **1,296 passed** |
| Offline DOM / worker / real-API-bridge workflow | **35 passed; no page runtime errors** |
| Enumerated local codebreaking benchmark | **10,368 completed runs; 8 policies × 1,296 secrets** |
| Raw baseline move observations | **48,705 rows** |
| Packaged sample all-alternative export | **9,072 rows** across its played turns |
| Fresh local server, no dependencies/credentials/database | **Started; health, shell and secret-safe match creation passed** |
| Valid CLI replay / tampered commitment | **Accepted valid file; rejected tampered file** |
| Discord registration script | **Dry run only; no remote write performed** |
| Benchmark/source consistency | **All recorded source hashes match packaged code** |

Native tests use real SQLite, rules, Web Crypto and API handlers with controlled HTTP provider fixtures. Synthetic account/query fixtures are not real community records. Raw TAP, JSON, CSV and NDJSON evidence is included; these are executed results, not projected targets.

## Measured local policies

| Policy | Secrets | Solved within 10 | Mean cost | Maximum cost |
|---|---:|---:|---:|---:|
| local-easy | 1296 | 1296 | 4.5648 | 7 |
| local-normal | 1296 | 1296 | 4.4167 | 6 |
| local-hard | 1296 | 1296 | 4.3974 | 6 |
| local-jev | 1296 | 1296 | 4.4583 | 5 |
| reference-minimax | 1296 | 1296 | 4.4583 | 5 |
| reference-expected | 1296 | 1296 | 4.3974 | 6 |
| random-consistent | 1296 | 1296 | 4.6458 | 7 |
| random-legal | 1296 | 1267 | 6.2647 | 11 |

Cost 11 means failure. These are **local baseline/selector-ablation measurements**, not live JEV measurements. The word “JEV” inside `local-jev` names its candidate policy only. Exactly zero real provider calls were made. The measured local minimax policy has maximum cost 5 for this complete code space; the live JEV adapter has no measured five-guess guarantee. The local Hard policy has a lower measured mean than local JEV, while the local JEV policy has a lower worst case: do not collapse these into an unqualified difficulty-strength claim.

The complete enumeration covers each code uniformly, not the distribution of human-selected secrets. Random baselines have fixed recorded seeds. Timings are environment-specific and mark cache use. Paired comparisons measure codebreaking on matched secrets, not a study of human codemaker skill.

## Browser evidence and limitation

Ordinary Chromium navigation to the loopback server was rejected with `ERR_BLOCKED_BY_ADMINISTRATOR` by the environment's managed URL policy. That policy was **not changed**. The supplied conventional Playwright HTTP-origin suite was therefore not completed here.

For executable interface validation, an offline document loaded the original ES-module logic through data URLs, used a real module Web Worker, and bridged fetch calls to the actual running local HTTP server. Test-only shims supplied storage, digest and download capture for the opaque offline origin. The workflow exercised keyboard play, both legs, missing-secret prevention, post-match analytics, five export types, replay import/tamper detection, records, scoped denial, 390 px layout, reduced-motion preference and API-unavailable browser practice. Screenshots come from that real rendered DOM, not an image mockup.

Those checks do not establish native browser cookie policy, actual CSP enforcement or CORS behavior. Native integration tests independently inspect headers and reject invalid origin/CSRF/session traffic, but a deployed browser test remains necessary.

## External checks not performed

No live TypeSafe inference, Discord login/installation, remote D1 operation or Worker deployment was performed. The environment could not resolve the npm registry, so the optional development packages and Wrangler were not installed and no lockfile was manufactured. Pins were checked against official published releases; installation and actual runtime compatibility still require validation in the connected staging environment.

No independent penetration test, load certification or formal accessibility audit was performed. Server-authoritative outcomes do not prevent external human solver assistance. Release with rankings disabled until the deployment runbook's credentialed and browser checks pass.

## Payload measurements

All static JavaScript files together: 20,808 gzip-estimated bytes. CSS: 3,854 gzip-estimated bytes. These are independent file compression estimates, not measured production transfers, and include code loaded lazily for analytics. No font files, UI framework, remote image library or installed dependency tree is shipped.

## Reproduce

```sh
npm test
npm run test:exhaustive
npm run bench:exhaustive
npm run verify -- reports/examples/sample-replay.json
npm start
```

See `docs/TESTING.md` for live opt-in spending controls and normal browser tests. The sample game was scripted with the reference codebreaker against the local deterministic opponent; it is neither a human experiment nor a live JEV session.
