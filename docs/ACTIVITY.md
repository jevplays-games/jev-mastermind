# Discord Activity mode

Mastermind can run as a Discord Activity. Discord loads the game in an iframe on `https://<DISCORD_CLIENT_ID>.discordsays.com`, which proxies to `https://mastermind.jevplay.games`. Nothing changes for the normal browser flow.

## What is different inside an Activity

- **Sign-in.** When the page URL carries Discord's `frame_id`, the client loads `/activity.js`, which uses the vendored Embedded App SDK (`public/vendor/discord-embedded-app-sdk.js`, `@discord/embedded-app-sdk` 2.5.0, MIT) to call `authorize` (scope `identify`). The code is posted to `POST /api/activity/session`, which exchanges it **without a redirect URI** using the existing `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`, upserts the user exactly as the OAuth callback does, and creates a 24-hour session. The response carries a bearer token, the CSRF token and the Discord access token (returned once so the SDK can `authenticate`; never stored).
- **Bearer sessions.** Browsers do not send the SameSite cookie to the iframe. The client keeps the bearer token in memory and sends `Authorization: Bearer <token>`. Only the SHA-256 of the token is stored in `web_sessions`.
- **Origin.** A bearer-authenticated mutation may come from `https://<DISCORD_CLIENT_ID>.discordsays.com`. Cookie sessions, other origins and other applications' `discordsays.com` origins are still rejected, and the CSRF token is still required.
- **Framing.** Only non-API documents loaded with `frame_id` are sent with `frame-ancestors https://discord.com https://ptb.discord.com https://canary.discord.com` (and without `X-Frame-Options`). Everything else, including every API response, keeps `DENY` / `frame-ancestors 'none'`. The rest of the CSP is unchanged; scripts stay same-origin, which is why the SDK is vendored.
- Session creation has its own quota (`activity-session`, 60 per hour per client bucket). Discord's proxy may present a shared client address, so raise it if legitimate players are throttled.

Ranked eligibility, match ownership (`owner_key` / `discord_user_id`), JEV provenance and every game rule are untouched.

## Developer Portal settings

1. Enable **Activities** for the application.
2. Under Activities > URL Mappings, map prefix `/` to `mastermind.jevplay.games`.
3. Enable the Activity in a test guild and launch it from the App Launcher.

## Command registration

Discord creates a primary Entry Point command when Activities are enabled. `npm run discord:register` upserts `/play` with a single POST and does not bulk-overwrite, so the Entry Point command is preserved. If registration is ever changed to a bulk overwrite (`PUT`), include the existing Entry Point command in the payload or Discord will reject or drop it.

## Not verified here

The flow was tested against fixture Discord responses only. It has not been exercised inside a live Discord client.
