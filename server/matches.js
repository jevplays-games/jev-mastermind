import { createInitialState,applyAction,getPublicView,isTerminal,makeReplay,assertCode,DIFFICULTIES,RULES_VERSION,decodeGuess } from '../public/mastermind/rules.js';
import { createCommitments,randomCode,randomToken,sha256,verifyReplay,canonical } from '../public/mastermind/verify.js';
import { analyzeMatch } from '../public/mastermind/analytics.js';
import { check,HttpError,validRequestId,onlyKeys } from './security.js';
import { one,all,run,changed,getMatch,quota,event } from './db.js';
import { chooseJevAction } from './jev.js';
import { sessionContext } from './auth.js';
export async function opponentConfig(cfg) {
  const value={rulesVersion:RULES_VERSION,model:cfg.jevReady?cfg.model:'local-deterministic-v1',policyVersion:cfg.policyVersion,
    promptVersion:cfg.promptVersion,timeoutMs:cfg.timeoutMs,selector:cfg.jevReady?'typesafe-choice-v1':'local-selector-v1'};
  return {...value,configId:'mm-'+(await sha256(value)).slice(0,24)};
}
export function assertOwner(match,session) {
  check(match,404,'Match not found.');
  check(session&&(match.owner_key===session.owner_key || session.discord_user_id&&match.discord_user_id===session.discord_user_id),404,'Match not found.');
}
export function publicMatch(match) {
  const view=getPublicView(match.state,match.secrets);
  return { ...view,ranked:Boolean(match.started_ranked),eligible:Boolean(match.eligible),verified:Boolean(match.verified_at),
    opponent:match.config.selector==='local-selector-v1'?'Local deterministic opponent — not JEV':match.fallback_count?'JEV with fallback — unranked':'JEV + deterministic analysis',
    pending:Boolean(match.pending),createdAt:match.created_at,expiresAt:match.expires_at,finishedAt:match.finished_at,
    context:match.guild_id?{guildId:match.guild_id,channelId:match.channel_id}:null,
    evidence:match.audit.at(-1)??null,
    ...(isTerminal(match.state)?{decisions:match.audit,timings:match.timings,summary:match.summary}:{}) };
}
function safeEvent(db,...args) {return event(db,...args).catch(()=>{});}
export async function createMatch(body,session,db,cfg,env) {
  onlyKeys(body,['game','difficulty','humanCode','ranked','requestId']);
  check(body.game==='mastermind'&&DIFFICULTIES.includes(body.difficulty),422,'Invalid game or difficulty.');
  try{assertCode(body.humanCode);}catch(e){throw new HttpError(422,e.message);}
  check(typeof body.ranked==='boolean'&&validRequestId(body.requestId),422,'A ranked flag and request ID are required.');
  const hash=await sha256(body),existing=await one(db,'SELECT id,create_request_hash FROM matches WHERE owner_key=? AND create_request_id=?',session.owner_key,body.requestId);
  if(existing){check(existing.create_request_hash===hash,409,'This request ID was already used for different content.');return getMatch(db,existing.id);}
  if(body.ranked)check(session.discord_user_id&&cfg.rankedEnabled&&cfg.jevReady&&cfg.discordReady,403,'Ranked play requires configured JEV, Discord sign-in, and production ranking enabled.');
  await quota(db,`start:${session.discord_user_id||session.owner_key}`,session.discord_user_id?20:10,3600000);
  await quota(db,'start:global',Number(env.MAX_STARTS_PER_HOUR)||2000,3600000);
  const active=await one(db,`SELECT count(*) AS n FROM matches WHERE (owner_key=? OR discord_user_id=?) AND phase IN ('human_break','jev_break')`,session.owner_key,session.discord_user_id);
  check(active.n<3,409,'Finish or resign an active match before starting another.');
  const id=crypto.randomUUID(),secrets={targetForHuman:randomCode(),targetForJev:[...body.humanCode],humanTargetSalt:randomToken(),jevTargetSalt:randomToken()};
  const chosen=await opponentConfig(cfg),commitments=await createCommitments(id,secrets),state=createInitialState({matchId:id,difficulty:body.difficulty,configId:chosen.configId,commitments});
  const context=sessionContext(session),now=Date.now();
  try {
    await run(db,`INSERT INTO matches(id,owner_key,discord_user_id,create_request_id,create_request_hash,config_id,difficulty,phase,revision,started_ranked,eligible,
      guild_id,channel_id,state_json,secrets_json,config_json,created_at,last_action_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,session.owner_key,session.discord_user_id,body.requestId,hash,chosen.configId,body.difficulty,state.phase,0,Number(body.ranked),Number(body.ranked),
      context?.guildId??null,context?.channelId??null,JSON.stringify(state),JSON.stringify(secrets),JSON.stringify(chosen),now,now,now+86400000);
  }catch(error){
    const retry=await one(db,'SELECT id,create_request_hash FROM matches WHERE owner_key=? AND create_request_id=?',session.owner_key,body.requestId);
    if(retry){check(retry.create_request_hash===hash,409,'Request ID conflict.');return getMatch(db,retry.id);}
    if(String(error).includes('UNIQUE'))throw new HttpError(409,'Only one active ranked match is allowed.');throw error;
  }
  await safeEvent(db,'game_started',id,{difficulty:body.difficulty,configId:chosen.configId,ranked:body.ranked});return getMatch(db,id);
}
async function terminalFields(state,match,audit,timings) {
  if(!isTerminal(state))return {outcome:null,finishReason:null,humanCost:null,jevCost:null,summary:null,verifiedAt:null,finishedAt:null};
  const replay=makeReplay(state,match.secrets),verified=await verifyReplay(replay);
  check(canonical(verified.state)===canonical(state),500,'Authoritative replay verification failed.');
  check(state.configId===match.config.configId&&state.difficulty===match.difficulty,500,'Configuration verification failed.');
  const aiActions=state.actions.filter(a=>a.actor==='jev');
  check(aiActions.length===audit.length,500,'Decision audit is incomplete.');
  aiActions.forEach((a,i)=>check(a.guessId===audit[i].guessId&&a.source===audit[i].source&&a.decisionRef===audit[i].decisionRef,500,'Decision audit mismatch.'));
  const report=analyzeMatch(state,match.secrets,{decisions:audit,timings,exhaustive:false});
  const summary={human:report.human.summary,jev:report.jev.summary,timing:report.timing,provider:report.provider,codePatterns:report.codePatterns};
  return {outcome:state.outcome,finishReason:state.finishReason,...report.score,summary,verifiedAt:Date.now(),finishedAt:Date.now()};
}
async function persist(db,match,state,{audit=match.audit,timings=match.timings,receipt=null,leaseId=null}={}) {
  const fields=await terminalFields(state,match,audit,timings),receipts=[...match.receipts];
  if(receipt)receipts.push({...receipt,acceptedRevision:state.revision});
  check(receipts.length<=32,500,'Receipt bound exceeded.');
  const fallbackCount=audit.filter(d=>d.source==='fallback').length;
  const eligible=match.eligible&&!audit.some(d=>d.source==='fallback'||d.source==='local');
  const sql=`UPDATE matches SET state_json=?,phase=?,revision=?,audit_json=?,timings_json=?,receipts_json=?,pending_json=NULL,
      outcome=?,finish_reason=?,human_cost=?,jev_cost=?,fallback_count=?,eligible=?,summary_json=?,verified_at=?,finished_at=?,last_action_at=?
      WHERE id=? AND revision=?${leaseId?" AND json_extract(pending_json,'$.leaseId')=?":''}`;
  const params=[JSON.stringify(state),state.phase,state.revision,JSON.stringify(audit),JSON.stringify(timings),JSON.stringify(receipts),fields.outcome,fields.finishReason,
    fields.humanCost,fields.jevCost,fallbackCount,Number(eligible),fields.summary?JSON.stringify(fields.summary):null,fields.verifiedAt,fields.finishedAt,Date.now(),match.id,match.revision];
  if(leaseId)params.push(leaseId);
  check(changed(await run(db,sql,...params)),409,'Match changed while the action was being processed.','stale_revision');
  if(isTerminal(state)) {
    await safeEvent(db,state.phase==='forfeit'?'game_forfeited':'game_completed',match.id,{outcome:state.outcome,finishReason:state.finishReason,eligible:Boolean(eligible),fallbackCount});
    await safeEvent(db,'score_verified',match.id,{verification:true,eligible:Boolean(eligible)});
  }
  return getMatch(db,match.id);
}
export async function expireMatch(match,db) {
  if(match.state.phase!=='human_break'||match.expires_at>Date.now())return match;
  const state=applyAction(match.state,{type:'EXPIRE',actor:'human'},match.secrets);
  return persist(db,match,state);
}
export async function performAction(id,body,session,db,cfg,env,{fetchImpl=fetch,trusted=false}={}) {
  onlyKeys(body,['requestId','expectedRevision','action']);
  check(validRequestId(body.requestId)&&Number.isInteger(body.expectedRevision)&&body.expectedRevision>=0,422,'Invalid action metadata.');
  check(body.action&&typeof body.action==='object'&&!Array.isArray(body.action),422,'An action is required.');
  onlyKeys(body.action,body.action.type==='GUESS'?['type','guess']:['type']);
  check(['GUESS','STEP_JEV','RESIGN'].includes(body.action.type),422,'Unsupported action.');
  let match=await getMatch(db,id);if(!trusted)assertOwner(match,session);else check(match,404,'Match not found.');
  const hash=await sha256(body),prior=match.receipts.find(r=>r.id===body.requestId);
  if(prior){check(prior.hash===hash,409,'Request ID reused with different content.');return {match,duplicate:true};}
  match=await expireMatch(match,db);
  check(match.revision===body.expectedRevision&&!isTerminal(match.state),409,'Match revision changed or match is complete.','stale_revision');
  const receipt={id:body.requestId,hash};
  if(body.action.type!=='STEP_JEV') {
    check(!match.pending||body.action.type==='RESIGN',409,'An opponent decision is in progress.');
    let state;
    try{state=applyAction(match.state,{...body.action,actor:'human'},match.secrets);}catch(e){throw new HttpError(422,e.message);}
    const timings=[...match.timings,{actor:'human',turn:match.state.legs.human.history.length+1,elapsedMs:Math.max(0,Date.now()-match.last_action_at),action:body.action.type}];
    const updated=await persist(db,match,state,{receipt,timings});
    await safeEvent(db,'human_action',id,{turn:state.legs.human.history.length});return {match:updated};
  }
  check(match.phase==='jev_break',422,'It is not JEV’s turn.');
  if(match.pending&&match.pending.expiresAt>Date.now()) {
    check(match.pending.requestId!==body.requestId||match.pending.requestHash===hash,409,'Request ID reused with different content.');
    return {match,pending:true};
  }
  if(match.pending?.requestId===body.requestId)check(match.pending.requestHash===hash,409,'Request ID reused with different content.');
  const expiredLease=Boolean(match.pending),leaseId=randomToken(16);
  const pending={leaseId,requestId:body.requestId,requestHash:hash,revision:match.revision,expiresAt:Date.now()+15000,reservedAttempts:expiredLease?0:2};
  const claimed=await run(db,`UPDATE matches SET pending_json=? WHERE id=? AND revision=? AND phase='jev_break'
    AND (pending_json IS NULL OR json_extract(pending_json,'$.expiresAt')<=?)`,JSON.stringify(pending),id,match.revision,Date.now());
  if(!changed(claimed))return {match:await getMatch(db,id),pending:true};
  let reason=expiredLease?'expired_decision_lease':null;
  if(!reason&&match.config.selector!=='local-selector-v1') {
    if(!env.TYPESAFE_API_KEY)reason='provider_configuration_removed';
    else try{await quota(db,'provider:global',Number(env.MAX_PROVIDER_ATTEMPTS_PER_DAY)||10000,86400000,Date.now(),2);}catch{reason='provider_quota_exhausted';}
  }
  await safeEvent(db,'jev_requested',id,{difficulty:match.difficulty,configId:match.config_id});
  let decision;
  try {
    decision=await chooseJevAction({state:match.state,config:match.config,
      apiKey:match.config.selector==='local-selector-v1'?null:env.TYPESAFE_API_KEY,fetchImpl,forceFallbackReason:reason});
  } catch(error) {
    // Do not guess if a rules/feature invariant failed. Preserve the lease for safe recovery.
    throw new HttpError(503,'Opponent analysis failed; reload to resume safely.','analysis_failure');
  }
  decision.decisionRef=randomToken(12);
  if(expiredLease){decision.unobservedReservedAttempts=match.pending.reservedAttempts??2;decision.usageComplete=false;}
  const current=await getMatch(db,id);
  check(current.revision===match.revision&&current.pending?.leaseId===leaseId&&current.phase==='jev_break',409,'Opponent response is stale.','stale_revision');
  const state=applyAction(match.state,{type:'GUESS',actor:'jev',guess:decodeGuess(decision.guessId),source:decision.source,decisionRef:decision.decisionRef},match.secrets);
  const updated=await persist(db,match,state,{receipt,leaseId,audit:[...match.audit,decision]});
  await safeEvent(db,'jev_decision',id,{source:decision.source,turn:state.legs.jev.history.length,candidateCount:decision.candidateCount,evaluatedCount:decision.evaluatedCount,
    latencyMs:decision.latencyMs,attempts:decision.attempts,invalidResponses:decision.invalidResponses,inputTokens:decision.usage?.input_tokens??null,outputTokens:decision.usage?.output_tokens??null});
  return {match:updated};
}
export async function maintenance(db,cfg,env,fetchImpl=fetch) {
  const expiring=await all(db,"SELECT id FROM matches WHERE phase='human_break' AND expires_at<=? LIMIT 50",Date.now());
  for(const row of expiring)try{await expireMatch(await getMatch(db,row.id),db);}catch{}
  // One action per match per sweep. Browser actions continue immediately; durable leases arbitrate races.
  const pending=await all(db,"SELECT id FROM matches WHERE phase='jev_break' AND last_action_at<? ORDER BY last_action_at LIMIT 10",Date.now()-60000);
  for(const row of pending)try{
    const match=await getMatch(db,row.id);
    await performAction(row.id,{requestId:'recovery-'+randomToken(12),expectedRevision:match.revision,action:{type:'STEP_JEV'}},null,db,cfg,env,{fetchImpl,trusted:true});
  }catch{}
  await run(db,'DELETE FROM web_sessions WHERE expires_at<?',Date.now());
  await run(db,'DELETE FROM launch_tickets WHERE expires_at<?',Date.now()-86400000);
  await run(db,'DELETE FROM usage_buckets WHERE expires_at<?',Date.now());
  await run(db,'DELETE FROM analytics_events WHERE created_at<?',Date.now()-30*86400000);
  // Guest transcripts retain their secrets only for 30 days. Signed-in match retention is operator policy.
  await run(db,"DELETE FROM matches WHERE discord_user_id IS NULL AND phase IN ('complete','forfeit','void') AND finished_at<?",Date.now()-30*86400000);
}
