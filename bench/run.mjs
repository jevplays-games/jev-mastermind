/** Reproducible finite-space benchmark. Live spend is opt-in and bounded. */
import { mkdir,writeFile,appendFile,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialState,applyAction,decodeGuess,codeLabel } from '../public/mastermind/rules.js';
import { ALL_IDS,buildCandidates,selectDeterministic,consistentSecrets,partitionMetrics,referenceChoice } from '../public/mastermind/strategy.js';
import { describe,mean,codePattern,csvText } from '../public/mastermind/analytics.js';
import { chooseJevAction } from '../server/jev.js';
import { sha256 } from '../public/mastermind/verify.js';
const root=fileURLToPath(new URL('../',import.meta.url));
try{process.loadEnvFile(resolve(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
const args=process.argv.slice(2),flag=name=>args.includes('--'+name),value=(name,fallback)=>args.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=')??fallback;
const live=flag('live'),exhaustive=flag('exhaustive'),count=exhaustive?1296:Number(value('secrets',16)),seed=Number(value('seed',20260922));
if(!Number.isInteger(count)||count<1||count>1296||!Number.isInteger(seed))throw new Error('Use --secrets=1..1296 and an integer --seed.');
if(live&&(!flag('confirm-spend')||!process.env.TYPESAFE_API_KEY))throw new Error('Live benchmarking requires TYPESAFE_API_KEY and --confirm-spend. No live request was made.');
const maxCalls=Number(value('max-calls',100));if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>10000)throw new Error('Use --max-calls=1..10000.');
const defaults=['local-easy','local-normal','local-hard','local-jev','reference-minimax','reference-expected','random-consistent','random-legal'];
const policies=value('policies',live?'jev-easy,jev-normal,jev-hard,jev-jev':defaults.join(',')).split(',');
for(const p of policies)if(!defaults.includes(p)&&!(live&&/^jev-(easy|normal|hard|jev)$/.test(p)))throw new Error('Unknown or unauthorized policy: '+p);
const ids=count===1296?[...ALL_IDS]:Array.from({length:count},(_,i)=>count===1?0:Math.floor(i*1295/(count-1)));
const out=resolve(root,value('out',live?'reports/live':exhaustive?'reports/benchmark-exhaustive':'reports/benchmark-smoke'));
await mkdir(out,{recursive:true});
function rngFrom(initial){let state=initial>>>0;return()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const choiceCache=new Map(),qualityCache=new Map(),bestCache=new Map();let providerCalls=0,budgetStopped=false;
function historyKey(history){return history.map(h=>`${h.guessId}:${h.exact}:${h.misplaced}`).join(';');}
function quality(history,guessId){
  const remaining=consistentSecrets(history),key=remaining.join(',')+':'+guessId;
  if(qualityCache.has(key))return qualityCache.get(key);
  const selected=partitionMetrics(guessId,remaining,true);
  const setKey=remaining.join(',');
  let best=bestCache.get(setKey);
  if(!best){
    let bestWorst=Infinity,bestExpected=Infinity,bestInformation=-Infinity;
    if(remaining.length===1){bestWorst=1;bestExpected=1;bestInformation=0;}
    else for(const id of ALL_IDS){const m=partitionMetrics(id,remaining,true);bestWorst=Math.min(bestWorst,m.worstBucket);bestExpected=Math.min(bestExpected,m.expectedRemaining);bestInformation=Math.max(bestInformation,m.expectedInformationBits);}
    best={bestWorst,bestExpected,bestInformation};bestCache.set(setKey,best);
  }
  const {bestWorst,bestExpected,bestInformation}=best;
  const result={remaining,selected,bestWorst,bestExpected,bestInformation};qualityCache.set(key,result);return result;
}
const games=[],turns=[],provider=[];const started=performance.now();
for(const policy of policies){
  console.log('Benchmarking '+policy+' over '+ids.length+' secrets…');
  for(const secretId of ids){
    const difficulty=policy.startsWith('local-')||policy.startsWith('jev-')?policy.split('-').at(-1):'jev';
    const secrets={targetForHuman:[0,0,0,0],targetForJev:decodeGuess(secretId)};
    let state=createInitialState({matchId:`bench-${policy}-${secretId}`,difficulty,configId:policy});
    state=applyAction(state,{type:'GUESS',actor:'human',guess:secrets.targetForHuman},secrets);
    const rng=rngFrom(seed^secretId),gameStart=performance.now(),gameTurns=[],gameDecisions=[];let interrupted=false;
    while(state.phase==='jev_break'){
      const history=state.legs.jev.history,start=performance.now();let guessId,decision=null,cacheHit=false;
      if(policy.startsWith('jev-')){
        if(providerCalls>=maxCalls){budgetStopped=true;interrupted=true;break;}
        decision=await chooseJevAction({state,config:{model:process.env.JEV_MODEL||'jev-1.13.0',promptVersion:'mm-prompt-v1',timeoutMs:4500},apiKey:process.env.TYPESAFE_API_KEY,maxAttempts:Math.min(2,maxCalls-providerCalls)});
        providerCalls+=decision.attempts;guessId=decision.guessId;gameDecisions.push(decision);
        const audit={policy,secretId,turn:history.length+1,...decision};provider.push(audit);await appendFile(resolve(out,'provider-decisions.ndjson'),JSON.stringify(audit)+'\n');
      }else if(policy.startsWith('random-'))guessId=referenceChoice(history,policy,rng);
      else{
        const key=policy+'|'+historyKey(history);cacheHit=choiceCache.has(key);
        if(cacheHit)guessId=choiceCache.get(key);
        else{guessId=policy.startsWith('local-')?selectDeterministic(buildCandidates(history,difficulty),difficulty).guessId:referenceChoice(history,policy.replace('reference-',''));choiceCache.set(key,guessId);}
      }
      const selectorWallMs=performance.now()-start,q=quality(history,guessId),source=decision?.source||'local';
      state=applyAction(state,{type:'GUESS',actor:'jev',guess:decodeGuess(guessId),source,decisionRef:`bench-${history.length+1}`},secrets);
      const feedback=state.legs.jev.history.at(-1),after=consistentSecrets(state.legs.jev.history).length;
      gameTurns.push({policy,secretId,pattern:codePattern(secrets.targetForJev),turn:history.length+1,guessId,code:codeLabel(decodeGuess(guessId)),
        exact:feedback.exact,misplaced:feedback.misplaced,candidatesBefore:q.remaining.length,candidatesAfter:after,
        expectedInformationBits:q.selected.expectedInformationBits,realizedInformationBits:Math.log2(q.remaining.length/after),
        expectedRemaining:q.selected.expectedRemaining,worstBucket:q.selected.worstBucket,
        expectedRegret:Math.max(0,q.selected.expectedRemaining-q.bestExpected),worstCaseRegret:Math.max(0,q.selected.worstBucket-q.bestWorst),
        informationRegretBits:Math.max(0,q.bestInformation-q.selected.expectedInformationBits),selectorWallMs,cacheHit,source,
        providerAttempts:decision?.attempts??0,providerLatencyMs:decision?.latencyMs??null});
    }
    if(interrupted){await writeFile(resolve(out,'partial-game.json'),JSON.stringify({policy,secretId,history:state.legs.jev.history,reason:'provider_call_budget_exhausted'},null,2));break;}
    const leg=state.legs.jev,record={policy,secretId,secret:codeLabel(secrets.targetForJev),pattern:codePattern(secrets.targetForJev),seed:seed^secretId,
      solved:leg.status==='solved',guesses:leg.history.length,cost:leg.solvedAt??11,elapsedMs:performance.now()-gameStart,
      providerCalls:gameDecisions.reduce((s,d)=>s+d.attempts,0),fallbackMoves:gameDecisions.filter(d=>d.source==='fallback').length,
      invalidResponses:gameDecisions.reduce((s,d)=>s+d.invalidResponses,0),meanInformationRegretBits:mean(gameTurns.map(t=>t.informationRegretBits))};
    games.push(record);turns.push(...gameTurns);
    if(games.length%64===0)await writeFile(resolve(out,'checkpoint.json'),JSON.stringify({lastPolicy:policy,lastSecret:secretId,completedGames:games.length,providerCalls}));
  }
}
const summaryPolicies=policies.map(policy=>{const subset=games.filter(g=>g.policy===policy),costs=subset.map(g=>g.cost),stats=describe(costs);return {policy,secrets:subset.length,
  solved:subset.filter(g=>g.solved).length,solveRate:subset.length?subset.filter(g=>g.solved).length/subset.length:null,
  meanCost:stats.mean,maxCost:stats.max,p50Cost:stats.p50,p95Cost:stats.p95,
  meanSolvedGuesses:mean(subset.filter(g=>g.solved).map(g=>g.guesses)),providerCalls:subset.reduce((s,g)=>s+g.providerCalls,0),
  fallbackMoves:subset.reduce((s,g)=>s+g.fallbackMoves,0),invalidResponses:subset.reduce((s,g)=>s+g.invalidResponses,0),
  meanInformationRegretBits:mean(turns.filter(t=>t.policy===policy).map(t=>t.informationRegretBits)),
  guessHistogram:Array.from({length:11},(_,i)=>({cost:i+1,count:costs.filter(n=>n===i+1).length}))};});
const patterns=[];for(const p of policies)for(const pattern of ['4','3+1','2+2','2+1+1','1+1+1+1']){const r=games.filter(g=>g.policy===p&&g.pattern===pattern);patterns.push({policy:p,pattern,secrets:r.length,solved:r.filter(g=>g.solved).length,meanCost:mean(r.map(g=>g.cost)),maxCost:r.length?Math.max(...r.map(g=>g.cost)):null});}
const pairs=[];for(let a=0;a<policies.length;a++)for(let b=a+1;b<policies.length;b++){
  const first=new Map(games.filter(g=>g.policy===policies[a]).map(g=>[g.secretId,g]));
  const comparisons=games.filter(g=>g.policy===policies[b]&&first.has(g.secretId)).map(g=>({a:first.get(g.secretId),b:g}));
  pairs.push({policyA:policies[a],policyB:policies[b],pairedSecrets:comparisons.length,aFewerGuesses:comparisons.filter(x=>x.a.cost<x.b.cost).length,
    ties:comparisons.filter(x=>x.a.cost===x.b.cost).length,bFewerGuesses:comparisons.filter(x=>x.a.cost>x.b.cost).length,
    meanCostDifferenceAminusB:mean(comparisons.map(x=>x.a.cost-x.b.cost))});
}
const sourceHashes={};for(const path of ['public/mastermind/rules.js','public/mastermind/strategy.js','public/mastermind/analytics.js','server/jev.js','bench/run.mjs'])sourceHashes[path]=await sha256(await readFile(resolve(root,path),'utf8'));
const report={generatedAt:new Date().toISOString(),node:process.version,seed,live,requestedSecrets:count,completedGames:games.length,providerCalls,budgetStopped,
  coverage:count===1296&&!budgetStopped?'Every one of the 1,296 possible codes for every selected policy.':'Deterministically spaced secret subset; see per-policy completed coverage.',
  comparisonCoverage:'Counterfactual one-step move metrics compare all 1,296 legal guesses at each recorded state.',
  elapsedMs:performance.now()-started,policies:summaryPolicies,patterns,pairs,sourceHashes,
  limitations:['Local policies are deterministic selector ablations, not live JEV measurements.','Exhaustive enumeration needs no sampling confidence interval for this finite configuration.',
    'Human-selected secret distributions can differ from uniform enumeration.','Cached selector timings are not inference latency; cacheHit is exported per turn.',
    'Fallback-containing live games are identifiable and are not pure model-strength observations.','Pairs compare codebreaking on matched secrets, not human codemaker skill.']};
await Promise.all([
  writeFile(resolve(out,'summary.json'),JSON.stringify(report,null,2)+'\n'),writeFile(resolve(out,'games.csv'),csvText(games)),writeFile(resolve(out,'moves.csv'),csvText(turns)),
  writeFile(resolve(out,'patterns.csv'),csvText(patterns)),writeFile(resolve(out,'paired-comparisons.csv'),csvText(pairs)),writeFile(resolve(out,'games.ndjson'),games.map(g=>JSON.stringify(g)).join('\n')+'\n'),
  writeFile(resolve(out,'README.md'),`# Measured Mastermind benchmark\n\nGenerated ${report.generatedAt}.\n\n${report.coverage}\n\n${live?'Live-provider run; inspect fallback flags and call budget.':'No live JEV calls. All opponent policies are local baselines/ablations.'}\n\n## Results\n\n| Policy | Secrets | Solved | Mean cost | Maximum cost |\n|---|---:|---:|---:|---:|\n`+summaryPolicies.map(p=>`| ${p.policy} | ${p.secrets} | ${p.solved} | ${p.meanCost?.toFixed(4)??'n/a'} | ${p.maxCost??'n/a'} |`).join('\n')+'\n\n'+report.limitations.map(x=>'- '+x).join('\n')+'\n')
]);
if(exhaustive&&!live&&!budgetStopped)await writeFile(resolve(root,'public/benchmark-summary.json'),JSON.stringify({generatedAt:report.generatedAt,coverage:report.coverage,live:false,policies:summaryPolicies},null,2));
console.log(JSON.stringify({output:out,completedGames:games.length,providerCalls,budgetStopped,elapsedMs:Math.round(report.elapsedMs),policies:summaryPolicies.map(p=>({policy:p.policy,secrets:p.secrets,solveRate:p.solveRate,meanCost:p.meanCost,maxCost:p.maxCost}))},null,2));
