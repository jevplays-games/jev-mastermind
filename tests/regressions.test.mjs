import test from 'node:test';import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';import {resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {harness,createBody,actionBody,fakeJev} from './helpers.mjs';
import {one,run,getMatch,quota} from '../server/db.js';
import {analyzeMatch} from '../public/mastermind/analytics.js';
import {createInitialState,applyAction} from '../public/mastermind/rules.js';
import {randomToken,sha256} from '../public/mastermind/verify.js';
import {handle} from '../server/worker.js';
const root=resolve(import.meta.dirname,'..');
test('all shipped JavaScript parses, including browser-only controller',()=>{
  for(const dir of ['public','public/mastermind','server','scripts','bench'])for(const file of readdirSync(resolve(root,dir))){if(!/\.(mjs|js)$/.test(file))continue;const p=spawnSync(process.execPath,['--check',resolve(root,dir,file)],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);}
});
test('unobserved reserved inference attempts keep usage incomplete',()=>{
  const state=applyAction(createInitialState({matchId:'test'}),{type:'RESIGN',actor:'human'},{targetForHuman:[0,0,0,0],targetForJev:[1,1,1,1]});
  const report=analyzeMatch(state,{targetForHuman:[0,0,0,0],targetForJev:[1,1,1,1]},{exhaustive:false,decisions:[{source:'fallback',attempts:0,unobservedReservedAttempts:2,usageComplete:false}]});
  assert.equal(report.provider.usageIncomplete,true);assert.equal(report.provider.jevCalls,0);
});
test('a quota reservation cannot exceed the limit on its first insertion',async()=>{const h=await harness();try{await assert.rejects(quota(h.db,'too-large',1,60000,Date.now(),2));}finally{h.close();}});
test('late JEV response cannot change a resigned match',async()=>{
  let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const h=await harness({production:true,provider:async(...args)=>{entered();await gate;return fakeJev()(...args);}});
  try{await h.signIn();let m=(await h.request('/api/matches',{method:'POST',body:createBody({ranked:true})})).data;
    m=(await h.request('/api/matches/'+m.matchId+'/actions',{method:'POST',body:actionBody(m.revision,{type:'GUESS',guess:(await getMatch(h.db,m.matchId)).secrets.targetForHuman})})).data;
    const pending=h.request('/api/matches/'+m.matchId+'/actions',{method:'POST',body:actionBody(m.revision,{type:'STEP_JEV'})});await started;
    const resign=await h.request('/api/matches/'+m.matchId+'/actions',{method:'POST',body:actionBody(m.revision,{type:'RESIGN'})});assert.equal(resign.status,200);release();
    assert.equal((await pending).status,409);const latest=await getMatch(h.db,m.matchId);assert.equal(latest.phase,'forfeit');assert.equal(latest.state.legs.jev.history.length,0);
  }finally{release();h.close();}
});
test('leaderboards preserve shared ranks and isolate community, difficulty, and configuration',async()=>{
  const h=await harness({production:true,provider:fakeJev()});
  try{const user=await h.signIn();let m=(await h.request('/api/matches',{method:'POST',body:createBody({ranked:true})})).data;
    m=(await h.request('/api/matches/'+m.matchId+'/actions',{method:'POST',body:actionBody(m.revision,{type:'RESIGN'})})).data;
    const raw=await one(h.db,'SELECT * FROM matches WHERE id=?',m.matchId);await run(h.db,'DELETE FROM matches');
    const guild='222222222222222222',channel='333333333333333333',bob='444444444444444444',other='555555555555555555';
    for(const id of [bob,other])await run(h.db,'INSERT INTO users(discord_user_id,display_name,created_at,last_seen_at) VALUES(?,?,?,?)',id,id,Date.now(),Date.now());
    // Synthetic read-model fixtures. Integrity of real finalization is tested in api.test.mjs.
    for(const [id,g,c]of [[user.id,guild,channel],[bob,guild,channel],[other,'666666666666666666','777777777777777777']])for(let i=0;i<10;i++){
      const row={...raw,id:crypto.randomUUID(),create_request_id:crypto.randomUUID(),owner_key:randomToken(),discord_user_id:id,guild_id:g,channel_id:c,phase:'complete',outcome:i<8?'win':'loss',human_cost:4,jev_cost:5,eligible:1};
      const keys=Object.keys(row);await run(h.db,`INSERT INTO matches(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(k=>row[k]));
    }
    let world=(await h.request('/api/leaderboards')).data;assert.equal(world.rows.length,3);assert.ok(world.rows.every(r=>r.rank===1&&r.established===1&&r.games===10));
    const context={guildId:guild,channelId:channel,expiresAt:Date.now()+60000};await run(h.db,'UPDATE web_sessions SET context_json=?,context_expires_at=? WHERE token_hash=?',JSON.stringify(context),context.expiresAt,user.hash);
    assert.equal((await h.request('/api/leaderboards?scope=server')).data.rows.length,2);
    assert.equal((await h.request('/api/leaderboards?scope=channel')).data.rows.length,2);
    assert.equal((await h.request('/api/leaderboards?difficulty=hard')).data.rows.length,0);
    assert.equal((await h.request('/api/leaderboards?configId=mm-000000000000000000000000')).data.rows.length,0);
    await run(h.db,'UPDATE web_sessions SET context_expires_at=? WHERE token_hash=?',Date.now()-1,user.hash);
    assert.equal((await h.request('/api/leaderboards?scope=channel')).status,403);
  }finally{h.close();}
});
test('signed Discord launch creates a personal single-use ticket; duplicates do not multiply launches',async()=>{
  const h=await harness({production:true});try{const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);const hex=bytes=>Buffer.from(bytes).toString('hex');h.env.DISCORD_PUBLIC_KEY=hex(await crypto.subtle.exportKey('raw',keys.publicKey));
    const payload={application_id:h.env.DISCORD_CLIENT_ID,id:'999999999999999999',type:2,context:0,data:{name:'play',options:[{name:'game',value:'mastermind'}]},guild_id:'222222222222222222',channel_id:'333333333333333333',member:{user:{id:'111111111111111111'}},authorizing_integration_owners:{'0':'222222222222222222'}};
    const timestamp=String(Math.floor(Date.now()/1000)),body=JSON.stringify(payload),signature=hex(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(timestamp+body)));
    const call=()=>handle(new Request(h.env.APP_ORIGIN+'/api/discord/interactions',{method:'POST',headers:{'X-Signature-Timestamp':timestamp,'X-Signature-Ed25519':signature},body}),h.env);
    const first=await(await call()).json();assert.equal(first.data.flags,64);const ticket=new URL(first.data.components[0].components[0].url).searchParams.get('launch');assert.equal(ticket.length,64);
    const second=await(await call()).json();assert.ok(second.data.content.includes('already handled'));assert.equal((await one(h.db,'SELECT COUNT(*) AS n FROM launch_tickets')).n,1);
    await h.signIn();const r=await h.request('/api/context/redeem',{method:'POST',body:{ticket}});assert.equal(r.status,200);assert.equal(r.data.context.channelId,payload.channel_id);
    assert.equal((await h.request('/api/context/redeem',{method:'POST',body:{ticket}})).status,403);
  }finally{h.close();}
});
