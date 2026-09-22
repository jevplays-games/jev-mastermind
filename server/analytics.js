import { all,one } from './db.js';
import { check } from './security.js';
import { sessionContext } from './auth.js';
import { opponentConfig } from './matches.js';
import { DIFFICULTIES } from '../public/mastermind/rules.js';
import { describe,wilson } from '../public/mastermind/analytics.js';
export async function analyticsFilter(url,session,cfg) {
  const scope=url.searchParams.get('scope')||'world',difficulty=url.searchParams.get('difficulty')||'normal';
  check(['world','server','channel'].includes(scope)&&DIFFICULTIES.includes(difficulty),422,'Invalid scope or difficulty.');
  const configId=url.searchParams.get('configId')||(await opponentConfig(cfg)).configId;
  check(/^mm-[a-f0-9]{24}$/.test(configId),422,'Invalid opponent configuration.');
  let clause='m.config_id=? AND m.difficulty=?',args=[configId,difficulty];
  if(scope!=='world') {
    const context=sessionContext(session);check(context&&session.discord_user_id,403,'Open a fresh /play link from Discord to view this community.');
    clause+=' AND m.guild_id=?';args.push(context.guildId);
    if(scope==='channel'){clause+=' AND m.channel_id=?';args.push(context.channelId);}
  }
  return {scope,difficulty,configId,clause,args};
}
export async function leaderboard(url,session,db,cfg) {
  const filter=await analyticsFilter(url,session,cfg);
  const rows=await all(db,`WITH stats AS (
    SELECT m.discord_user_id,u.display_name,COUNT(*) AS games,
      SUM(m.outcome='win') AS wins,SUM(m.outcome='loss') AS losses,SUM(m.outcome='draw') AS draws,
      SUM(m.phase='forfeit') AS forfeits,AVG(m.human_cost) AS average_penalized_guesses,
      (SUM(m.outcome='win')+0.5*SUM(m.outcome='draw'))/COUNT(*) AS match_points_percentage
    FROM matches m JOIN users u ON u.discord_user_id=m.discord_user_id
    WHERE ${filter.clause} AND m.eligible=1 AND m.verified_at IS NOT NULL AND m.finished_at IS NOT NULL
    GROUP BY m.discord_user_id,u.display_name
  ), established AS (
    SELECT *,DENSE_RANK() OVER(ORDER BY match_points_percentage DESC,average_penalized_guesses ASC,games DESC) AS rank
    FROM stats WHERE games>=10
  ) SELECT *,1 AS established FROM established
    UNION ALL SELECT *,NULL AS rank,0 AS established FROM stats WHERE games<10
    ORDER BY established DESC,match_points_percentage DESC,average_penalized_guesses ASC,games DESC,discord_user_id ASC LIMIT 50`,...filter.args);
  return {scope:filter.scope,difficulty:filter.difficulty,configId:filter.configId,minimumEstablishedGames:10,limit:50,rows};
}
export async function profileAnalytics(url,session,db) {
  const own='(owner_key=? OR discord_user_id=?)',args=[session.owner_key,session.discord_user_id];
  const totals=await one(db,`SELECT COUNT(*) AS started,SUM(phase IN ('human_break','jev_break')) AS active,
    SUM(phase='complete') AS completed,SUM(phase='forfeit') AS forfeits,SUM(phase='void') AS voided,
    SUM(finished_at IS NOT NULL AND verified_at IS NOT NULL) AS verified,
    SUM(finished_at IS NOT NULL AND eligible=1 AND verified_at IS NOT NULL) AS ranked_results
    FROM matches WHERE ${own}`,...args);
  const groups=await all(db,`SELECT config_id,difficulty,COUNT(*) AS games,
    SUM(outcome='win') AS wins,SUM(outcome='loss') AS losses,SUM(outcome='draw') AS draws,
    SUM(phase='forfeit') AS forfeits,SUM(phase='complete') AS normal_completions,
    SUM(phase='complete' AND json_extract(summary_json,'$.human.solved')=1) AS human_solves,
    AVG(human_cost) AS average_penalized_guesses,SUM(fallback_count) AS fallback_moves,
    SUM(eligible=1) AS ranked_results,AVG(json_extract(summary_json,'$.human.meanExpectedInformationBits')) AS average_expected_bits,
    SUM(COALESCE(json_extract(summary_json,'$.human.repeatedGuesses'),0)) AS repeated_guesses,
    SUM(COALESCE(json_extract(summary_json,'$.provider.inputTokensReported'),0)) AS input_tokens_reported,
    SUM(COALESCE(json_extract(summary_json,'$.provider.outputTokensReported'),0)) AS output_tokens_reported,
    SUM(COALESCE(json_extract(summary_json,'$.provider.usageIncomplete'),0)) AS incomplete_usage_matches,
    SUM(COALESCE(json_extract(summary_json,'$.provider.jevCalls'),0)) AS provider_attempts
    FROM matches WHERE ${own} AND finished_at IS NOT NULL GROUP BY config_id,difficulty ORDER BY config_id,difficulty`,...args);
  for(const g of groups){g.winRate=g.wins/g.games;g.matchPointsPercentage=(g.wins+.5*g.draws)/g.games;g.humanSolveRate=g.normal_completions?g.human_solves/g.normal_completions:null;
    g.descriptiveWinRateWilson95=wilson(g.wins,g.games);}
  const cursor=url.searchParams.get('before');
  let beforeTime=Number.MAX_SAFE_INTEGER,beforeId='zzzz';
  if(cursor){const parts=cursor.split(':');check(parts.length===2&&/^\d{1,16}$/.test(parts[0])&&/^[a-f0-9-]{36}$/.test(parts[1]),422,'Invalid history cursor.');beforeTime=Number(parts[0]);beforeId=parts[1];}
  const recent=await all(db,`SELECT id,config_id,difficulty,phase,outcome,finish_reason,human_cost,jev_cost,fallback_count,eligible,verified_at,created_at,finished_at,
      json_extract(summary_json,'$.human.solved') AS human_solved,
      json_extract(summary_json,'$.jev.solved') AS jev_solved
    FROM matches WHERE ${own} AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 101`,...args,beforeTime,beforeTime,beforeId);
  const hasMore=recent.length>100;if(hasMore)recent.pop();const last=recent.at(-1);
  const daily=await all(db,`SELECT strftime('%Y-%m-%d',finished_at/1000,'unixepoch') AS day,config_id,difficulty,
    COUNT(*) AS games,SUM(outcome='win') AS wins,SUM(outcome='loss') AS losses,SUM(outcome='draw') AS draws,AVG(human_cost) AS average_penalized_guesses
    FROM matches WHERE ${own} AND finished_at>=? GROUP BY day,config_id,difficulty ORDER BY day`,...args,Date.now()-90*86400000);
  const streakRows=await all(db,`SELECT config_id,difficulty,outcome FROM matches WHERE ${own} AND eligible=1 AND verified_at IS NOT NULL AND finished_at IS NOT NULL
    ORDER BY finished_at,id`,...args);
  const streaks={};for(const r of streakRows){const key=r.config_id+':'+r.difficulty;const s=streaks[key]??={configId:r.config_id,difficulty:r.difficulty,currentWinStreak:0,bestWinStreak:0};
    s.currentWinStreak=r.outcome==='win'?s.currentWinStreak+1:0;s.bestWinStreak=Math.max(s.bestWinStreak,s.currentWinStreak);}
  return {coverage:'Totals and groups include all retained matches owned by this account/session. History is paginated; daily series covers the last 90 days (UTC).',
    totals:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,v??0])),groups,daily,streaks:Object.values(streaks),recent,
    nextCursor:hasMore?`${last.created_at}:${last.id}`:null,
    interpretation:'Groups never pool difficulty or opponent configurations. Wilson intervals are descriptive win-rate intervals; repeated games need not be independent.'};
}
export async function communityAnalytics(url,session,db,cfg) {
  const f=await analyticsFilter(url,session,cfg);
  const rows=await all(db,`SELECT m.human_cost,m.jev_cost,m.outcome,m.phase,m.summary_json FROM matches m
    WHERE ${f.clause} AND m.eligible=1 AND m.verified_at IS NOT NULL AND m.finished_at IS NOT NULL ORDER BY m.finished_at DESC LIMIT 5001`,...f.args);
  const partial=rows.length>5000;if(partial)rows.pop();
  const totals=await one(db,`SELECT COUNT(*) AS games,COUNT(DISTINCT discord_user_id) AS players,SUM(outcome='win') AS wins,
    SUM(outcome='loss') AS losses,SUM(outcome='draw') AS draws,SUM(phase='forfeit') AS forfeits
    FROM matches m WHERE ${f.clause} AND m.eligible=1 AND m.verified_at IS NOT NULL AND m.finished_at IS NOT NULL`,...f.args);
  return {scope:f.scope,difficulty:f.difficulty,configId:f.configId,totals,
    distributionCoverage:{matches:rows.length,partial,definition:partial?'Most recent 5,000 retained eligible matches':'All retained eligible matches'},
    humanGuesses:describe(rows.map(r=>r.human_cost)),jevGuesses:describe(rows.map(r=>r.jev_cost)),
    histogram:Array.from({length:11},(_,i)=>({guesses:i+1,human:rows.filter(r=>r.human_cost===i+1).length,jev:rows.filter(r=>r.jev_cost===i+1).length})),
    notes:'Cost 11 means failure or human forfeit. JEV cost is null for forfeits, never fabricated.'};
}
export async function operationalAnalytics(db,days=7) {
  check(Number.isInteger(days)&&days>=1&&days<=30,422,'Days must be an integer from 1 to 30.');
  const since=Date.now()-days*86400000;
  const events=await all(db,`SELECT name,COUNT(*) AS count FROM analytics_events WHERE created_at>=? GROUP BY name ORDER BY name`,since);
  const decisions=await all(db,`SELECT json_extract(j.value,'$.latencyMs') AS latency_ms,json_extract(j.value,'$.source') AS source,
    json_extract(j.value,'$.attempts') AS attempts,json_extract(j.value,'$.invalidResponses') AS invalid_responses,
    json_extract(j.value,'$.usage.input_tokens') AS input_tokens,json_extract(j.value,'$.usage.output_tokens') AS output_tokens
    FROM matches m,json_each(m.audit_json) j WHERE m.created_at>=? ORDER BY m.created_at DESC LIMIT 20001`,since);
  const partial=decisions.length>20000;if(partial)decisions.pop();
  return {days,asOf:new Date().toISOString(),events,decisionCoverage:{count:decisions.length,partial},
    latencyMs:describe(decisions.map(d=>d.latency_ms)),sources:Object.fromEntries(['jev','forced','local','fallback'].map(s=>[s,decisions.filter(d=>d.source===s).length])),
    notes:'Event retention is 30 days. Event writes are best-effort observability; authoritative result counts come from matches. Decision samples are bounded.'};
}
