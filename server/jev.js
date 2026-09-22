import { getJevView, parseActionId } from '../public/mastermind/rules.js';
import { buildCandidates, selectDeterministic, fallbackGuess, CODES, partitionMetrics, consistentSecrets } from '../public/mastermind/strategy.js';
import { sha256 } from '../public/mastermind/verify.js';
export const PROVIDER_URL='https://api.typesafe.ai/v1/systemone';
const instructions={
  easy:'Choose one consistent Mastermind code. Prefer covering unused symbols, then useful symbol variety. Codes use four positions, six symbols, and repeats. Use only the supplied observations and choices.',
  normal:'Choose a Mastermind guess using the exact supplied metrics. Prefer low expectedRemaining and worstBucket, then a possible secret. These are uniform-reference metrics, not a model of the human. Never infer a hidden code from outside the history.',
  hard:'Select the best supplied Mastermind probe or possible solution. Favor minimum expectedRemaining, then a small worstBucket, and the ability to solve now when information quality is comparable. On the last guess, all choices are possible secrets.',
  jev:'Select the strongest supplied Mastermind guess. Choices have been minimax-filtered (except the final attempt, which only allows possible secrets). Favor lowest expectedRemaining, possible-secret status, then low action ID for otherwise identical choices.'
};
export function buildRequest(view,built,model='jev-1.13.0') {
  // Re-project even when called outside the match engine: discard arbitrary extra view keys.
  const clean={game:'mastermind',difficulty:view.difficulty,attemptNumber:view.attemptNumber,attemptsRemaining:view.attemptsRemaining,
    consistentSecretCount:built.remainingCount,history:view.history.map(h=>({guessId:h.guessId,guess:[...h.guess],exact:h.exact,misplaced:h.misplaced}))};
  return {model,state:clean,questions:{choose_guess:{type:'choice',instructions:instructions[view.difficulty],criteria:Object.fromEntries(built.candidates.map(c=>{
    const {actionId,guessId,...features}=c;return [actionId,features];
  }))}}};
}
export function validateChoice(data,built,model) {
  if(data?.model!==model)throw new Error('model_mismatch');
  const answer=data.answers?.choose_guess;
  if(answer?.type!=='choice'||typeof answer.choice!=='string')throw new Error('invalid_answer');
  const ids=built.candidates.map(c=>c.actionId),p=answer.probabilities;
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==ids.length||!ids.every(id=>Object.hasOwn(p,id)))throw new Error('invalid_probability_keys');
  if(!ids.every(id=>Number.isFinite(p[id])&&p[id]>=0&&p[id]<=1)||Math.abs(ids.reduce((a,id)=>a+p[id],0)-1)>.001)throw new Error('invalid_probabilities');
  if(!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1)throw new Error('invalid_confidence');
  const max=Math.max(...ids.map(id=>p[id]));
  if(!ids.includes(answer.choice)||p[answer.choice]!==max)throw new Error('invalid_choice');
  const chosen=ids.filter(id=>p[id]===max).sort((a,b)=>parseActionId(a)-parseActionId(b))[0];
  return {guessId:parseActionId(chosen),confidence:answer.confidence,selectedProbability:p[chosen],probabilities:p};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function safeUsage(usage) {
  return usage&&Number.isInteger(usage.input_tokens)&&usage.input_tokens>=0&&Number.isInteger(usage.output_tokens)&&usage.output_tokens>=0?
    {input_tokens:usage.input_tokens,output_tokens:usage.output_tokens}:null;
}
export async function chooseJevAction({state,config,apiKey,fetchImpl=fetch,maxAttempts=2,forceFallbackReason=null}) {
  const start=performance.now(),view=getJevView(state),built=buildCandidates(view.history,view.difficulty);
  const request=buildRequest(view,built,config.model),requestHash=await sha256(request);
  const base={policyVersion:built.policyVersion,modelVersion:config.model,promptVersion:config.promptVersion,requestHash,
    remainingCount:built.remainingCount,evaluatedCount:built.evaluatedCount,candidateCount:built.candidates.length,
    candidateIds:built.candidates.map(c=>c.actionId),requestBytes:new TextEncoder().encode(JSON.stringify(request)).length,
    attempts:0,invalidResponses:0,errors:[],usage:null,usageComplete:true};
  const finish=(guessId,source,extra={})=>{
    const selected=built.candidates.find(c=>c.guessId===guessId);
    return {...base,...extra,guessId,source,selectedFeatures:selected??{guessId,guess:CODES[guessId]},
      latencyMs:Math.round((performance.now()-start)*100)/100};
  };
  // No credentials is explicitly local, not a failed or pretend remote inference.
  if(!apiKey&&!forceFallbackReason) return finish(selectDeterministic(built,view.difficulty).guessId,'local',{reason:'provider_not_configured'});
  if(forceFallbackReason) return finish(fallbackGuess(view.history),'fallback',{reason:forceFallbackReason,usageComplete:false});
  if(built.remainingCount===1||built.candidates.length===1) return finish(built.candidates[0].guessId,'forced',{reason:built.remainingCount===1?'forced_solution':'forced_policy'});
  let usageTotal={input_tokens:0,output_tokens:0},observedUsage=false;
  for(let attempt=0;attempt<maxAttempts;attempt++) {
    const remainingBudget=(config.timeoutMs??4500)-(performance.now()-start);
    if(remainingBudget<20)break;
    base.attempts++;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),remainingBudget);
    let retryDelay=100*2**attempt;
    try {
      const response=await fetchImpl(PROVIDER_URL,{method:'POST',headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal});
      if(!response.ok) {
        base.usageComplete=false;
        base.errors.push(`http_${response.status}`);
        const retryAfter=response.headers.get('retry-after');
        if(retryAfter) { const seconds=Number(retryAfter); retryDelay=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(retryAfter)-Date.now()); }
        if(![408,429,500,502,503,504,529].includes(response.status)) break;
      } else {
        const text=await response.text();if(text.length>131072)throw new Error('response_too_large');
        const data=JSON.parse(text),usage=safeUsage(data.usage);
        if(usage){observedUsage=true;usageTotal.input_tokens+=usage.input_tokens;usageTotal.output_tokens+=usage.output_tokens;}
        else base.usageComplete=false;
        base.usage=observedUsage?usageTotal:null;
        const choice=validateChoice(data,built,config.model);
        return finish(choice.guessId,'jev',{...choice,usage:base.usage});
      }
    } catch(error) {
      const timeout=error?.name==='AbortError';
      const known=['model_mismatch','invalid_answer','invalid_probability_keys','invalid_probabilities','invalid_confidence','invalid_choice','response_too_large'];
      const reason=timeout?'timeout':known.includes(error.message)?error.message:error instanceof SyntaxError?'malformed_json':'transport_error';
      base.errors.push(reason);if(reason!=='timeout'&&reason!=='transport_error')base.invalidResponses++;
      if(timeout||reason==='transport_error'||reason==='malformed_json')base.usageComplete=false;
    } finally {clearTimeout(timer);}
    if(attempt+1>=maxAttempts||!Number.isFinite(retryDelay)||performance.now()-start+retryDelay+20>config.timeoutMs)break;
    await sleep(retryDelay);
  }
  return finish(fallbackGuess(view.history),'fallback',{reason:base.errors.at(-1)||'decision_budget_exhausted',usage:observedUsage?usageTotal:null});
}
