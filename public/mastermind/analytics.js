/** Exact post-match analysis. All probabilities are uniform-reference quantities, not human priors. */
import { CODES, ALL_IDS, consistentSecrets, partitionMetrics, feedbackTable } from './strategy.js';
import { breakerCost, isTerminal, codeLabel } from './rules.js';
export const ANALYTICS_VERSION = 'mm-analytics-v1';
export const sum = values => values.reduce((a,b)=>a+b,0);
export const mean = values => values.length ? sum(values)/values.length : null;
export function quantile(values, p) {
  if (!values.length) return null;
  const v=[...values].sort((a,b)=>a-b), k=(v.length-1)*p, a=Math.floor(k), b=Math.ceil(k);
  return v[a]+(v[b]-v[a])*(k-a);
}
export function describe(values) {
  const v=values.filter(Number.isFinite), m=mean(v);
  return { count:v.length, mean:m, min:v.length?Math.min(...v):null, max:v.length?Math.max(...v):null,
    p50:quantile(v,.5),p90:quantile(v,.9),p95:quantile(v,.95),p99:quantile(v,.99),
    sampleStdDev:v.length>1?Math.sqrt(sum(v.map(x=>(x-m)**2))/(v.length-1)):null };
}
export function codePattern(code) {
  const counts=Array(6).fill(0); code.forEach(n=>counts[n]++);
  return counts.filter(Boolean).sort((a,b)=>b-a).join('+');
}
export function analyzeLeg(history, { exhaustive=true }={}) {
  let remaining=[...ALL_IDS], used=new Set(), usedSymbols=new Set(), rows=[];
  const table=feedbackTable();
  for (let index=0;index<history.length;index++) {
    const h=history[index], id=h.guessId, guess=CODES[id], before=remaining.length;
    const selected=partitionMetrics(id, remaining, true), canBeSecret=remaining.includes(id);
    let bestExpected=selected.expectedRemaining,bestWorst=selected.worstBucket,bestInformation=selected.expectedInformationBits;
    let bestExpectedId=id,bestWorstId=id,bestInformationId=id;
    if (exhaustive) {
      bestExpected=Infinity; bestWorst=Infinity; bestInformation=-Infinity;
      // Counterfactual comparison permits every legal code, including repeats; no hidden secret is used.
      for (const candidate of ALL_IDS) {
        const metrics=partitionMetrics(candidate,remaining,true);
        if (metrics.expectedRemaining<bestExpected) { bestExpected=metrics.expectedRemaining;bestExpectedId=candidate; }
        if (metrics.worstBucket<bestWorst) { bestWorst=metrics.worstBucket;bestWorstId=candidate; }
        if (metrics.expectedInformationBits>bestInformation) { bestInformation=metrics.expectedInformationBits;bestInformationId=candidate; }
      }
    }
    const after=remaining.filter(s=>table[id*1296+s]===h.exact*5+h.misplaced);
    if (!after.length) throw new Error('Cannot analyze inconsistent feedback.');
    const priorEntropy=Math.log2(before), posteriorEntropy=Math.log2(after.length);
    const repeated=used.has(id), newSymbols=new Set(guess.filter(n=>!usedSymbols.has(n))).size;
    guess.forEach(n=>usedSymbols.add(n));
    rows.push({ turn:index+1,guessId:id,code:codeLabel(guess),exact:h.exact,misplaced:h.misplaced,
      candidatesBefore:before,candidatesAfter:after.length,eliminated:before-after.length,eliminationRate:1-after.length/before,
      priorEntropyBits:priorEntropy,posteriorEntropyBits:posteriorEntropy,realizedInformationBits:priorEntropy-posteriorEntropy,
      expectedInformationBits:selected.expectedInformationBits,expectedRemaining:selected.expectedRemaining,
      worstBucket:selected.worstBucket,feedbackOutcomes:selected.feedbackOutcomes,feedbackProbability:after.length/before,
      surpriseBits:-Math.log2(after.length/before),uniformSolveProbability:canBeSecret?1/before:0,
      canBeSecret,isProbe:!canBeSecret,repeated,newSymbols,symbolCoverage:usedSymbols.size,distinctSymbols:new Set(guess).size,
      bestExpectedRemaining:exhaustive?bestExpected:null,bestExpectedGuessId:exhaustive?bestExpectedId:null,
      bestWorstBucket:exhaustive?bestWorst:null,bestWorstGuessId:exhaustive?bestWorstId:null,
      bestInformationBits:exhaustive?bestInformation:null,bestInformationGuessId:exhaustive?bestInformationId:null,
      expectedRegret:exhaustive?Math.max(0,selected.expectedRemaining-bestExpected):null,
      worstCaseRegret:exhaustive?Math.max(0,selected.worstBucket-bestWorst):null,
      informationRegretBits:exhaustive?Math.max(0,bestInformation-selected.expectedInformationBits):null,
      feedbackBuckets:selected.buckets.map((n,k)=>({exact:Math.floor(k/5),misplaced:k%5,count:n})).filter(x=>x.count)
    });
    remaining=after;used.add(id);
  }
  return { rows,summary:{ guesses:history.length,solved:history.some(h=>h.exact===4),finalCandidates:remaining.length,
    remainingEntropyBits:Math.log2(remaining.length),totalInformationBits:Math.log2(1296/remaining.length),
    repeatedGuesses:rows.filter(r=>r.repeated).length,probes:rows.filter(r=>r.isProbe).length,
    noEliminationGuesses:rows.filter(r=>r.eliminated===0 && r.exact!==4).length,
    meanExpectedInformationBits:mean(rows.map(r=>r.expectedInformationBits)),
    meanInformationRegretBits:exhaustive?mean(rows.map(r=>r.informationRegretBits)):null,
    meanExpectedRegret:exhaustive?mean(rows.map(r=>r.expectedRegret)):null,
    minimaxOptimalMoves:exhaustive?rows.filter(r=>r.worstCaseRegret===0).length:null,
    expectedOptimalMoves:exhaustive?rows.filter(r=>r.expectedRegret<1e-9).length:null,
    symbolCoverage:usedSymbols.size } };
}
export function analyzeMatch(state, secrets, {decisions=[],timings=[],exhaustive=true}={}) {
  if (!isTerminal(state)) throw new Error('Full deduction analytics are available only after the match ends.');
  const human=analyzeLeg(state.legs.human.history,{exhaustive}),jev=analyzeLeg(state.legs.jev.history,{exhaustive});
  const knownUsage=decisions.filter(d=>d.usage).map(d=>d.usage);
  return {analyticsVersion:ANALYTICS_VERSION,rulesVersion:state.rulesVersion,configId:state.configId,difficulty:state.difficulty,
    matchId:state.matchId,phase:state.phase,outcome:state.outcome,finishReason:state.finishReason,
    comparison:exhaustive?'all_1296_legal_guesses_per_turn':'selected_guess_only',
    referenceDistribution:'Uniform over codes consistent with that player’s feedback history; not an estimate of human behavior.',
    human,jev,codePatterns:{targetForHuman:codePattern(secrets.targetForHuman),targetForJev:codePattern(secrets.targetForJev)},
    score:{humanCost:state.phase==='forfeit'?11:breakerCost(state.legs.human),jevCost:state.phase==='forfeit'?null:breakerCost(state.legs.jev)},
    decisions, timing:{serverObservedHumanIntervalsMs:describe(timings.filter(t=>t.actor==='human'&&t.action==='GUESS').map(t=>t.elapsedMs)),
      jevDecisionLatencyMs:describe(decisions.map(d=>d.latencyMs))},
    provider:{decisionCount:decisions.length,jevCalls:sum(decisions.map(d=>d.attempts??0)),
      forcedMoves:decisions.filter(d=>d.source==='forced').length,localMoves:decisions.filter(d=>d.source==='local').length,
      fallbackMoves:decisions.filter(d=>d.source==='fallback').length,invalidResponses:sum(decisions.map(d=>d.invalidResponses??0)),
      inputTokensReported:sum(knownUsage.map(u=>u.input_tokens??0)),outputTokensReported:sum(knownUsage.map(u=>u.output_tokens??0)),
      usageIncomplete:decisions.some(d=>((d.attempts??0)>0 || (d.unobservedReservedAttempts??0)>0) && d.usageComplete!==true),
      choiceConfidence:describe(decisions.map(d=>d.confidence)),selectedProbability:describe(decisions.map(d=>d.selectedProbability)),
      confidenceMeaning:'Choice concentration only; not probability of solving or winning.'} };
}
export function csvText(records) {
  if (!records.length) return '';
  const fields=[...new Set(records.flatMap(r=>Object.keys(r)))];
  const quote=value=>{
    let s=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
    if (typeof value==='string' && /^[=+@\-\t\r]/.test(s)) s="'"+s; // Neutralize formula injection when opened in a spreadsheet.
    return '"'+s.replaceAll('"','""')+'"';
  };
  return [fields.map(quote).join(','),...records.map(r=>fields.map(f=>quote(r[f])).join(','))].join('\r\n')+'\r\n';
}
export function wilson(successes,n,z=1.959963984540054) {
  if (!n) return null;
  const p=successes/n,den=1+z*z/n,center=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
  return {lower:Math.max(0,center-half),upper:Math.min(1,center+half),level:.95};
}
/** Optional high-detail export: every legal alternative, not only the selected move. */
export function alternativeRows(state) {
  if(!isTerminal(state))throw new Error('Alternative analysis is available only after the match ends.');
  const rows=[];
  for(const actor of ['human','jev']) {
    const history=state.legs[actor].history;
    for(let turn=0;turn<history.length;turn++) {
      const remaining=consistentSecrets(history.slice(0,turn)),possible=new Set(remaining);
      for(const guessId of ALL_IDS) {
        const metric=partitionMetrics(guessId,remaining,true);
        rows.push({actor,turn:turn+1,guessId,code:codeLabel(CODES[guessId]),selected:history[turn].guessId===guessId,
          candidatesBefore:remaining.length,canBeSecret:possible.has(guessId),referenceSolveProbability:possible.has(guessId)?1/remaining.length:0,
          expectedRemaining:metric.expectedRemaining,worstBucket:metric.worstBucket,expectedInformationBits:metric.expectedInformationBits,
          feedbackOutcomes:metric.feedbackOutcomes,feedbackBuckets:metric.buckets.map((n,k)=>({exact:Math.floor(k/5),misplaced:k%5,count:n})).filter(x=>x.count)});
      }
    }
  }
  return rows;
}
