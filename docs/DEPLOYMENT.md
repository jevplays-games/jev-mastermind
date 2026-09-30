# Deployment runbook

## 1. Local operation

Node.js 22.16+ supplies native Fetch, Web Crypto, the test runner, and `node:sqlite`. Run `npm start`; no `npm install` is necessary for local play/tests/benchmarks. The server binds only `127.0.0.1` and rejects unexpected Host headers. It is not an Internet-facing production HTTP server.

Copy `.env.example` to `.env` to set a real `TYPESAFE_API_KEY`; leave it empty to use a labeled local solver. `JEV_MODEL` defaults to the exact pin `jev-1.13.0`. Restart after changes. Do not expose your `.env` or `.data` directory. Browser practice stores known secret choices/preferences locally but never official results.

## 2. Worker and D1

Install the optional development tools in a network-enabled environment and review the resulting lockfile:

```sh
npm install
npx wrangler login
npx wrangler d1 create mastermind
```

Put the returned D1 database ID into `wrangler.toml` in place of `REPLACE_WITH_YOUR_D1_DATABASE_ID`. Set `APP_ORIGIN` to the **exact HTTPS origin** that will serve both assets and API, whether a configured custom domain or the actual Worker address. Do not keep the example hostname. Configure the corresponding Worker custom domain in your account when using one.

```sh
npm run db:remote
npx wrangler secret put QUOTA_SALT
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put ANALYTICS_ADMIN_TOKEN
npm run deploy
```

Generate independent high-entropy operator secrets locally, for example:

```sh
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
```

Use separate values for quota salt and admin token. Client ID and the verification public key are not confidential, but keeping deployment bindings together reduces configuration errors. The private TypeSafe key and Discord client secret must remain server-side.

Wrangler's local Worker mode uses `.dev.vars` for local secret bindings; the Node loopback server instead uses `.env`. Do not assume `.env` automatically supplies production Worker secrets.

Assets route through the Worker to receive uniform CSP and related headers. D1 migrations are in `schema/`. The configured 1,000 ms CPU allowance may require a suitable paid Worker plan; profile actual deployment limits and cold-start candidate calculation before enabling ranking. No promise of a free-tier fit is made.

## 3. Discord application

Create/use a Discord application you control. Configure Guild Install support. The three permission contexts are deliberately separate:

| Operation | Scope / proof |
|---|---|
| Player login | OAuth `identify` only |
| Guild installation | `applications.commands`, Guild Install context |
| Command registration | Application-owner client-credentials token with `applications.commands.update` |
| Individual launch | Signed interaction carrying the launching member, guild and channel |

Register the exact redirect URI:

```
https://YOUR-ACTUAL-ORIGIN/api/auth/discord/callback
```

Set the Interactions Endpoint URL:

```
https://YOUR-ACTUAL-ORIGIN/api/discord/interactions
```

Replace `YOUR-ACTUAL-ORIGIN` with the actual hostname, not a literal placeholder. Ensure `DISCORD_PUBLIC_KEY` and `DISCORD_CLIENT_ID` belong to that same application. Discord's verification PING must succeed before the endpoint is usable.

With your client ID/secret supplied privately, inspect then register the command:

```sh
npm run discord:register -- --dry-run
npm run discord:register
```

For development, `DISCORD_TEST_GUILD_ID` registers the command to one test guild. Omit it for the global command constrained to guild installation and guild interaction contexts. The script POST-upserts `/play`; it does **not** bulk-overwrite unrelated commands. Registering a command is an explicit write to the application and is never done merely by starting the game.

Install the application into a test server with `applications.commands`. Run `/play game:Mastermind` from the participating channel. The resulting personal ephemeral launch link expires in five minutes, must be redeemed once, and must match the OAuth user. Redeemed context lasts fifteen minutes for starting games/viewing contextual boards; started matches retain their snapshot. Immediate revocation after leaving a guild/channel is not implemented.

No gateway process, privileged bot token, email scope, or member-list scope is required by this design.

## 4. Enable ranked play only after staging checks

Keep `RANKED_ENABLED = "false"` initially. Confirm genuine JEV responses using the pinned model, OAuth session rotation, signed launch redemption, same-origin cookies, CSP, mobile browser behavior, one complete replay-verified result, a provider-failure exclusion, and all three scoped leaderboard queries in staging.

Then set `RANKED_ENABLED = "true"` and redeploy. Ranked eligibility requires real provider configuration; removing credentials during a match causes a labeled fallback and exclusion, not silent local substitution. Exact model, prompt, policy, and selector configuration is hashed into the cohort ID.

