import { openDatabase } from '../server/node-db.mjs';
import { handle } from '../server/worker.js';
import { randomToken,sha256 } from '../public/mastermind/verify.js';
import { run } from '../server/db.js';
export function fakeJev({failure=null,select=null}={}) {
  return async(_url,options)=>{
    if(failure)return new Response('{}',{status:failure,headers:{'Retry-After':'60'}});
    const input=JSON.parse(options.body),ids=Object.keys(input.questions.choose_guess.criteria),id=select?select(input):ids[0];
    return Response.json({model:input.model,answers:{choose_guess:{type:'choice',choice:id,confidence:1,probabilities:Object.fromEntries(ids.map(k=>[k,Number(k===id)]))}},usage:{input_tokens:100,output_tokens:10}});
  };
}
/** A realistically rounded distribution: the provider reports on a 0.01 grain, never one-hot. */
export function roundedDistribution(ids,chosenIndex=0) {
  // Decaying raw weights, normalized exactly, then rounded to the 0.01 grain the provider uses.
  // The rounding is what makes the reported sum drift away from 1.
  const raw=ids.map((_,i)=>1/(i+1)),total=raw.reduce((a,b)=>a+b,0);
  const order=[chosenIndex,...ids.map((_,i)=>i).filter(i=>i!==chosenIndex)];
  const p={};order.forEach((index,rank)=>{p[ids[index]]=Math.round(raw[rank]/total*100)/100;});
  return p;
}
export function roundedJev({select=null}={}) {
  return async(_url,options)=>{
    const input=JSON.parse(options.body),ids=Object.keys(input.questions.choose_guess.criteria);
    const id=select?select(input):ids[0],probabilities=roundedDistribution(ids,ids.indexOf(id));
    return Response.json({model:input.model,answers:{choose_guess:{type:'choice',choice:id,confidence:0.41,probabilities}},usage:{input_tokens:26510,output_tokens:2206}});
  };
}
export async function harness({production=false,provider=null}={}) {
  const db=openDatabase(),env={DB:db,APP_ORIGIN:production?'https://game.test':'http://127.0.0.1:8787',LOCAL_DEV:production?'false':'true',QUOTA_SALT:'test-only-salt',JEV_MODEL:'jev-1.13.0',
    RANKED_ENABLED:production?'true':'false',TYPESAFE_API_KEY:provider?'fake-test-only-key':'',DISCORD_CLIENT_ID:production?'123456789012345678':'',DISCORD_CLIENT_SECRET:production?'fake-test-secret':'',
    ASSETS:{fetch:async()=>new Response('asset')}};
  let cookie='',csrf='',fetchImpl=provider||fakeJev();
  const request=async(path,{method='GET',body,headers={},raw=false}={})=>{
    const req=new Request(env.APP_ORIGIN+path,{method,headers:{'CF-Connecting-IP':'203.0.113.8',...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:env.APP_ORIGIN,'Content-Type':'application/json','X-CSRF-Token':csrf}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
    const response=await handle(req,env,{},fetchImpl);const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
    const data=raw?await response.text():response.headers.get('content-type')?.includes('json')?await response.json():null;
    if(data?.csrf)csrf=data.csrf;
    return {status:response.status,data,response};
  };
  await request('/api/me');
  return {db,env,request,close:()=>db.close(),getCookie:()=>cookie,getCsrf:()=>csrf,setFetch(fn){fetchImpl=fn;},
    async signIn(id='111111111111111111',name='Test Player'){
      const token=randomToken(),hash=await sha256(token);csrf=randomToken();cookie=(production?'__Host-jev':'jev_local')+'='+token;
      await run(db,'INSERT OR IGNORE INTO users(discord_user_id,display_name,created_at,last_seen_at) VALUES(?,?,?,?)',id,name,Date.now(),Date.now());
      await run(db,'INSERT INTO web_sessions(token_hash,owner_key,discord_user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?,?)',hash,randomToken(),id,csrf,Date.now(),Date.now()+86400000);
      return {hash,id};
    }};
}
export const createBody=(overrides={})=>({game:'mastermind',difficulty:'normal',humanCode:[0,0,2,5],ranked:false,requestId:crypto.randomUUID(),...overrides});
export const actionBody=(revision,action)=>({requestId:crypto.randomUUID(),expectedRevision:revision,action});
