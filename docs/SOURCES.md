# Source basis and external references

Source review date: September 22, 2026. These references informed protocol/configuration choices; they are not evidence that external integrations were exercised successfully.

## User-provided basis

`prompts/original-brief.md` preserves the attached “JEV Single-Page Game — Architecture & Implementation Planning Prompt.” The game is Mastermind, and the subsequent instruction requests exhaustive analytics and an actual ZIP project. The implemented A–Z architecture keeps the brief's deterministic rules / structured JEV / backend trust / Discord identity separation.

## Primary technical references

| Reference | Applied to |
|---|---|
| https://docs.typesafe.ai/api | POST `/v1/systemone`, request/answer/usage envelope |
| https://docs.typesafe.ai/primitives/choice | Bounded Choice criteria, probabilities, confidence and option limit |
| https://docs.typesafe.ai/models | Exact model pin `jev-1.13.0`; do not use a moving latest alias |
| https://docs.typesafe.ai/model-jaggedness/jev-1.13 | Keep exact numeric game calculations in deterministic code |
| https://docs.discord.com/developers/topics/oauth2 | Identify scope, code exchange, state, client credentials and `applications.commands.update` |
| https://docs.discord.com/developers/interactions/application-commands | Command registration, Guild Install and interaction contexts |
| https://docs.discord.com/developers/interactions/overview | HTTP interactions and raw-body signature validation |
| https://docs.discord.com/developers/interactions/receiving-and-responding | Prompt initial response and ephemeral launch reply |
| https://developers.cloudflare.com/workers/static-assets/ | Static asset binding and Worker routing |
| https://developers.cloudflare.com/d1/worker-api/prepared-statements/ | Prepared SQL statements and D1 binding interface |
| https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ | Worker cryptographic operations |
| https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.68.0 | Verified published deployment-tool pin, not a claim of latest release |
| https://github.com/microsoft/playwright/releases/tag/v1.58.2 | Verified published browser-test-tool pin, not a claim of latest release |

No remote NPM resolution/install was completed in the build environment, and no dependency lockfile was invented. Reconcile the deployment-tool pin and actual account-supported runtime limits in staging. Public protocol documents can change; pinning and response validation reduce but do not remove that risk.

## Independently derived/measured here

The feedback equations, candidate/entropy/regret calculations, code count, test outcomes and local policy performance are derived from or measured against the included implementation. The exact finite game variant and ranking rules are explicit design decisions. Neither a historical Mastermind solver guarantee nor TypeSafe marketing claims are used as proof of this application's live performance.
