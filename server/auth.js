import { check,cookie,sessionCookie,randomToken,sha256,HttpError,validSnowflake } from './security.js';
import { one,run,all,quota,event } from './db.js';
const DISCORD='https://discord.com/api/v10';
export async function loadSession(request,db,cfg,{create=false,bucket='unknown'}={}) {
  const token=cookie(request,cfg.cookieName);
  if(token&&/^[a-f0-9]{64}$/.test(token)) {
    const row=await one(db,'SELECT * FROM web_sessions WHERE token_hash=? AND expires_at>?',await sha256(token),Date.now());
    if(row)return {...row,setCookie:null};
  }
  if(!create)return null;
  await quota(db,`session:${bucket}`,30,3600000);
  const raw=randomToken(),session={token_hash:await sha256(raw),owner_key:randomToken(),discord_user_id:null,csrf:randomToken(),created_at:Date.now(),expires_at:Date.now()+30*86400000};
  await run(db,'INSERT INTO web_sessions(token_hash,owner_key,discord_user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?,?)',session.token_hash,session.owner_key,null,session.csrf,session.created_at,session.expires_at);
  return {...session,setCookie:sessionCookie(raw,cfg)};
}
export async function beginOAuth(session,db,cfg,env) {
  check(cfg.discordReady,503,'Discord sign-in is not configured.');
  const state=randomToken();
  await run(db,'UPDATE web_sessions SET oauth_state_hash=?,oauth_expires_at=? WHERE token_hash=?',await sha256(state),Date.now()+600000,session.token_hash);
  const url=new URL('https://discord.com/oauth2/authorize');
  url.search=new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,response_type:'code',redirect_uri:cfg.origin+'/api/auth/discord/callback',scope:'identify',state}).toString();
  return new Response(null,{status:302,headers:{Location:url.href,...(session.setCookie?{'Set-Cookie':session.setCookie}:{})}});
}
export async function oauthCallback(request,session,db,cfg,env,fetchImpl=fetch) {
  check(session,400,'Sign-in browser session is missing.');
  const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
  check(state&&/^[a-f0-9]{64}$/.test(state),400,'Invalid OAuth state.');
  const consumed=await one(db,`UPDATE web_sessions SET oauth_state_hash=NULL,oauth_expires_at=NULL
    WHERE token_hash=? AND oauth_state_hash=? AND oauth_expires_at>? RETURNING token_hash`,session.token_hash,await sha256(state),Date.now());
  check(consumed,400,'OAuth state has expired or was already used.');
  if(url.searchParams.has('error'))return new Response(null,{status:302,headers:{Location:cfg.origin+'/?auth=cancelled'}});
  check(code&&code.length<=2048,400,'Authorization code is missing.');
  const tokenResponse=await fetchImpl(DISCORD+'/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,
      redirect_uri:cfg.origin+'/api/auth/discord/callback'}),signal:AbortSignal.timeout(8000)});
  check(tokenResponse.ok,502,'Discord authorization exchange failed.');
  const token=await tokenResponse.json();check(typeof token.access_token==='string',502,'Discord did not return an access token.');
  const identityResponse=await fetchImpl(DISCORD+'/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(8000)});
  check(identityResponse.ok,502,'Discord identity lookup failed.');
  const user=await identityResponse.json();check(validSnowflake(user.id),502,'Invalid Discord identity.');
  const name=String(user.global_name||user.username||'Discord player').slice(0,80),now=Date.now();
  await run(db,`INSERT INTO users(discord_user_id,display_name,avatar_ref,created_at,last_seen_at) VALUES(?,?,?,?,?)
    ON CONFLICT(discord_user_id) DO UPDATE SET display_name=excluded.display_name,avatar_ref=excluded.avatar_ref,last_seen_at=excluded.last_seen_at`,user.id,name,typeof user.avatar==='string'?user.avatar.slice(0,80):null,now,now);
  const raw=randomToken(),hash=await sha256(raw),csrf=randomToken();
  await db.batch([
    db.prepare(`INSERT INTO web_sessions(token_hash,owner_key,discord_user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?,?)`).bind(hash,session.owner_key,user.id,csrf,now,now+30*86400000),
    db.prepare('DELETE FROM web_sessions WHERE token_hash=?').bind(session.token_hash)
  ]);
  // Access and refresh tokens are intentionally not persisted.
  await event(db,'oauth_success');
  return new Response(null,{status:302,headers:{Location:cfg.origin+'/?auth=success','Set-Cookie':sessionCookie(raw,cfg)}});
}
export function sessionContext(session) {
  if(!session?.context_json||session.context_expires_at<=Date.now())return null;
  try{return JSON.parse(session.context_json);}catch{return null;}
}
export async function me(session,db,cfg) {
  const user=session.discord_user_id?await one(db,'SELECT discord_user_id,display_name FROM users WHERE discord_user_id=?',session.discord_user_id):null;
  const active=await all(db,`SELECT id,difficulty,phase,started_ranked,created_at FROM matches
    WHERE (owner_key=? OR discord_user_id=?) AND phase IN ('human_break','jev_break') ORDER BY created_at DESC LIMIT 5`,session.owner_key,session.discord_user_id);
  return {user,csrf:session.csrf,context:sessionContext(session),activeMatches:active,
    capabilities:{jev:cfg.jevReady,discord:cfg.discordReady,ranked:cfg.rankedEnabled&&cfg.jevReady&&cfg.discordReady,model:cfg.model},
    mode:cfg.jevReady?'JEV + deterministic analysis':'Local deterministic opponent — not JEV'};
}
