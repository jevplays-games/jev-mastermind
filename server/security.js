import { sha256,randomToken } from '../public/typecrack/verify.js';
export { sha256, randomToken };
export class HttpError extends Error { constructor(status,message,code='request_error') {super(message);this.status=status;this.code=code;} }
export const check=(condition,status,message,code)=>{if(!condition)throw new HttpError(status,message,code);};
// LEGACY_ORIGINS is an optional transitional allowlist, so a typo in it must never take the canonical host down, and
// nothing but a bare origin may widen it (orchestrator rule D9). An entry is accepted only if it parses, is HTTPS (plain
// HTTP only for loopback under LOCAL_DEV), contains no '@', '?', '#' or '*', and equals its own url.origin once a single
// trailing '/' is removed (so no userinfo, path, query or fragment). Hostnames must also be plain DNS labels or an IPv6
// literal. Anything else is skipped, never thrown, and each distinct bad entry is logged once per isolate outside local
// development (the reason only, never the entry).
const warnedLegacyOrigins=new Set();
const LOOPBACK=['127.0.0.1','localhost','[::1]'];
const HOSTNAME=/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$|^\[[0-9a-f:.]+\]$/;
function legacyOriginProblem(entry,url,env) {
  if(!url)return 'unparseable';
  if(!(url.protocol==='https:'||(env.LOCAL_DEV==='true'&&url.protocol==='http:'&&LOOPBACK.includes(url.hostname))))return 'not_https';
  if(/[@?#*]/.test(entry))return 'forbidden_character';
  if(entry.replace(/\/$/,'')!==url.origin)return 'not_bare_origin';
  if(!HOSTNAME.test(url.hostname))return 'invalid_host';
  return null;
}
export function parseLegacyOrigins(env) {
  const origins=[];
  for(const entry of String(env.LEGACY_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)) {
    let url=null;try{url=new URL(entry);}catch{}
    const reason=legacyOriginProblem(entry,url,env);
    if(!reason){origins.push(url.origin);continue;}
    if(env.LOCAL_DEV!=='true'&&!warnedLegacyOrigins.has(entry)){warnedLegacyOrigins.add(entry);console.warn(JSON.stringify({event:'legacy_origin_skipped',reason}));}
  }
  return origins;
}
export function config(env,requestOrigin=null) {
  const canonicalOrigin=new URL(env.APP_ORIGIN||'http://127.0.0.1:8787').origin;
  // Pre-rename hostnames keep working until cutover. A request on one of them is answered on that origin
  // (OAuth callback, launch links, Origin checks), so its sessions and Discord settings stay consistent.
  const legacyOrigins=parseLegacyOrigins(env);
  const origin=requestOrigin&&legacyOrigins.includes(requestOrigin)?requestOrigin:canonicalOrigin;
  const local=env.LOCAL_DEV==='true' && LOOPBACK.includes(new URL(origin).hostname);
  if(!local && new URL(canonicalOrigin).protocol!=='https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
  if(!local && !env.QUOTA_SALT) throw new Error('Production requires QUOTA_SALT.');
  const model=env.JEV_MODEL||'jev-1.13.0';
  if(!/^jev-\d+\.\d+\.\d+$/.test(model)) throw new Error('Pin an exact Jev model version.');
  const activityOrigin=/^\d{17,20}$/.test(env.DISCORD_CLIENT_ID??'')?`https://${env.DISCORD_CLIENT_ID}.discordsays.com`:null;
  return {origin,canonicalOrigin,legacyOrigins,local,model,activityOrigin,cookieName:local?'jev_local':'__Host-jev',jevReady:Boolean(env.TYPESAFE_API_KEY),
    discordReady:Boolean(env.DISCORD_CLIENT_ID&&env.DISCORD_CLIENT_SECRET),timeoutMs:4500,policyVersion:'mm-policy-v1',promptVersion:'mm-prompt-v2',
    rankedEnabled:env.RANKED_ENABLED==='true'&&!local};
}
export const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
// Discord shows an Activity inside its own iframe. Only a page loaded with Discord's frame_id may be framed, and only by Discord.
export const ACTIVITY_FRAME_ANCESTORS='frame-ancestors https://discord.com https://ptb.discord.com https://canary.discord.com';
export function secureHeaders(response,{activityFrame=false}={}) {
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Frame-Options','DENY');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if(activityFrame){headers.delete('X-Frame-Options');headers.set('Content-Security-Policy',headers.get('Content-Security-Policy').replace("frame-ancestors 'none'",ACTIVITY_FRAME_ANCESTORS));}
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export function cookie(req,name) {
  return (req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||null;
}
export function sessionCookie(token,cfg,age=30*86400) {
  return `${cfg.cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${cfg.local?'':'; Secure'}`;
}
export function constantTimeEqual(a,b) {
  if(typeof a!=='string'||typeof b!=='string')return false;
  let diff=a.length^b.length; const n=Math.max(a.length,b.length);
  for(let i=0;i<n;i++) diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return diff===0;
}
export function requireOrigin(request,cfg,session=null) {
  // The Activity origin is accepted only for bearer-authenticated requests, never for a cookie session.
  const origin=request.headers.get('origin');
  check(origin===cfg.origin||(session?.via==='bearer'&&cfg.activityOrigin&&origin===cfg.activityOrigin),403,'Origin is not permitted.','origin');
  const site=request.headers.get('sec-fetch-site');check(!site||site==='same-origin'||site==='none',403,'Cross-site request rejected.','origin');
}
export function requireCsrf(request,session,cfg) {
  requireOrigin(request,cfg,session);
  check(session&&constantTimeEqual(request.headers.get('x-csrf-token'),session.csrf),403,'Invalid CSRF token.','csrf');
}
export async function boundedText(request,limit=16384) {
  const length=Number(request.headers.get('content-length')||0);check(length<=limit,413,'Request is too large.');
  if(!request.body)return '';
  const reader=request.body.getReader(), chunks=[];let total=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new HttpError(413,'Request is too large.');}chunks.push(value);}}
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder().decode(bytes);
}
export async function readJson(request) {
  check((request.headers.get('content-type')||'').split(';')[0]==='application/json',415,'Use application/json.');
  try {const data=JSON.parse(await boundedText(request));check(data&&typeof data==='object'&&!Array.isArray(data),400,'Expected a JSON object.');return data;}
  catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Malformed JSON.');}
}
export const validRequestId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(id);
export const validSnowflake=id=>typeof id==='string'&&/^\d{6,22}$/.test(id);
export function onlyKeys(object,allowed) {check(Object.keys(object).every(k=>allowed.includes(k)),422,'Unexpected request field.');}
export async function clientBucket(request,env,cfg) {
  const ip=cfg.local?'loopback':request.headers.get('CF-Connecting-IP');
  // Never trust X-Forwarded-For. Deployed Worker receives Cloudflare's address header.
  check(ip,503,'Client address is unavailable.');
  return sha256((env.QUOTA_SALT||'local-only')+'|'+new Date().toISOString().slice(0,10)+'|'+ip);
}
