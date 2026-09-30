import test from 'node:test';import assert from 'node:assert/strict';
import {harness,createBody} from './helpers.mjs';
import {handle} from '../server/worker.js';
import {ACTIVITY_FRAME_ANCESTORS} from '../server/security.js';
import {one} from '../server/db.js';
const APP='123456789012345678',ACTIVITY=`https://${APP}.discordsays.com`,IP={'CF-Connecting-IP':'203.0.113.9'};
function discordFetch(calls=[]){return async(url,options)=>{
  calls.push({url:String(url),body:options?.body?String(options.body):null});
  if(String(url).endsWith('/oauth2/token'))return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh'});
  if(String(url).endsWith('/users/@me'))return Response.json({id:'223344556677889900',username:'player',global_name:'Player One',avatar:null});
  throw new Error('unexpected fetch '+url);};}
const call=(h,path,{method='GET',origin=null,body,headers={}}={})=>handle(new Request(h.env.APP_ORIGIN+path,{method,headers:{...IP,...(origin?{Origin:origin}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),h.env,{},discordFetch());
const signIn=async(h,calls=[])=>{const r=await handle(new Request(h.env.APP_ORIGIN+'/api/activity/session',{method:'POST',headers:{...IP,Origin:ACTIVITY,'Content-Type':'application/json'},body:JSON.stringify({code:'sdk-code'})}),h.env,{},discordFetch(calls));return {r,s:await r.json()};};
const bearer=s=>({Authorization:`Bearer ${s.token}`});

test('activity config exposes only the public client id and needs Discord configured',async()=>{
  const h=await harness({production:true}),bare=await harness();
  try{const r=await call(h,'/api/activity/config');assert.equal(r.status,200);assert.deepEqual(await r.json(),{clientId:APP});assert.equal((await call(bare,'/api/activity/config')).status,503);}finally{h.close();bare.close();}
});
test('an SDK code becomes a bearer session: no redirect uri, raw token and provider tokens are not stored',async()=>{
  const h=await harness({production:true}),calls=[];
  try{
    const {r,s}=await signIn(h,calls);assert.equal(r.status,201);assert.match(s.token,/^[a-f0-9]{64}$/);assert.match(s.csrf,/^[a-f0-9]{64}$/);assert.equal(s.accessToken,'fixture-access');assert.equal(s.user.display_name,'Player One');
    const form=new URLSearchParams(calls[0].body);assert.equal(form.get('grant_type'),'authorization_code');assert.equal(form.get('code'),'sdk-code');assert.equal(form.has('redirect_uri'),false);
    assert.equal(r.headers.get('set-cookie'),null,'no cookie is set inside an Activity');
    assert.equal(await one(h.db,'SELECT 1 AS x FROM web_sessions WHERE token_hash=?',s.token),null,'the raw token must not be stored');
    assert.equal(JSON.stringify(await h.db.prepare('SELECT * FROM web_sessions').all()).includes('fixture-'),false);
  }finally{h.close();}
});
test('the bearer session works for reads and for mutations from the activity origin',async()=>{
  const h=await harness({production:true});
  try{
    const {s}=await signIn(h),me=await (await call(h,'/api/me',{headers:bearer(s)})).json();assert.equal(me.user.display_name,'Player One');assert.equal(me.csrf,s.csrf);
    const created=await call(h,'/api/matches',{method:'POST',origin:ACTIVITY,body:createBody(),headers:{...bearer(s),'X-CSRF-Token':s.csrf}});assert.equal(created.status,201);
    const out=await call(h,'/api/logout',{method:'POST',origin:ACTIVITY,body:{},headers:{...bearer(s),'X-CSRF-Token':s.csrf}});assert.equal(out.status,200);
    assert.equal((await call(h,'/api/analytics/me',{headers:bearer(s)})).status,401,'logout revoked the bearer session');
  }finally{h.close();}
});
test('the activity origin is accepted only together with a bearer session',async()=>{
  const h=await harness({production:true});
  try{
    const {s}=await signIn(h),cookieHeaders={Cookie:h.getCookie(),'X-CSRF-Token':h.getCsrf()};
    assert.equal((await call(h,'/api/logout',{method:'POST',origin:ACTIVITY,body:{},headers:cookieHeaders})).status,403,'a cookie session must not be usable from the discordsays origin');
    const withBearer={...bearer(s),'X-CSRF-Token':s.csrf};
    assert.equal((await call(h,'/api/logout',{method:'POST',origin:'https://evil.example',body:{},headers:withBearer})).status,403);
    assert.equal((await call(h,'/api/logout',{method:'POST',origin:'https://999999999999999999.discordsays.com',body:{},headers:withBearer})).status,403,'another application discordsays origin is not ours');
    assert.equal((await call(h,'/api/logout',{method:'POST',origin:ACTIVITY,body:{},headers:bearer(s)})).status,403,'CSRF is still required');
    assert.equal((await call(h,'/api/logout',{method:'POST',origin:ACTIVITY,body:{},headers:{...bearer(s),'X-CSRF-Token':'0'.repeat(64)}})).status,403);
    const bare=await harness();try{assert.equal((await call(bare,'/api/logout',{method:'POST',origin:ACTIVITY,body:{}})).status,401,'no bearer session, so nothing to accept');}finally{bare.close();}
  }finally{h.close();}
});
test('session creation rejects foreign origins, bad codes, unknown fields and Discord failures',async()=>{
  const h=await harness({production:true}),post=(origin,body,fetchImpl=discordFetch())=>handle(new Request(h.env.APP_ORIGIN+'/api/activity/session',{method:'POST',headers:{...IP,...(origin?{Origin:origin}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)}),h.env,{},fetchImpl);
  try{
    assert.equal((await post('https://evil.example',{code:'c'})).status,403);
    assert.equal((await post(null,{code:'c'})).status,403);
    assert.equal((await post(ACTIVITY,{})).status,400);
    assert.equal((await post(ACTIVITY,{code:'x'.repeat(3000)})).status,400);
    assert.equal((await post(ACTIVITY,{code:'c',extra:1})).status,422);
    assert.equal((await post(ACTIVITY,{code:'c'},async()=>new Response('no',{status:400}))).status,502);
    assert.equal((await call(h,'/api/me',{headers:{Authorization:'Bearer nothex'}})).status,200,'a malformed bearer is ignored and a fresh anonymous session is created');
  }finally{h.close();}
});
test('only a page loaded with frame_id may be framed, and only by Discord',async()=>{
  const h=await harness({production:true});
  try{
    const plain=await call(h,'/'),framed=await call(h,'/?frame_id=1&instance_id=2&platform=desktop');
    assert.equal(plain.headers.get('x-frame-options'),'DENY');assert.match(plain.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.equal(framed.headers.get('x-frame-options'),null);const csp=framed.headers.get('content-security-policy');assert.ok(csp.includes(ACTIVITY_FRAME_ANCESTORS));assert.ok(!csp.includes("frame-ancestors 'none'"));
    assert.match(csp,/script-src 'self'/);assert.match(csp,/connect-src 'self'/);assert.match(csp,/form-action 'self'/);
    const api=await call(h,'/api/me?frame_id=1');assert.equal(api.headers.get('x-frame-options'),'DENY','API responses are never frameable');assert.match(api.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    const health=await call(h,'/api/health?frame_id=1');assert.equal(health.headers.get('x-frame-options'),'DENY');
  }finally{h.close();}
});
