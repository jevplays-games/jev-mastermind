import test from 'node:test';import assert from 'node:assert/strict';
import {feedbackTable,feedbackTableReference,consistentSecrets,consistentSecretsReference,buildCandidates,buildCandidatesReference,selectDeterministic} from '../public/mastermind/strategy.js';
import {scoreGuess,decodeGuess} from '../public/mastermind/rules.js';
import {buildRequest} from '../server/jev.js';
import {sha256} from '../public/mastermind/verify.js';
const lcg=seed=>()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
test('optimized feedback table is byte-identical to the reference table',()=>{
  assert.equal(Buffer.compare(feedbackTable(),feedbackTableReference()),0);
});
/** Plays one seeded game, comparing every step of the optimized and reference paths. */
function playAndCompare(secret,difficulty,rnd,stats){
  const history=[];
  for(let turn=0;turn<10;turn++){
    assert.deepEqual(consistentSecrets(history),consistentSecretsReference(history));
    const fast=buildCandidates(history,difficulty),ref=buildCandidatesReference(history,difficulty);
    assert.deepEqual(fast,ref);
    assert.equal(JSON.stringify(fast),JSON.stringify(ref)); // key order matters for requestBytes
    assert.deepEqual(selectDeterministic(fast,difficulty),selectDeterministic(ref,difficulty));
    stats.compared++;
    // Mix policy choices with random picks so histories cover probes, repeats and off-policy guesses.
    const r=rnd(),guessId=r<.5?selectDeterministic(fast,difficulty).guessId:r<.8?fast.candidates[Math.floor(rnd()*fast.candidates.length)].guessId:Math.floor(rnd()*1296);
    const guess=decodeGuess(guessId);history.push({guessId,guess,...scoreGuess(decodeGuess(secret),guess)});
    if(history.at(-1).exact===4)break;
  }
}
test('buildCandidates and consistentSecrets equal their references over seeded games',()=>{
  const rnd=lcg(20260930),stats={compared:0};
  for(const difficulty of ['easy','normal','hard','jev'])for(let g=0;g<(difficulty==='easy'||difficulty==='normal'?80:40);g++)playAndCompare(Math.floor(rnd()*1296),difficulty,rnd,stats);
  assert.ok(stats.compared>800);
});
test('last-attempt candidates and request hashes are identical',async()=>{
  const rnd=lcg(7);
  for(let n=0;n<20;n++){
    const secret=Math.floor(rnd()*1296),history=[];
    for(let i=0;i<9;i++){const guessId=Math.floor(rnd()*1296),guess=decodeGuess(guessId);history.push({guessId,guess,...scoreGuess(decodeGuess(secret),guess)});}
    if(history.some(h=>h.exact===4))continue;
    for(const difficulty of ['easy','normal','hard','jev']){
      const fast=buildCandidates(history,difficulty),ref=buildCandidatesReference(history,difficulty);
      assert.deepEqual(fast,ref);
      const view={game:'mastermind',difficulty,attemptNumber:10,attemptsRemaining:1,history:history.map(({guessId,guess,exact,misplaced})=>({guessId,guess,exact,misplaced}))};
      assert.equal(await sha256(buildRequest(view,fast)),await sha256(buildRequest(view,ref)));
      assert.equal(JSON.stringify(buildRequest(view,fast)),JSON.stringify(buildRequest(view,ref)));
    }
  }
});
test('invalid or inconsistent histories fail identically',()=>{
  for(const bad of [[{guessId:0,exact:3,misplaced:1}],[{guessId:0,exact:4,misplaced:0},{guessId:1,exact:4,misplaced:0}],[{guessId:1296,exact:0,misplaced:0}],[{guessId:0,exact:-1,misplaced:0}]]){
    assert.throws(()=>consistentSecretsReference(bad));assert.throws(()=>consistentSecrets(bad));
  }
  assert.deepEqual(consistentSecrets([]),consistentSecretsReference([]));
});
