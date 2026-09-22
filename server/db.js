/** Small adapter over D1's prepared interface; the Node adapter implements the identical subset. */
import { HttpError, randomToken } from './security.js';
export const one=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
export const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
export const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
export const changed=result=>Number(result?.meta?.changes??0)>0;
export async function quota(db,key,limit,windowMs,now=Date.now(),cost=1) {
  if(!Number.isInteger(limit)||!Number.isInteger(cost)||cost<1||limit<cost)throw new HttpError(429,'Request budget exhausted.','rate_limit');
  const slot=Math.floor(now/windowMs),bucket=`${key}:${slot}`;
  const row=await one(db,`INSERT INTO usage_buckets(bucket,used,expires_at) VALUES(?,?,?)
    ON CONFLICT(bucket) DO UPDATE SET used=used+excluded.used WHERE used+excluded.used<=?
    RETURNING used`,bucket,cost,(slot+2)*windowMs,limit);
  if(!row)throw new HttpError(429,'Request budget exhausted. Try again later.','rate_limit');
}
const EVENT_NAMES=new Set(['game_started','human_action','jev_requested','jev_decision','game_completed','score_verified','game_forfeited','oauth_success','request_rejected','launch_created','context_redeemed','analytics_exported','replay_exported']);
const EVENT_KEYS=new Set(['difficulty','configId','ranked','source','turn','candidateCount','evaluatedCount','latencyMs','attempts','invalidResponses','fallbackCount','outcome','finishReason','eligible','status','code','scope','inputTokens','outputTokens','verification','reason']);
export async function event(db,name,matchId=null,data={}) {
  if(!EVENT_NAMES.has(name))throw new Error('Unregistered analytics event.');
  const safe=Object.fromEntries(Object.entries(data).filter(([k,v])=>EVENT_KEYS.has(k)&&(v===null||['string','number','boolean'].includes(typeof v))));
  await run(db,'INSERT INTO analytics_events(id,match_id,name,data_json,created_at) VALUES(?,?,?,?,?)',randomToken(16),matchId,name,JSON.stringify(safe),Date.now());
}
export function unpack(row) {
  if(!row)return null;
  return {...row,state:JSON.parse(row.state_json),secrets:JSON.parse(row.secrets_json),audit:JSON.parse(row.audit_json),
    timings:JSON.parse(row.timings_json),receipts:JSON.parse(row.receipts_json),pending:row.pending_json?JSON.parse(row.pending_json):null,
    config:JSON.parse(row.config_json),summary:row.summary_json?JSON.parse(row.summary_json):null};
}
export async function getMatch(db,id) {return unpack(await one(db,'SELECT * FROM matches WHERE id=?',id));}
