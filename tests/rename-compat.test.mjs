/** Mastermind -> Typecrack rename: data written before the rename must keep verifying, and the old host and paths keep working until cutover. */
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,applyAction,makeReplay,reconstructReplay,serialize,deserialize,GAME_ID} from '../public/typecrack/rules.js';
import {randomToken,createCommitments,verifyReplay,COMMIT_LABEL,LEGACY_COMMIT_LABELS} from '../public/typecrack/verify.js';
import {handle} from '../server/worker.js';
import {config} from '../server/security.js';
import {harness,createBody} from './helpers.mjs';
const legacyReplay=JSON.parse(readFileSync(new URL('./fixtures/legacy-mastermind-replay.json',import.meta.url),'utf8'));
const secrets={targetForHuman:[0,0,1,1],targetForJev:[0,1,2,3],humanTargetSalt:randomToken(),jevTargetSalt:randomToken()};
async function finished(label){let s=createInitialState({matchId:'compat',commitments:await createCommitments('compat',secrets,label)});
  s=applyAction(s,{type:'GUESS',actor:'human',guess:secrets.targetForHuman},secrets);return applyAction(s,{type:'GUESS',actor:'jev',guess:secrets.targetForJev,source:'local'},secrets);}

test('a replay exported before the rename (game mastermind, jev-mastermind-commit-v1) still verifies',async()=>{
  assert.equal(legacyReplay.game,'mastermind');
  const result=await verifyReplay(legacyReplay);assert.equal(result.valid,true);assert.equal(result.state.outcome,legacyReplay.expectedOutcome);
  await assert.rejects(verifyReplay({...legacyReplay,reveal:{...legacyReplay.reveal,targetForJev:[5,5,5,5]}}));
});
test('an old commitment hashed under jev-mastermind-commit-v1 still verifies; new matches commit under the new label',async()=>{
  assert.deepEqual(LEGACY_COMMIT_LABELS,['jev-mastermind-commit-v1']);assert.equal(COMMIT_LABEL,'jev-typecrack-commit-v2');
  const old=makeReplay(await finished('jev-mastermind-commit-v1'),secrets);old.game='mastermind';
  assert.equal((await verifyReplay(old)).valid,true);
  const fresh=makeReplay(await finished(),secrets);assert.equal(fresh.game,GAME_ID);assert.equal(GAME_ID,'typecrack');
  assert.deepEqual(fresh.commitments,await createCommitments('compat',secrets,'jev-typecrack-commit-v2'));
  assert.notDeepEqual(fresh.commitments,old.commitments);assert.equal((await verifyReplay(fresh)).valid,true);
});
test('unknown commitment labels, mixed labels and unknown game ids are rejected',async()=>{
  await assert.rejects(verifyReplay(makeReplay(await finished('jev-other-commit-v1'),secrets)),/Commitment mismatch/);
  const r=makeReplay(await finished(),secrets);r.commitments.targetForJev=(await createCommitments('compat',secrets,'jev-mastermind-commit-v1')).targetForJev;
  await assert.rejects(verifyReplay(r),/Commitment mismatch/);
  const other={...makeReplay(await finished(),secrets),game:'checkers'};assert.throws(()=>reconstructReplay(other),/Invalid replay format/);
});
test('stored match state carrying the legacy game id still deserializes',()=>{
  const state=createInitialState({matchId:'compat'});assert.equal(state.game,'typecrack');
  assert.equal(deserialize(serialize({...state,game:'mastermind'})).game,'mastermind');
  assert.throws(()=>deserialize(serialize({...state,game:'sudoku'})),/Invalid state/);
});
test('match creation accepts typecrack and the legacy mastermind alias only',async()=>{
  const h=await harness();try{
    for(const game of ['typecrack','mastermind']){const r=await h.request('/api/matches',{method:'POST',body:createBody({game})});assert.equal(r.status,201,game);assert.equal(r.data.game,'typecrack');
      await h.request('/api/matches/'+r.data.matchId+'/actions',{method:'POST',body:{requestId:crypto.randomUUID(),expectedRevision:r.data.revision,action:{type:'RESIGN'}}});}
    assert.equal((await h.request('/api/matches',{method:'POST',body:createBody({game:'checkers'})})).status,422);
    assert.equal((await h.request('/api/health')).data.game,'typecrack');
  }finally{h.close();}
});
test('/play/mastermind GET/HEAD launch links redirect to /play/typecrack with the query intact; other methods are not redirected',async()=>{
  const h=await harness();try{
    const r=await h.request('/play/mastermind?launch=abc123',{raw:true});
    assert.equal(r.status,301);assert.equal(r.response.headers.get('location'),'/play/typecrack?launch=abc123');
    assert.equal(r.response.headers.get('x-content-type-options'),'nosniff');
    const head=await h.request('/play/mastermind?launch=abc123',{method:'HEAD',raw:true});
    assert.equal(head.status,301);assert.equal(head.response.headers.get('location'),'/play/typecrack?launch=abc123');
    for(const method of ['POST','PUT','DELETE'])assert.notEqual((await h.request('/play/mastermind',{method,raw:true})).status,301,method);
    assert.equal((await h.request('/play/typecrack?launch=abc123',{raw:true})).status,200);
  }finally{h.close();}
});
test('the pre-rename hostname keeps being served on its own origin until cutover; other hosts are refused',async()=>{
  const env={APP_ORIGIN:'https://typecrack.jevplay.games',LEGACY_ORIGINS:'https://mastermind.jevplay.games',QUOTA_SALT:'test-only-salt',ASSETS:{fetch:async()=>new Response('asset')}};
  assert.equal(config(env).origin,'https://typecrack.jevplay.games');
  assert.equal(config(env,'https://mastermind.jevplay.games').origin,'https://mastermind.jevplay.games');
  assert.equal(config(env,'https://evil.example').origin,'https://typecrack.jevplay.games');
  for(const host of ['typecrack','mastermind'])assert.equal((await handle(new Request(`https://${host}.jevplay.games/`),env)).status,200,host);
  assert.equal((await handle(new Request('https://evil.example/'),env)).status,421);
  // A malformed or non-HTTPS legacy entry is skipped (and logged); it must never take the canonical host down.
  const warn=console.warn,warnings=[];console.warn=m=>warnings.push(JSON.parse(m));
  try{
    for(const LEGACY_ORIGINS of ['mastermind.jevplay.games','https://mastermind.jevplay.games, not a url','http://mastermind.jevplay.games','::junk::']){
      const bad={...env,LEGACY_ORIGINS};
      assert.deepEqual(config(bad).legacyOrigins,LEGACY_ORIGINS.includes(', not a url')?['https://mastermind.jevplay.games']:[],LEGACY_ORIGINS);
      assert.equal((await handle(new Request('https://typecrack.jevplay.games/'),bad)).status,200,LEGACY_ORIGINS);
      assert.equal((await handle(new Request('https://typecrack.jevplay.games/api/health'),bad)).status,200,LEGACY_ORIGINS);
    }
    assert.deepEqual(warnings.map(w=>w.reason),['unparseable','unparseable','not_https','unparseable']);
    // D9: nothing but a bare origin may widen the allowlist. The five required strings plus extra malformed shapes are
    // skipped and logged, and never admit the host they smuggle in; the canonical and real legacy hosts stay served.
    warnings.length=0;
    const smuggled=[['https://user:pw@evil.example','forbidden_character'],['https://evil.example#@mastermind.jevplay.games','forbidden_character'],
      ['https://evil.example/path','not_bare_origin'],['https://evil.example?q=1','forbidden_character'],['https://*.jevplay.games','forbidden_character'],
      ['https://a.jevplay.games;https://b.example','not_bare_origin'],['https://a.jevplay.games;evil','invalid_host'],
      ['https://evil.example:443','not_bare_origin'],['https://Evil.example','not_bare_origin'],
      ['https://:pw@evil.example','forbidden_character'],['https://user@evil.example','forbidden_character'],['https://evil.example?','forbidden_character'],['https://evil.example#','forbidden_character']];
    for(const [LEGACY_ORIGINS] of smuggled){
      const bad={...env,LEGACY_ORIGINS:'https://mastermind.jevplay.games, '+LEGACY_ORIGINS};
      assert.deepEqual(config(bad).legacyOrigins,['https://mastermind.jevplay.games'],LEGACY_ORIGINS);
      assert.equal(config(bad,'https://evil.example').origin,'https://typecrack.jevplay.games',LEGACY_ORIGINS);
      assert.equal((await handle(new Request('https://evil.example/'),bad)).status,421,LEGACY_ORIGINS);
      for(const host of ['typecrack','mastermind']){
        assert.equal((await handle(new Request(`https://${host}.jevplay.games/`),bad)).status,200,host+' '+LEGACY_ORIGINS);
        assert.equal((await handle(new Request(`https://${host}.jevplay.games/api/health`),bad)).status,200,host+' '+LEGACY_ORIGINS);
      }
    }
    assert.deepEqual(warnings.map(w=>w.reason),smuggled.map(([,reason])=>reason));
    assert.ok(warnings.every(w=>!JSON.stringify(w).includes('evil')),'the skipped entry itself is never logged');
    // A single trailing slash is still the same bare origin.
    assert.deepEqual(config({...env,LEGACY_ORIGINS:'https://mastermind.jevplay.games/'}).legacyOrigins,['https://mastermind.jevplay.games']);
  }finally{console.warn=warn;}
});
test('Discord /play accepts the new typecrack choice and the pre-rename mastermind choice, and links to /play/typecrack',async()=>{
  const h=await harness({production:true});try{const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);const hex=bytes=>Buffer.from(bytes).toString('hex');h.env.DISCORD_PUBLIC_KEY=hex(await crypto.subtle.exportKey('raw',keys.publicKey));
    const launch=async(value,id)=>{const payload={application_id:h.env.DISCORD_CLIENT_ID,id,type:2,context:0,data:{name:'play',options:[{name:'game',value}]},guild_id:'222222222222222222',channel_id:'333333333333333333',member:{user:{id:'111111111111111111'}},authorizing_integration_owners:{'0':'222222222222222222'}};
      const timestamp=String(Math.floor(Date.now()/1000)),body=JSON.stringify(payload),signature=hex(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(timestamp+body)));
      return handle(new Request(h.env.APP_ORIGIN+'/api/discord/interactions',{method:'POST',headers:{'X-Signature-Timestamp':timestamp,'X-Signature-Ed25519':signature},body}),h.env);};
    for(const [value,id] of [['typecrack','999999999999999991'],['mastermind','999999999999999992']]){const r=await launch(value,id);assert.equal(r.status,200,value);
      const button=(await r.json()).data.components[0].components[0];assert.equal(new URL(button.url).pathname,'/play/typecrack');assert.equal(button.label,'Play Typecrack vs Jev');}
    assert.equal((await launch('checkers','999999999999999993')).status,400);
  }finally{h.close();}
});
