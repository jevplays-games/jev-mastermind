import { writeFile,mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { scoreGuess,decodeGuess,encodeGuess } from '../public/mastermind/rules.js';
import { feedbackTable } from '../public/mastermind/strategy.js';
function independent(secret,guess){
  const remaining=[];let exact=0,near=0;
  for(let i=0;i<4;i++)if(secret[i]===guess[i])exact++;else remaining.push(secret[i]);
  for(let i=0;i<4;i++)if(secret[i]!==guess[i]){const position=remaining.indexOf(guess[i]);if(position>=0){near++;remaining.splice(position,1);}}
  return {exact,misplaced:near};
}
const started=performance.now(),codes=Array.from({length:1296},(_,i)=>decodeGuess(i)),lookup=feedbackTable();let pairs=0;
for(let a=0;a<1296;a++){
  assert.equal(encodeGuess(codes[a]),a);
  for(let b=0;b<1296;b++){
    const actual=scoreGuess(codes[a],codes[b]),expected=independent(codes[a],codes[b]);
    if(actual.exact!==expected.exact||actual.misplaced!==expected.misplaced)throw new Error(`Feedback mismatch ${a},${b}`);
    assert.equal(lookup[a*1296+b],actual.exact*5+actual.misplaced);
    assert.equal(lookup[a*1296+b],lookup[b*1296+a]);
    assert.ok(actual.exact+actual.misplaced<=4&&actual.exact>=0&&actual.misplaced>=0);
    assert.ok(!(actual.exact===3&&actual.misplaced===1));
    assert.equal(actual.exact===4,a===b);pairs++;
  }
}
const report={generatedAt:new Date().toISOString(),node:process.version,codeRoundTrips:1296,secretGuessPairs:pairs,
  assertionsPerPair:6,independentAlgorithm:'Remove exact matches, then consume unmatched secret symbols one at a time.',
  passed:true,elapsedMs:Math.round(performance.now()-started)};
await mkdir('reports',{recursive:true});await writeFile('reports/exhaustive-feedback.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
