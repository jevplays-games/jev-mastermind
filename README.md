# Mastermind vs JEV

A runnable, framework-free two-leg Mastermind game with a server-authoritative backend, Discord integration, replay verification, and exhaustive post-match deduction analytics.

**Start here:** Node.js 22.16 or later is required. No package installation, external account, or API key is needed for local play.

```sh
cd jev-mastermind
npm start
```

Open **http://127.0.0.1:8787**. Use this exact address, not `localhost`: the development server validates the Host header. Stop with Ctrl+C. Its SQLite database is created automatically at `.data/mastermind.sqlite`. Node may display an experimental SQLite warning.

The default opponent is prominently labeled **Local solver — not JEV**. Local matches never enter official rankings. To call real JEV, copy `.env.example` to `.env`, provide `TYPESAFE_API_KEY`, and restart. This enables real provider calls but **does not enable ranked play on the loopback development server**. See [deployment](docs/DEPLOYMENT.md) for trusted public deployment and Discord setup.

## What is included

| Area | Implementation |
|---|---|
| Game | Four positions, six letter-coded colors, repeats, ten guesses, human and JEV alternate codebreaking legs |
| Opponent | Four bounded difficulty policies; real TypeSafe HTTP adapter; forced/local/fallback decisions explicitly separated |
| Analytics | Per-turn deduction, entropy, expected and realized information, exact partitions, all-1,296-guess counterfactual comparisons, reliability and timing |
| Exports | Full match JSON; played moves, decisions, and **every legal alternative at every turn** as CSV; replay JSON; retained account record |
| Identity | Discord `identify` OAuth, rotating secure sessions, signed guild/channel launch interactions |
| Ranked results | Server-held secrets, immutable salted commitments, authoritative feedback, replay verification, idempotent updates |
| Standings | World, Server, Channel; separate configuration/difficulty cohorts; established/provisional records and shared ranks |
| History | Account/session totals, wins/losses/draws, penalized guesses, streaks, 90-day UTC activity, paginated retained history |
| Operations | Redacted events, bounded durable quotas, leased AI calls, retry/fallback auditing, recovery/retention task |
| Evidence | Tests, exhaustive feedback verification, actual finite-space baseline results, raw data, screenshots, example exports |

### What “exhaustive” means here

Every post-match move can be compared against **all 1,296 legal guesses**, with exact one-step partition calculations. The optional alternatives export includes a row and feedback distribution for each of those guesses at every played turn. The included baseline benchmark visits **all 1,296 possible secrets for each of eight policies**: 10,368 complete codebreaking runs.

This is exhaustive over the implemented finite configuration, not a claim that every possible UI race, production environment, human behavior, or multi-step optimal strategy has been proved. Candidate-set analytics use a uniform reference distribution, not an inferred human prior.

## Play

Choose a four-symbol code, then break the server's independently generated code. The opponent subsequently breaks yours. Feedback is **exact / near**: a correct color in its correct position versus a correct color in a different position, without double-counting repeats. Lower codebreaking cost wins; an unsolved leg costs 11. Equal costs draw. No time bonuses or arbitrary points.

Click slots and palette buttons, or use A–F, arrow keys, Backspace, and Enter. A repeated submitted guess consumes an attempt; an HTTP retry does not. Full human move analysis unlocks only after the match finishes. Browser practice also works when an already loaded page cannot reach the API; it stores no official scores and does not claim to be JEV.

## Verification commands

```sh
npm test
npm run test:exhaustive
npm run bench:smoke
npm run bench:exhaustive
npm run verify -- reports/examples/sample-replay.json
```

These commands need only Node and the source tree. The finite-space benchmark can consume significant CPU for tens of seconds or longer depending on hardware. Its counterfactual cache reduces repeated calculations without changing choices.

Optional browser/deployment tooling requires network access:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

`@playwright/test` and Wrangler are development dependencies only; nothing is bundled into the browser. An npm lockfile was not fabricated: the build environment could not reach the npm registry. Generate and review a lockfile in your connected environment before production deployment.

## Validation and limits

See [the packaged validation report](reports/VALIDATION.md) for exact completed checks and limitations. Live TypeSafe inference, real Discord authorization/installation, and Cloudflare deployment were **not** executed with production credentials. Their boundaries are implemented and exercised with controlled fixtures.

The environment's managed Chromium blocked ordinary URL navigation. An additional **offline DOM + real Web Worker + actual loopback-API bridge** suite exercised the interface and generated screenshots. It did not substitute for native browser cookie, CSP, or CORS validation; a normal Playwright HTTP-origin suite is provided for staging.

## Documentation map

- [Analytics dictionary and formulas](docs/ANALYTICS.md), [machine-readable field inventory](docs/analytics-field-inventory.json)
- [A–Z architecture and implementation status](docs/ARCHITECTURE.md)
- [API contract](docs/API.md), [database migration](schema/0001.sql)
- [Deployment and Discord runbook](docs/DEPLOYMENT.md)
- [Security boundaries and release checklist](docs/SECURITY.md)
- [Testing and benchmarking](docs/TESTING.md)
- [Source references](docs/SOURCES.md), [requirement traceability](docs/TRACEABILITY.md)
- [Measured baseline results](reports/benchmark-exhaustive/README.md)

All example game exports were generated by scripted local play. They are not human-study data, real Discord accounts, or live JEV measurements. No real credentials, session database, or installed dependencies are included in the ZIP.
