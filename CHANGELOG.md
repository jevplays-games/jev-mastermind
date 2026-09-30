# Changelog

## Unreleased

Discord Activity mode: bearer-token sessions, an `/api/activity/*` sign-in exchange and frame_id-gated framing headers, described in `docs/ACTIVITY.md`. Game rules, policy, prompt and model behavior are unchanged, so no version was bumped.

Default match difficulty is now `jev` (minimax-filtered) instead of `normal`; a difficulty the player has already chosen is still restored from local storage. Leaderboard and analytics filters are unchanged, and browser practice remains an explicitly local, unranked solver.

Response validation now derives the probability-sum tolerance from the provider's 0.01 reporting grain. The previous fixed 0.001 window rejected every real response, so live JEV decisions silently fell back; the test fixtures returned exact one-hot distributions and could not catch it.

## 1.0.0 — 2026-09-22

Implemented the two-leg game, four structured policies, live TypeSafe adapter, explicit practice/fallback modes, authoritative match API and replay commitments, Discord identity/launch flows, D1 schema and local SQLite adapter, cohort leaderboards, record/operational analytics, exhaustive all-alternative analysis and exports, tests, baseline harness and deployment documentation.

Packaged results distinguish executed native/exhaustive/offline-DOM checks from unperformed credentialed integrations and conventional browser-origin tests. No production deployment is implied.
