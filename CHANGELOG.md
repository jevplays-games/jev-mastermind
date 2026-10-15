# Changelog

## Unreleased

Renamed Mastermind to **Typecrack** under the jevplay.games brand (issue #13). Display name, page title and meta, header wordmark (`jevplay.games`), footer, Discord command text and launch button, export filenames (`typecrack-*`), package and Worker name (`jev-typecrack`), canonical origin (`https://typecrack.jevplay.games`) and the shared module directory (`public/typecrack/`) change. The opponent is written Jev. Theme moves to the shared pink/ink pixel-window brand with the default ink accent; peg art is unchanged pending the art issue. The D1 database keeps its existing name `mastermind`.

Compatibility: new state and replays carry `game:"typecrack"`; stored state, exported replays, match creation and Discord `/play` still accept `mastermind`. New matches commit secrets under `jev-typecrack-commit-v2`; verification also accepts `jev-mastermind-commit-v1`, so every earlier commitment and replay still verifies (`tests/rename-compat.test.mjs`). `/play/mastermind` answers 301 to `/play/typecrack` with its query. `mastermind.jevplay.games` stays routed and is served on its own origin through the new `LEGACY_ORIGINS` setting until cutover. The Node server keeps using an existing `mastermind.sqlite`.

Prompt version bumped to `mm-prompt-v2`: the provider instructions now name Typecrack and the request carries `game:"typecrack"`. Rules (`mm-4x6-10-v1`), policy (`mm-policy-v1`) and analytics (`mm-analytics-v1`) behaviour is unchanged, so those labels are not changed. Because the opponent configuration hash includes the prompt version, every new match, local-opponent ones included, gets a new `configId` cohort (local opponent `mm-118f378e1c8d3f67abd3d254` → `mm-f93deb5ecdf108bf4d6fb8bd`; Jev `mm-9e42af838644c074c3cf8938` → `mm-f576f9cb98a973f69b670fc8`); v1 cohorts stay separate and are not relabelled. **Visible effect:** leaderboards and community analytics default to the current `configId`, so pre-rename matches drop out of those default views. They are still stored and still reachable with `?configId=<old id>`, and the personal record still lists them as their own configuration groups. Ranked play is off, so no live standings move. The benchmark was regenerated for the moved and edited source files.

Discord Activity mode: bearer-token sessions, an `/api/activity/*` sign-in exchange and frame_id-gated framing headers, described in `docs/ACTIVITY.md`. Game rules, policy, prompt and model behavior are unchanged, so no version was bumped.

Default match difficulty is now `jev` (minimax-filtered) instead of `normal`; a difficulty the player has already chosen is still restored from local storage. Leaderboard and analytics filters are unchanged, and browser practice remains an explicitly local, unranked solver.

Response validation now derives the probability-sum tolerance from the provider's 0.01 reporting grain. The previous fixed 0.001 window rejected every real response, so live JEV decisions silently fell back; the test fixtures returned exact one-hot distributions and could not catch it.

## 1.0.0 — 2026-09-22

Implemented the two-leg game, four structured policies, live TypeSafe adapter, explicit practice/fallback modes, authoritative match API and replay commitments, Discord identity/launch flows, D1 schema and local SQLite adapter, cohort leaderboards, record/operational analytics, exhaustive all-alternative analysis and exports, tests, baseline harness and deployment documentation.

Packaged results distinguish executed native/exhaustive/offline-DOM checks from unperformed credentialed integrations and conventional browser-origin tests. No production deployment is implied.
