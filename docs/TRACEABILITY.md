# Requirement traceability and deviations

| Requirement | Implementation / evidence |
|---|---|
| Single page, minimal dependencies | `public/index.html`, `game.css`, `game.js`; native ES modules |
| Pure reusable game engine | `public/mastermind/rules.js`; unit and independent exhaustive tests |
| Explicit finite JEV surface | `strategy.js`, `server/jev.js`; strict choice tests |
| Four difficulty levels | Eight-/32-/64-/128-choice policies and benchmarks |
| Hidden information unavailable to JEV | `getJevView` + request re-projection; leakage tests |
| Deterministic replay and commitments | `verify.js`, rules reconstruction, tamper tests |
| Guest and failure-mode play | Node local mode, browser practice, marked fallback/local sources |
| Discord identity | `server/auth.js`; identify-only OAuth and session tests |
| Secure guild/channel context | `server/discord.js`; Ed25519 and user-bound ticket tests |
| Authoritative score and anti-cheat | `server/matches.js`; no score endpoint, verification/CAS tests |
| Scoped leaderboards and ties | `server/analytics.js`; shared rank/cohort isolation tests |
| Exhaustive move analytics | Full all-1,296 comparisons in worker; all-alternative CSV |
| Longitudinal and operational analytics | Profile groups/daily/history/streaks, community distributions, admin endpoint |
| Bounded score/AI abuse | Persistent `usage_buckets`, one ranked match, leases and quota tests |
| Desktop/mobile/accessibility | Semantic controls, letter pegs, keyboard, reduced motion; DOM/screenshots |
| Simulation/benchmark independence | Shared rules, eight measured policies, spend-gated live harness |
| Deployment | Worker/D1 bindings, migrations, explicit command-registration script, runbook |
| ZIP and reproducibility | Source, measured reports, example exports, manifest, README |

## Intentional implementation refinements

The original four-table sketch is six tables because durable quotas and structured analytics merit separate retention/query boundaries. Match state still owns authoritative results; there is no separate materialized leaderboard service.

Browser analytics perform expensive all-alternative comparisons after the game. Server analytics expose selected-guess metrics and trustworthy aggregate records. This keeps the full analysis feature without turning a public report endpoint into an unbounded edge CPU sink.

Duplicate action requests return the latest server state plus a duplicate marker, while their original action receipt is immutable. This is safer for resumed interfaces than returning an old board snapshot.

One tiny Node development adapter makes the complete local game runnable without a Cloudflare account or npm installation; it does not replace the intended production Worker or claim local scores are ranked.

## Unperformed / outside release scope

Real JEV inference, real Discord authorization/installation, public Cloudflare deployment and conventional HTTP-origin browser E2E remain unverified here. Tournament/Elo/social features, immediate Discord membership revocation, strong external-assistance detection, public replay URLs, account-deletion UI and generalized multi-game framework remain outside this implementation. See release gates instead of assuming these are implemented.
