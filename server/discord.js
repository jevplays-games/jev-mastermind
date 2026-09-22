import { check,boundedText,randomToken,sha256,validSnowflake,json } from './security.js';
import { one,run,event } from './db.js';
function hexBytes(text){return new Uint8Array(text.match(/.{2}/g).map(x=>parseInt(x,16)));}
export async function verifyInteraction(request,publicKey,now=Date.now()) {
  const signature=request.headers.get('X-Signature-Ed25519'),timestamp=request.headers.get('X-Signature-Timestamp');
  check(/^[a-fA-F0-9]{64}$/.test(publicKey??'')&&/^[a-fA-F0-9]{128}$/.test(signature??'')&&/^\d{10}$/.test(timestamp??''),401,'Invalid interaction signature.');
  check(Math.abs(now-Number(timestamp)*1000)<=300000,401,'Interaction timestamp is stale.');
  const raw=await boundedText(request,65536);
  const key=await crypto.subtle.importKey('raw',hexBytes(publicKey),{name:'Ed25519'},false,['verify']);
  const valid=await crypto.subtle.verify('Ed25519',key,hexBytes(signature),new TextEncoder().encode(timestamp+raw));
  check(valid,401,'Invalid interaction signature.');
  try{return JSON.parse(raw);}catch{throw new Error('Invalid signed JSON.');}
}
export async function handleInteraction(request,db,cfg,env) {
  const payload=await verifyInteraction(request,env.DISCORD_PUBLIC_KEY);
  check(payload.application_id===env.DISCORD_CLIENT_ID,401,'Wrong Discord application.');
  if(payload.type===1)return json({type:1});
  check(payload.type===2&&payload.data?.name==='play',400,'Unsupported command.');
  check(payload.context===0&&validSnowflake(payload.guild_id)&&validSnowflake(payload.channel_id)&&validSnowflake(payload.member?.user?.id)&&validSnowflake(payload.id),400,'Launch must originate in a guild channel.');
  check(payload.authorizing_integration_owners?.['0']===payload.guild_id,403,'Guild installation could not be verified.');
  const option=payload.data.options?.find(x=>x.name==='game');
  check(!option||option.value==='mastermind',400,'Unsupported game.');
  const raw=randomToken(),hash=await sha256(raw),now=Date.now();
  const created=await one(db,`INSERT INTO launch_tickets(token_hash,interaction_id,expected_user_id,guild_id,channel_id,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(interaction_id) DO NOTHING RETURNING token_hash`,hash,payload.id,payload.member.user.id,payload.guild_id,payload.channel_id,now,now+300000);
  if(!created)return json({type:4,data:{content:'This launch was already handled. Run /play again for a fresh link.',flags:64}});
  await event(db,'launch_created');
  return json({type:4,data:{content:'Open your personal Mastermind match. Sign in with the same Discord account. This link expires in five minutes.',flags:64,
    components:[{type:1,components:[{type:2,style:5,label:'Play Mastermind vs JEV',url:cfg.origin+'/play/mastermind?launch='+raw}]}]}});
}
export async function redeemContext(ticket,session,db) {
  check(session.discord_user_id,401,'Sign in with Discord before redeeming this launch.');
  check(typeof ticket==='string'&&/^[a-f0-9]{64}$/.test(ticket),422,'Invalid launch ticket.');
  const now=Date.now(),hash=await sha256(ticket);
  const row=await one(db,`UPDATE launch_tickets SET consumed_at=? WHERE token_hash=? AND expected_user_id=? AND consumed_at IS NULL AND expires_at>? RETURNING guild_id,channel_id`,now,hash,session.discord_user_id,now);
  check(row,403,'This launch is expired, used, or belongs to a different Discord account.');
  const context={guildId:row.guild_id,channelId:row.channel_id,verifiedAt:now,expiresAt:now+900000};
  await run(db,'UPDATE web_sessions SET context_json=?,context_expires_at=? WHERE token_hash=?',JSON.stringify(context),context.expiresAt,session.token_hash);
  await event(db,'context_redeemed');return context;
}
