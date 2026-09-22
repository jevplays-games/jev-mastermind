# API contract

All endpoints are same-origin. Browser writes require `Content-Type: application/json`, session cookie, matching `Origin`, and `X-CSRF-Token` from `/api/me`. Bodies reject unknown keys. Most JSON bodies are limited to 16 KiB; Discord raw interactions have a separate 64 KiB bound. No endpoint accepts a client-submitted score or feedback value.

| Method / path | Request | Response / behavior |
|---|---|---|
| GET `/api/health` | None | Game/rules health; not a provider-readiness check |
| GET `/api/me` | Optional session | Establishes guest session; user, CSRF, capabilities, context, active matches |
| GET `/api/auth/discord` | Browser session | OAuth state creation; redirect to Discord |
| GET `/api/auth/discord/callback` | Discord code/state or cancellation | Validate/consume state; exchange; rotate session; redirect |
| POST `/api/logout` | Session + CSRF | Revoke session and clear cookie |
| POST `/api/discord/interactions` | Discord raw body and signature headers | Verified PING or ephemeral guild launch ticket |
| POST `/api/context/redeem` | `{ticket}` | Matching-user single-use context redemption |
| POST `/api/matches` | Creation object below | 201 authoritative public state; same request ID is idempotent |
| GET `/api/matches/:id` | Match owner | Public projection; terminal reveal; may expire stale human leg |
| POST `/api/matches/:id/actions` | Action object below | 200 applied/duplicate snapshot; 202 active JEV lease |
| GET `/api/matches/:id/replay` | Owner; terminal match | Compact replay including reveals, never official import |
| GET `/api/matches/:id/analytics` | Owner; terminal match | Selected-guess-only report; `?format=csv` for played-move CSV |
| GET `/api/analytics/me` | Session | Own retained totals/groups/streaks/90-day series/history |
| GET `/api/leaderboards` | World public; contextual proof for community | Top 50, established/provisional records |
| GET `/api/analytics/overview` | Same scope authorization | Cohort totals and bounded distributions |
| GET `/api/admin/analytics` | Operator bearer token | Events and bounded decision distributions; `?days=1..30` |

## Creation

```json
{
  "game":"mastermind",
  "difficulty":"normal",
  "humanCode":[0,0,2,5],
  "ranked":false,
  "requestId":"unique-client-request-id"
}
```

Symbols are integers 0–5 and the code contains exactly four. Valid difficulty values: `easy`, `normal`, `hard`, `jev`. Secret generation and both commitments occur on the server before the first guess. Ranked requests require a signed-in Discord user, real provider configuration, an enabled production deployment, and no existing active ranked match.

## Actions

```json
{
  "requestId":"another-unique-client-request-id",
  "expectedRevision":0,
  "action":{"type":"GUESS","guess":[0,0,1,1]}
}
```

Other browser action objects are exactly `{"type":"STEP_JEV"}` and `{"type":"RESIGN"}`. Browser-supplied `actor`, JEV code, guild ID, channel ID, feedback, model version, score, and result are rejected. Only the server applies a JEV guess.

Request IDs are bounded strings matching the implementation's validator; the UI generates UUIDs. Same ID + identical body never creates a second move. Same ID + different content gives 409. Receipts retain the accepted action/revision hash; a duplicate returns the **latest authoritative snapshot**, not an obsolete cached board. The response marks `duplicate: true`. This deliberately simplifies recovery from delayed retries.

A STEP_JEV request may return 202 with an existing pending lease. Refresh the match and retry advancement after the pending work completes/expires. Do not issue parallel speculative guesses. A revision conflict returns 409: fetch the latest state before choosing a new action. A network timeout alone does not prove the action failed; preserve its original request ID for retry.

## Scopes, history, exports

Leaderboard/overview parameters: `scope=world|server|channel`, `difficulty=...`, optional `configId=mm-<24 hex digits>`. The omitted configuration is the current server configuration. Supplied guild/channel IDs do not authorize or filter community access. Only the session's verified context is used.

Profile pagination: pass returned `nextCursor` as `before`. Each cursor combines creation time and match ID. Do not invent offsets or treat a 100-row page as complete history. The JSON response includes daily coverage and cohort interpretation.

All-alternative CSV is a browser/CLI calculation from a completed verified replay, not an unrestricted expensive server endpoint. Its data has no authority to update results.

## Errors

```json
{"error":{"code":"stale_revision","message":"Match revision changed or match is complete."}}
```

400 malformed JSON/OAuth state; 401 missing session or invalid Discord signature; 403 CSRF/context/ranked/admin denial; 404 unknown API/match; 409 conflict/active analytics; 413 size limit; 421 origin mismatch; 422 invalid action/configuration; 429 quota; 503 configured service unavailable/invariant recovery. Internal errors use a generic message and a redacted event, not secrets or a stack trace.

Unknown `/api/*` requests return JSON 404, never the SPA shell. Static responses and API responses receive the security-header wrapper.
