// Discord Activity support. Discord loads the game in an iframe on <application id>.discordsays.com, where a
// SameSite cookie is not sent, so the game signs the player in through the Embedded App SDK and then keeps a
// bearer session token in memory. Nothing here changes the normal browser sign-in.
import {check,json,readJson,onlyKeys,randomToken,sha256} from './security.js';
import {discordUser,upsertDiscordUser} from './auth.js';
import {run,quota,event} from './db.js';

export function activityConfig(cfg,env) {
  check(cfg.discordReady,503,'Discord sign-in is not configured.');
  return {clientId:env.DISCORD_CLIENT_ID};
}
export async function createActivitySession(request,db,cfg,env,bucket,fetchImpl=fetch) {
  check(cfg.discordReady,503,'Discord sign-in is not configured.');
  const origin=request.headers.get('origin');
  check(origin&&(origin===cfg.activityOrigin||origin===cfg.origin),403,'Origin is not permitted.','origin');
  await quota(db,`activity-session:${bucket}`,60,3600000);
  const body=await readJson(request);onlyKeys(body,['code']);
  check(typeof body.code==='string'&&body.code.length>0&&body.code.length<=2048,400,'Authorization code is missing.');
  // An SDK authorization code is exchanged without a redirect URI.
  const user=await discordUser(env,body.code,fetchImpl,null);
  await upsertDiscordUser(db,user);
  const now=Date.now(),raw=randomToken(),csrf=randomToken();
  await run(db,'INSERT INTO web_sessions(token_hash,owner_key,discord_user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?,?)',await sha256(raw),randomToken(),user.id,csrf,now,now+86400000);
  await event(db,'oauth_success');
  // The Discord access token is returned once so the SDK can authenticate; it is never stored or logged.
  return {token:raw,csrf,accessToken:user.accessToken,user:{discord_user_id:user.id,display_name:user.displayName}};
}
