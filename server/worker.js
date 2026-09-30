import {config,json,secureHeaders,HttpError,check,readJson,requireCsrf,requireOrigin,clientBucket,constantTimeEqual,sessionCookie,onlyKeys} from './security.js';
import {loadSession,beginOAuth,oauthCallback,me} from './auth.js';
import {handleInteraction,redeemContext} from './discord.js';
import {activityConfig,createActivitySession} from './activity.js';
import {createMatch,performAction,publicMatch,assertOwner,expireMatch,maintenance} from './matches.js';
import {getMatch,run,quota,event} from './db.js';
import {leaderboard,profileAnalytics,communityAnalytics,operationalAnalytics} from './analytics.js';
import {makeReplay,isTerminal} from '../public/mastermind/rules.js';
import {analyzeMatch,csvText} from '../public/mastermind/analytics.js';
export async function handle(request,env,ctx={},fetchImpl=fetch) {
  let cfg;
  try {
    cfg=config(env);const url=new URL(request.url),path=url.pathname,db=env.DB;
    check(url.origin===cfg.origin,421,'Request origin does not match APP_ORIGIN.');
    if(!path.startsWith('/api/'))return secureHeaders(await env.ASSETS.fetch(request),{activityFrame:url.searchParams.has('frame_id')});
    if(path==='/api/health'&&request.method==='GET')return secureHeaders(json({ok:true,game:'mastermind',rulesVersion:'mm-4x6-10-v1'}));
    check(db,503,'Database is not configured.');
    if(path==='/api/discord/interactions'&&request.method==='POST')return secureHeaders(await handleInteraction(request,db,cfg,env));
    if(path==='/api/admin/analytics'&&request.method==='GET') {
      check(env.ANALYTICS_ADMIN_TOKEN&&constantTimeEqual(request.headers.get('authorization'),`Bearer ${env.ANALYTICS_ADMIN_TOKEN}`),403,'Administrator authorization is required.');
      return secureHeaders(json(await operationalAnalytics(db,Number(url.searchParams.get('days')||7))));
    }
    const bucket=await clientBucket(request,env,cfg);
    await quota(db,`api:${bucket}`,300,60000);
    if(path==='/api/activity/config'&&request.method==='GET')return secureHeaders(json(activityConfig(cfg,env)));
    if(path==='/api/activity/session'&&request.method==='POST')return secureHeaders(json(await createActivitySession(request,db,cfg,env,bucket,fetchImpl),201));
    const createSession=(path==='/api/me'||path==='/api/auth/discord')&&request.method==='GET';
    const session=await loadSession(request,db,cfg,{create:createSession,bucket});
    if(path==='/api/me'&&request.method==='GET')return secureHeaders(json(await me(session,db,cfg),200,session.setCookie?{'Set-Cookie':session.setCookie}:{}));
    if(path==='/api/auth/discord'&&request.method==='GET')return secureHeaders(await beginOAuth(session,db,cfg,env));
    if(path==='/api/auth/discord/callback'&&request.method==='GET')return secureHeaders(await oauthCallback(request,session,db,cfg,env,fetchImpl));
    if(path==='/api/leaderboards'&&request.method==='GET')return secureHeaders(json(await leaderboard(url,session,db,cfg)));
    if(path==='/api/analytics/overview'&&request.method==='GET')return secureHeaders(json(await communityAnalytics(url,session,db,cfg)));
    check(session,401,'Session is missing. Reload the game to establish a session.');
    if(request.method!=='GET')requireCsrf(request,session,cfg);
    if(path==='/api/logout'&&request.method==='POST') {
      await run(db,'DELETE FROM web_sessions WHERE token_hash=?',session.token_hash);
      return secureHeaders(json({ok:true},200,{'Set-Cookie':sessionCookie('',cfg,0)}));
    }
    if(path==='/api/context/redeem'&&request.method==='POST') {
      const body=await readJson(request);onlyKeys(body,['ticket']);return secureHeaders(json({context:await redeemContext(body.ticket,session,db)}));
    }
    if(path==='/api/analytics/me'&&request.method==='GET')return secureHeaders(json(await profileAnalytics(url,session,db)));
    if(path==='/api/matches'&&request.method==='POST')return secureHeaders(json(publicMatch(await createMatch(await readJson(request),session,db,cfg,env)),201));
    const route=path.match(/^\/api\/matches\/([a-f0-9-]{36})(?:\/(actions|replay|analytics))?$/);
    if(route){
      const [,id,operation]=route;
      if(operation==='actions'&&request.method==='POST') {
        const result=await performAction(id,await readJson(request),session,db,cfg,env,{fetchImpl});
        return secureHeaders(json({...publicMatch(result.match),duplicate:!!result.duplicate},result.pending?202:200));
      }
      if(request.method==='GET') {
        let match=await getMatch(db,id);assertOwner(match,session);match=await expireMatch(match,db);
        if(!operation)return secureHeaders(json(publicMatch(match)));
        check(isTerminal(match.state),409,'Replay and full analytics unlock when the match ends.');
        if(operation==='replay') {
          await event(db,'replay_exported',id).catch(()=>{});
          return secureHeaders(json(makeReplay(match.state,match.secrets)));
        }
        if(operation==='analytics') {
          await quota(db,`analysis:${session.owner_key}`,30,60000);
          const report=analyzeMatch(match.state,match.secrets,{decisions:match.audit,timings:match.timings,exhaustive:false});
          await event(db,'analytics_exported',id).catch(()=>{});
          if(url.searchParams.get('format')==='csv')return secureHeaders(new Response(csvText(['human','jev'].flatMap(actor=>report[actor].rows.map(row=>({actor,...row})))),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="mastermind-${id}-moves.csv"`,'Cache-Control':'no-store'}}));
          return secureHeaders(json(report));
        }
      }
    }
    throw new HttpError(404,'API endpoint not found.');
  } catch(error) {
    const status=error instanceof HttpError?error.status:500,code=error instanceof HttpError?error.code:'internal_error';
    if(env.DB)await event(env.DB,'request_rejected',null,{status,code}).catch(()=>{});
    if(status===500)console.error(JSON.stringify({event:'internal_error',type:error?.name||'Error'}));
    return secureHeaders(json({error:{code,message:status===500?'The server could not process this request.':error.message}},status));
  }
}
export default {fetch:handle,async scheduled(_controller,env,ctx){ctx.waitUntil(maintenance(env.DB,config(env),env));}};
