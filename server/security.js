import { sha256,randomToken } from '../public/mastermind/verify.js';
export { sha256, randomToken };
export class HttpError extends Error { constructor(status,message,code='request_error') {super(message);this.status=status;this.code=code;} }
export const check=(condition,status,message,code)=>{if(!condition)throw new HttpError(status,message,code);};
export function config(env) {
  const origin=new URL(env.APP_ORIGIN||'http://127.0.0.1:8787').origin;
  const local=env.LOCAL_DEV==='true' && ['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname);
  if(!local && new URL(origin).protocol!=='https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
  if(!local && !env.QUOTA_SALT) throw new Error('Production requires QUOTA_SALT.');
  const model=env.JEV_MODEL||'jev-1.13.0';
  if(!/^jev-\d+\.\d+\.\d+$/.test(model)) throw new Error('Pin an exact JEV model version.');
  return {origin,local,model,cookieName:local?'jev_local':'__Host-jev',jevReady:Boolean(env.TYPESAFE_API_KEY),
    discordReady:Boolean(env.DISCORD_CLIENT_ID&&env.DISCORD_CLIENT_SECRET),timeoutMs:4500,policyVersion:'mm-policy-v1',promptVersion:'mm-prompt-v1',
    rankedEnabled:env.RANKED_ENABLED==='true'&&!local};
}
export const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
export function secureHeaders(response) {
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Frame-Options','DENY');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
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
export function requireOrigin(request,cfg) {
  check(request.headers.get('origin')===cfg.origin,403,'Origin is not permitted.','origin');
  const site=request.headers.get('sec-fetch-site');check(!site||site==='same-origin'||site==='none',403,'Cross-site request rejected.','origin');
}
export function requireCsrf(request,session,cfg) {
  requireOrigin(request,cfg);
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