A production configuration without an HTTPS origin or quota salt is rejected. Never enable the local-development bypass on an Internet origin.

## 5. Quotas and recovery

Default application limits include 300 API requests/minute per salted client bucket; bounded guest-session creation; 10 guest or 20 account match starts/hour; up to three active matches; one active ranked match; 2,000 global starts/hour; 10,000 reserved provider attempts/day. Environment values may reduce global limits.

Actual known provider attempts and reserved attempts differ: up to two attempts are reserved before a decision to bound worst-case spending. Do not treat unused reservations as provider usage. Expired leases avoid blindly retrying calls that may already have reached the provider.

The five-minute scheduled Worker invocation expires at most 50 abandoned human legs per sweep, advances at most one JEV action for each of ten stale opponent legs, and removes expired retention records. Browser advancement is immediate; the cron is recovery rather than the normal animation loop. Human legs expire after 24 hours. Waiting on the opponent never causes a human abandonment penalty.

## 6. Operations and retention

`/api/admin/analytics?days=7` requires `Authorization: Bearer <ANALYTICS_ADMIN_TOKEN>` and is not an end-user browser feature. Do not paste this secret into frontend code. Events contain allowlisted operational fields; inspect provider usage completeness before estimating costs.

Events: 30 days. Completed anonymous matches: 30 days. Launch-ticket cleanup retains expired ticket records briefly for replay/duplicate handling. Expired sessions and rate buckets are removed. Signed-in history is retained until the operator's policy deletes it; publish and implement an appropriate account-deletion procedure before public release.

Back up D1 using provider-supported facilities and test a restore. Backups contain completed codes and authentication metadata; protect them. Restoring a database is not automatically a safe rollback to older rules code. Keep compatible engine versions for retained replays. Stage configuration changes as new cohorts.

## 7. Explicitly unperformed here

No real account was created, no command was registered to your Discord application, no remote D1 database was created, no Worker was deployed, and no paid JEV calls were made. The npm registry was unavailable in the creation environment, so Wrangler deployment and its dependency graph were not executed. The repository includes executable integration code and runbooks, not credentials or a claim of live production certification.

## 8. GoDaddy Node.js hosting

The same `server/dev.mjs` runs as a plain Node app in production mode. Production mode is on when `NODE_ENV=production` **or** `APP_ORIGIN` is an https origin with a non-loopback host (GoDaddy's runtime may not set `NODE_ENV`, and platform env overrides `.env`). Loopback or http origins stay in local dev mode. Upload a zip with `package.json` and `.env` at its root; the host runs `npm run build` (a no-op) then `npm start` (`node --env-file-if-exists=.env server/dev.mjs`).

- Binds `HOST` (default `0.0.0.0`) on the platform-injected `PORT`. `LOCAL_DEV` is forced off, so production rules apply: `APP_ORIGIN` must be the exact HTTPS origin, `QUOTA_SALT` is required, and Discord auth, interactions and the Activity work as in the Worker. Ranked play follows `RANKED_ENABLED` (unset means off, as in `wrangler.toml`).
- Requests whose `Host` (or `X-Forwarded-Host` when `TRUST_PROXY=1`) is not the `APP_ORIGIN` host get 421. The one exception is `GET /api/health` (static, no sensitive data), which answers 200 for any Host so the platform health checker, which sends a preview Host, passes.
- The server binds the platform's `HOST` and `PORT` as given (process env wins over `.env`); nothing is forced. Production mode with `HOST=127.0.0.1` binds loopback only. TLS terminates at the proxy.
- The Worker's per-client buckets use `CF-Connecting-IP`. The Node server ignores any client-supplied value and sets it from the socket address, or from the last `X-Forwarded-For` entry when `TRUST_PROXY=1`. Set `TRUST_PROXY=1` only behind a proxy that appends the real client address; with `0` all clients behind the proxy share one bucket.
- Env keys: `NODE_ENV`, `APP_ORIGIN`, `QUOTA_SALT`, `ANALYTICS_ADMIN_TOKEN`, `TYPESAFE_API_KEY`, `JEV_MODEL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_PUBLIC_KEY`, `MAX_STARTS_PER_HOUR`, `MAX_PROVIDER_ATTEMPTS_PER_DAY`, optional `HOST`, `TRUST_PROXY`, `RANKED_ENABLED`, `DB_PATH`.
- SQLite lives at `data/mastermind.sqlite` (private; only `public/` is served). The filesystem is ephemeral: a redeploy loses all matches and accounts. Accepted for this deployment.
- The Worker cron (`scheduled`) is replaced by the in-process `maintenance` timer (every 60 s, unref'd), which recovers stalled steps and sweeps expired rows.
