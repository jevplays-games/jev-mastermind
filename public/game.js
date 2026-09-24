import { SYMBOLS,createInitialState,applyAction,isTerminal,makeReplay,decodeGuess,codeLabel,encodeGuess } from './mastermind/rules.js';
import { randomCode,randomToken,createCommitments,verifyReplay } from './mastermind/verify.js';
import { buildCandidates,selectDeterministic } from './mastermind/strategy.js';
import { csvText } from './mastermind/analytics.js';
const $=id=>document.getElementById(id);
const storage={get(key,fallback=null){try{return JSON.parse(localStorage.getItem('mm:'+key))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem('mm:'+key,JSON.stringify(value));}catch{}}};
const view={session:null,match:null,practice:null,secret:storage.get('secret',[0,0,2,5]),guess:[null,null,null,null],selected:{secret:0,guess:0},editor:'secret',busy:false,driving:false,
  pendingRequest:null,report:null,analysisReplay:null,analysisJob:null,record:null,recordRows:[],recordCursor:null,imported:false};
if(!Array.isArray(view.secret)||view.secret.length!==4||!view.secret.every(x=>Number.isInteger(x)&&x>=0&&x<6))view.secret=[0,0,2,5];
const fmt=(value,digits=2)=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:digits});
const pct=value=>value==null?'—':fmt(value*100,1)+'%';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function node(tag,attrs={},text=null){const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k==='class')n.className=v;else n.setAttribute(k,String(v));}if(text!==null)n.textContent=String(text);return n;}
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function errorNotice(error){notice(error.message||'The request failed.',true);}
function table(container,columns,rows,empty='No data yet.'){
  const host=typeof container==='string'?$(container):container;host.replaceChildren();
  if(!rows.length){host.append(node('p',{class:'muted'},empty));return;}
  const t=node('table'),head=node('thead'),tr=node('tr');columns.forEach(c=>tr.append(node('th',{scope:'col'},c.label)));head.append(tr);t.append(head);
  const body=node('tbody');for(const row of rows){const r=node('tr');for(const c of columns){const td=node('td');const value=c.render?c.render(row):row[c.key];if(value instanceof Node)td.append(value);else td.textContent=value==null?'—':String(value);r.append(td);}body.append(r);}t.append(body);host.append(t);
}
function stat(label,value,note=''){const item=node('div',{class:'stat'});item.append(node('span',{class:'stat-label'},label),node('strong',{class:'stat-value'},value),node('span',{class:'stat-note'},note));return item;}
function download(name,text,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type})),a=node('a',{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function api(path,{method='GET',body}={}){
  const response=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':view.session?.csrf||''},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json();}catch{throw new Error('The server returned an unreadable response. Your draft is preserved.');}
  if(!response.ok){const error=new Error(data.error?.message||`Request failed (${response.status}).`);error.status=response.status;error.code=data.error?.code;throw error;}
  return data;
}
function showPage(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('hidden',p.id!=='page-'+page));
  document.querySelectorAll('.tab').forEach(b=>{const selected=b.dataset.page===page;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(page==='analysis')ensureAnalysis().catch(errorNotice);
  if(page==='record')loadRecord().catch(errorNotice);
  if(page==='leaderboards')loadLeaders().catch(errorNotice);
  if(page==='benchmarks')loadBenchmarks().catch(errorNotice);
}
function renderEditor(kind){
  const values=kind==='secret'?view.secret:view.guess,slots=$(kind+'Slots'),palette=$(kind+'Palette');slots.replaceChildren();
  values.forEach((value,index)=>{const button=node('button',{class:`slot ${value==null?'empty':'c'+value}${view.selected[kind]===index?' selected':''}`,
    'aria-label':`${kind==='secret'?'Secret':'Guess'} position ${index+1}: ${value==null?'empty':SYMBOLS[value]}`,'aria-pressed':view.selected[kind]===index},value==null?'·':SYMBOLS[value]);
    button.addEventListener('click',()=>{view.editor=kind;view.selected[kind]=index;renderEditor(kind);$(kind+'Slots').children[index].focus();});slots.append(button);});
  if(!palette.children.length)SYMBOLS.forEach((symbol,i)=>{const button=node('button',{class:'c'+i,'aria-label':`Use symbol ${symbol}`},symbol);button.addEventListener('click',()=>fillSymbol(kind,i));palette.append(button);});
  $('submitGuess').disabled=view.busy||view.guess.some(n=>n==null);
  if(kind==='secret'){$('start').disabled=!view.session||view.busy||view.secret.some(n=>n==null);$('localStart').disabled=view.busy||view.secret.some(n=>n==null);}
}
function fillSymbol(kind,value){
  view.editor=kind;const list=kind==='secret'?view.secret:view.guess,index=view.selected[kind];list[index]=value;view.selected[kind]=(index+1)%4;
  if(kind==='secret')storage.set('secret',view.secret);else if(view.match)storage.set('draft:'+view.match.matchId,view.guess);
  renderEditor(kind);$(kind+'Slots').children[view.selected[kind]].focus();updateRepeat();
}
function updateRepeat(){
  const repeated=view.match&&view.guess.every(n=>n!=null)&&view.match.legs.human.history.some(h=>h.guessId===encodeGuess(view.guess));
  $('repeatWarning').textContent=repeated?'Repeated guess. Submitting still consumes an attempt.':'';
}
function drawBoard(actor){
  const board=$(actor+'Board'),history=view.match?.legs[actor].history||[];board.replaceChildren();
  for(let i=0;i<10;i++){
    const h=history[i],current=view.match?.phase===actor+'_break'&&i===history.length;
    const row=node('div',{class:'guess-row'+(current?' current':'')+(h?.exact===4?' solved':'')});row.append(node('span',{class:'guess-number'},String(i+1).padStart(2,'0')));
    const pegs=node('div',{class:'guess-pegs','aria-label':h?`Guess ${i+1}: ${codeLabel(h.guess)}`:`Guess ${i+1}: empty`});
    for(let k=0;k<4;k++)pegs.append(node('span',{class:'peg '+(h?'c'+h.guess[k]:'empty'),'aria-hidden':'true'},h?SYMBOLS[h.guess[k]]:''));
    const feedback=node('div',{class:'feedback','aria-label':h?`${h.exact} exact, ${h.misplaced} near`:'No feedback'});
    feedback.append(node('span',{class:'exact','aria-hidden':'true'},h?h.exact:'—'),node('span',{'aria-hidden':'true'},'/'),node('span',{'aria-hidden':'true'},h?h.misplaced:'—'));row.append(pegs,feedback);board.append(row);
  }
  $(actor+'Score').textContent=`${history.length} / 10`;
}
function renderEvidence(){
  const body=$('evidenceBody');body.classList.toggle('hidden',!$('showEvidence').checked);body.replaceChildren();
  const d=view.match?.evidence;if(!d){body.append(node('p',{class:'muted'},'Candidate counts, selected features, and timing appear during the opponent’s leg.'));return;}
  const grid=node('div',{class:'evidence-stats'});
  for(const [label,value]of [['Possible secrets',fmt(d.remainingCount,0)],['Choices offered',fmt(d.candidateCount,0)],['Selected code',codeLabel(decodeGuess(d.guessId))],['Decision time',fmt(d.latencyMs,0)+' ms']]){
    const n=node('div',{class:'evidence-stat'});n.append(node('span',{},label),node('strong',{},value));grid.append(n);
  }
  body.append(grid,node('p',{class:'evidence-note'},`Source: ${d.source}. ${d.source==='jev'?`Choice confidence ${pct(d.confidence)}; not a win probability.`:d.reason||'Deterministic local selector; not JEV.'} Evaluated guesses: ${fmt(d.evaluatedCount,0)}.`));
  if(d.source==='fallback')body.append(node('p',{class:'warning tiny'},'A fallback was used. This match is not eligible for official standings.'));
}
function render(){
  const m=view.match,terminal=m&&isTerminal(m);drawBoard('human');drawBoard('jev');renderEditor('secret');renderEditor('guess');renderEvidence();
  $('setup').classList.toggle('hidden',!!m);$('matchStatus').classList.toggle('hidden',!m);
  $('guessComposer').classList.toggle('hidden',m?.phase!=='human_break');$('jevControls').classList.toggle('hidden',m?.phase!=='jev_break');
  $('resign').classList.toggle('hidden',!m||terminal);$('nextMatch').classList.toggle('hidden',!terminal);$('reviewMatch').classList.toggle('hidden',!terminal);
  $('resign').disabled=view.busy;$('stepJev').disabled=view.busy||view.driving;$('start').disabled=!view.session||view.busy||view.secret.some(n=>n==null);$('localStart').disabled=view.busy||view.secret.some(n=>n==null);
  const local=view.practice||m?.opponent?.startsWith('Local')||!view.session?.capabilities.jev;
  $('jev-title').textContent=local?'Local solver':'JEV';
  $('modeBadge').textContent=view.practice?'BROWSER PRACTICE / NOT JEV':local?'LOCAL OPPONENT / NOT JEV':m?.eligible?'RANKED / JEV':'JEV / PRACTICE';
  $('start').textContent=view.session?.capabilities.jev?'Start JEV match →':'Start local-server match →';
  if(m){
    $('phaseLabel').textContent=terminal?'MATCH COMPLETE':m.phase==='human_break'?'LEG 1 / BREAK THE CODE':'LEG 2 / DEFEND YOUR CODE';
    $('resultTitle').textContent=terminal?m.outcome==='win'?'You broke through.':m.outcome==='draw'?'A balanced match.':'The opponent takes it.':m.phase==='human_break'?'Your codebreaking turn':'The opponent is codebreaking';
    const human=m.legs.human.solvedAt??'unsolved',jev=m.legs.jev.solvedAt??'unsolved';
    $('resultSubtitle').textContent=terminal?`${m.finishReason==='normal'?`You: ${human}. Opponent: ${jev}.`:'Match forfeited.'} ${m.eligible&&m.verified?'Verified ranked result.':'Unranked result.'} Your target: ${codeLabel(m.reveal.targetForHuman)}. Your code: ${codeLabel(m.reveal.targetForJev)}.`:
      m.phase==='human_break'?`Four positions. Exact + near feedback. ${m.ranked?'Ranked.':'Practice.'} Your locked code: ${codeLabel(m.yourCode)}.`:`Your locked code: ${codeLabel(m.yourCode)}. No secret enters the opponent’s request.`;
  }
  updateRepeat();
}
async function bootstrap(){
  try {
    const launch=new URL(location.href).searchParams.get('launch');
    if(launch){sessionStorage.setItem('mm:launch',launch);history.replaceState(null,'',location.pathname);}
    view.session=await api('/me');
    $('identity').textContent=view.session.user?.display_name||'Guest session';
    $('login').classList.toggle('hidden',!!view.session.user);$('login').disabled=!view.session.capabilities.discord;
    $('logout').classList.toggle('hidden',!view.session.user);
    $('ranked').disabled=!(view.session.user&&view.session.capabilities.ranked);
    const ticket=sessionStorage.getItem('mm:launch');
    if(ticket&&view.session.user){try{const result=await api('/context/redeem',{method:'POST',body:{ticket}});view.session.context=result.context;notice('Discord channel and server context verified.');sessionStorage.removeItem('mm:launch');}catch(e){sessionStorage.removeItem('mm:launch');errorNotice(e);}}
    else notice(ticket?'Sign in with the Discord account that launched this game to verify channel context.':view.session.mode+'. '+(view.session.capabilities.discord?'':'Discord sign-in is not configured on this server.'));
    const currentId=storage.get('currentMatchId'),resume=view.session.activeMatches[0]?.id||currentId;
    if(resume)try{await loadMatch(resume);}catch{storage.set('currentMatchId',null);}
    render();
  }catch(error){notice('The server is unavailable. Browser practice works locally and never submits official scores.',true);render();}
  await autoStart();
}
/* Auto-start: the board is playable as soon as the page is, with no click.
   It returns early once any match is loaded, because bootstrap() has just
   rejoined an active match (or the last stored one) -- so a reload resumes
   rather than opening a second match beside it.
   The human's own code is required to start; view.secret is always a complete
   code (stored, or the [0,0,2,5] default), and the player can still change it
   and start again. Ranked follows the checkbox's own gate (signed in AND ranked
   capability). With no session at all this starts browser practice, which
   labels its opponent "not JEV". */
async function autoStart(){
  if(view.busy||view.match)return;
  if(!$('ranked').disabled)$('ranked').checked=true;
  await startMatch(!view.session);
}
async function startMatch(browserOnly=false){
  view.busy=true;render();
  try{
    view.report=null;view.analysisReplay=null;view.imported=false;view.guess=[null,null,null,null];view.selected.guess=0;
    const difficulty=$('difficulty').value;
    if(browserOnly){
      const id=crypto.randomUUID(),secrets={targetForHuman:randomCode(),targetForJev:[...view.secret],humanTargetSalt:randomToken(),jevTargetSalt:randomToken()};
      const state=createInitialState({matchId:id,difficulty,configId:'browser-practice-v1',commitments:await createCommitments(id,secrets)});
      view.practice={state,secrets,audit:[],timings:[],lastActionAt:Date.now()};setPracticeView();
      notice('Browser practice: local deterministic opponent, not JEV. The browser holds both codes; no result is ranked.');
    }else{
      view.practice=null;view.match=await api('/matches',{method:'POST',body:{game:'mastermind',difficulty,humanCode:[...view.secret],ranked:$('ranked').checked,requestId:crypto.randomUUID()}});
      storage.set('currentMatchId',view.match.matchId);notice(view.match.opponent+'. Codes are locked.');
    }
    view.editor='guess';
  }catch(error){errorNotice(error);}finally{view.busy=false;render();}
}
function setPracticeView(){
  const p=view.practice;view.match={...structuredClone(p.state),yourCode:[...p.secrets.targetForJev],opponent:'Local deterministic opponent — not JEV',ranked:false,eligible:false,verified:false,evidence:p.audit.at(-1),decisions:p.audit,timings:p.timings,
    ...(isTerminal(p.state)?{reveal:structuredClone(p.secrets)}:{})};
}
async function localAction(action){
  const p=view.practice;
  if(action.type==='STEP_JEV'){
    const start=performance.now(),built=buildCandidates(p.state.legs.jev.history,p.state.difficulty),choice=selectDeterministic(built,p.state.difficulty);
    const d={guessId:choice.guessId,source:'local',reason:'browser_practice',candidateCount:built.candidates.length,evaluatedCount:built.evaluatedCount,remainingCount:built.remainingCount,
      selectedFeatures:choice,latencyMs:performance.now()-start,attempts:0,usageComplete:true,decisionRef:randomToken(12)};
    p.audit.push(d);p.state=applyAction(p.state,{type:'GUESS',actor:'jev',guess:choice.guess,source:'local',decisionRef:d.decisionRef},p.secrets);
  }else{p.timings.push({actor:'human',elapsedMs:Date.now()-p.lastActionAt,action:action.type});p.lastActionAt=Date.now();p.state=applyAction(p.state,{...action,actor:'human'},p.secrets);}
  setPracticeView();
}
async function sendAction(action,retry=null){
  if(!view.match)return;
  view.busy=true;render();
  const body=retry||{requestId:crypto.randomUUID(),expectedRevision:view.match.revision,action};
  try{
    if(view.practice)await localAction(action);
    else{view.pendingRequest=body;view.match=await api(`/matches/${view.match.matchId}/actions`,{method:'POST',body});view.pendingRequest=null;}
    $('retryRequest').classList.add('hidden');
    if(action.type==='GUESS'){view.guess=[null,null,null,null];view.selected.guess=0;storage.set('draft:'+view.match.matchId,view.guess);}
    if(isTerminal(view.match))notice(`Match complete: ${view.match.outcome}. Full deduction analytics are now available.`);
  }catch(error){
    if(error.status===409&&!view.practice){view.match=await api('/matches/'+view.match.matchId);view.pendingRequest=null;notice('The authoritative state changed. The board has been refreshed.');}
    else{if(!error.status&&view.pendingRequest)$('retryRequest').classList.remove('hidden');throw error;}
  }finally{view.busy=false;render();}
}
async function driveOpponent(){
  if(view.driving||view.busy||view.match?.phase!=='jev_break')return;
  view.driving=true;render();
  try{
    const id=view.match.matchId;
    do{
      if(view.match.pending&&!view.practice){await delay(1200);view.match=await api('/matches/'+id);render();}
      if(view.match.phase!=='jev_break'||view.match.matchId!==id)break;
      await sendAction({type:'STEP_JEV'});await delay(400);
    }while($('autoJev').checked&&view.match?.phase==='jev_break');
  }catch(error){$('autoJev').checked=false;errorNotice(error);}finally{view.driving=false;render();}
}
async function submitGuess(){
  if(view.busy||view.match?.phase!=='human_break'||view.guess.some(n=>n==null))return;
  try{await sendAction({type:'GUESS',guess:[...view.guess]});if($('autoJev').checked)await driveOpponent();}catch(e){errorNotice(e);}
}
async function loadMatch(id){
  view.practice=null;view.match=await api('/matches/'+id);view.report=null;view.analysisReplay=null;view.imported=false;view.guess=storage.get('draft:'+id,[null,null,null,null]);
  if(!Array.isArray(view.guess)||view.guess.length!==4||!view.guess.every(x=>x===null||Number.isInteger(x)&&x>=0&&x<6))view.guess=[null,null,null,null];
  storage.set('currentMatchId',id);view.editor=view.match.phase==='human_break'?'guess':'secret';render();
}
let analyzer;
function analyzeReplay(replay,decisions=[],timings=[]){
  return new Promise((resolve,reject)=>{
    if(!analyzer)analyzer=new Worker('/mastermind/analytics-worker.js',{type:'module'});
    const id=crypto.randomUUID();
    const listener=event=>{if(event.data.id!==id)return;analyzer.removeEventListener('message',listener);event.data.error?reject(new Error(event.data.error)):resolve(event.data.report);};
    analyzer.addEventListener('message',listener);analyzer.postMessage({id,replay,decisions,timings});
  });
}
async function ensureAnalysis(){
  if(view.report){renderAnalysis();return;}
  if(!view.match||!isTerminal(view.match)){$('analysisEmpty').classList.remove('hidden');$('analysisContent').classList.add('hidden');return;}
  if(view.analysisJob)return view.analysisJob;
  $('analysisEmpty').textContent='Calculating exact counterfactual metrics for all 1,296 legal guesses at every turn…';$('analysisEmpty').classList.remove('hidden');$('analysisContent').classList.add('hidden');
  const matchId=view.match.matchId;
  view.analysisJob=(async()=>{
    const replay=view.practice?makeReplay(view.practice.state,view.practice.secrets):await api('/matches/'+matchId+'/replay');
    await verifyReplay(replay);
    const report=await analyzeReplay(replay,view.match.decisions||[],view.match.timings||[]);
    if(view.match.matchId!==matchId)return;view.report=report;view.analysisReplay=replay;renderAnalysis();
  })();
  try{await view.analysisJob;}finally{view.analysisJob=null;}
}
function entropyChart(report){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 500 210');svg.classList.add('chart');svg.setAttribute('role','img');svg.setAttribute('aria-label','Entropy in bits across guesses. Exact values are provided in the move table.');
  const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));if(text!==undefined)n.textContent=text;svg.append(n);return n;};
  const x=t=>36+t*43,y=bits=>180-bits/Math.log2(1296)*160;
  for(const tick of [0,2,4,6,8,10]){add('line',{x1:36,y1:y(tick),x2:468,y2:y(tick),class:'grid-line'});add('text',{x:12,y:y(tick)+3},String(tick));}
  for(let t=0;t<=10;t++)add('text',{x:x(t)-3,y:202},String(t));
  for(const actor of ['human','jev']){const points=[[0,Math.log2(1296)],...report[actor].rows.map(r=>[r.turn,r.posteriorEntropyBits])];add('polyline',{points:points.map(([a,b])=>`${x(a)},${y(b)}`).join(' '),class:actor==='human'?'human-line':'jev-line'});}
  $('entropyChart').replaceChildren(svg);
}
function renderAnalysis(){
  const r=view.report;if(!r)return;
  $('analysisEmpty').classList.add('hidden');$('analysisContent').classList.remove('hidden');
  $('analysisCoverage').textContent=(view.imported?'IMPORTED / UNRANKED · ':'')+'1,296 ALTERNATIVES / TURN';
  $('analysisStats').replaceChildren(stat('Your guesses',r.score.humanCost===11?'Unsolved / 11':fmt(r.score.humanCost,0),r.finishReason==='normal'?'Failure has cost 11':'Forfeit cost'),
    stat('Opponent guesses',r.score.jevCost===11?'Unsolved / 11':fmt(r.score.jevCost,0),'No invented opponent score for forfeits'),
    stat('Your information gained',fmt(r.human.summary.totalInformationBits)+' bits','Uniform-reference uncertainty reduction'),
    stat('Outcome',r.outcome[0].toUpperCase()+r.outcome.slice(1),r.difficulty+' · '+r.finishReason));
  entropyChart(r);
  $('qualitySummary').replaceChildren();for(const [label,h,j]of [
    ['Minimax-optimal moves',r.human.summary.minimaxOptimalMoves,r.jev.summary.minimaxOptimalMoves],
    ['Mean information regret (bits)',r.human.summary.meanInformationRegretBits,r.jev.summary.meanInformationRegretBits],
    ['Repeated guesses',r.human.summary.repeatedGuesses,r.jev.summary.repeatedGuesses],
    ['Information-only probes',r.human.summary.probes,r.jev.summary.probes],
    ['Moves eliminating no codes',r.human.summary.noEliminationGuesses,r.jev.summary.noEliminationGuesses]
  ]){const n=node('div',{class:'quality-line'});n.append(node('span',{},label),node('strong',{},`${fmt(h)} / ${fmt(j)}`));$('qualitySummary').append(n);}
  $('qualitySummary').prepend(node('p',{class:'tiny muted'},'You / opponent'));
  $('providerStats').replaceChildren(stat('Provider attempts',fmt(r.provider.jevCalls,0),'Retries included when observed'),stat('Fallback moves',fmt(r.provider.fallbackMoves,0),'Forced moves are counted separately'),
    stat('Decision latency p95',fmt(r.timing.jevDecisionLatencyMs.p95,0)+' ms','Includes local feature computation'),stat('Reported input tokens',fmt(r.provider.inputTokensReported,0),r.provider.usageIncomplete?'INCOMPLETE USAGE':'All observed calls accounted for'));
  table('decisionTable',[{label:'Move',render:d=>codeLabel(decodeGuess(d.guessId))},{label:'Source',key:'source'},{label:'Choices',key:'candidateCount'},{label:'Evaluated',key:'evaluatedCount'},
    {label:'Confidence',render:d=>pct(d.confidence)},{label:'Latency',render:d=>fmt(d.latencyMs,1)+' ms'},{label:'Attempts',render:d=>d.attempts??0},{label:'Errors',render:d=>(d.errors||[]).join(', ')||'—'}],r.decisions);
  $('decisionAudit').textContent=JSON.stringify(r.decisions,null,2);
  $('analysisDefinitions').replaceChildren(...[
    r.referenceDistribution,
    'Realized information = log2(candidates before / candidates after). Expected information is the entropy of possible feedback, weighted by the uniform reference. Surprise equals realized information under this reference.',
    'Expected remaining candidates = sum(bucket size squared) / candidate count. Worst bucket is the largest feedback bucket. Expected regret and worst-case regret are the selected value minus the best legal value; information regret is best legal information minus selected information.',
    'A probe cannot itself be the secret given the existing transcript; it may still be an efficient information-gathering move. Repeating a guess is legal but consumes an attempt. Correctly guessing a known code can add zero information while still winning.',
    'Timing uses server-observed intervals and can include time away from the page. Browser-practice timing is local and untrusted. Choice confidence is not calibrated solve probability. No behavioral or reaction-time conclusions are inferred.',
    `Configuration: ${r.configId}. Analytics version: ${r.analyticsVersion}. Code-pattern classes: your target ${r.codePatterns.targetForHuman}; opponent target ${r.codePatterns.targetForJev}.`
  ].map(text=>node('p',{},text)));
  renderMoves();
}
function renderMoves(){
  if(!view.report)return;const rows=view.report[$('analysisActor').value].rows;
  table('moveTable',[{label:'Turn',key:'turn'},{label:'Code',key:'code'},{label:'Exact / near',render:r=>r.exact+' / '+r.misplaced},
    {label:'Candidates',render:r=>fmt(r.candidatesBefore,0)+' → '+fmt(r.candidatesAfter,0)},{label:'Gained bits',render:r=>fmt(r.realizedInformationBits)},
    {label:'Expected bits',render:r=>fmt(r.expectedInformationBits)},{label:'Info regret',render:r=>fmt(r.informationRegretBits)},{label:'Worst bucket',key:'worstBucket'},
    {label:'Repeated',render:r=>r.repeated?'Yes':'No'}],rows,'This codebreaker did not make a move.');
  $('moveDetail').replaceChildren(...rows.map(r=>node('option',{value:r.turn-1},`Turn ${r.turn} · ${r.code}`)));renderMoveDetail();
}
function renderMoveDetail(){
  const r=view.report?.[$('analysisActor').value].rows[Number($('moveDetail').value)];$('moveFacts').replaceChildren();$('moveDistribution').textContent='';if(!r)return;
  const fields=[['Candidates before',r.candidatesBefore],['Candidates after',r.candidatesAfter],['Eliminated',r.eliminated],['Elimination rate',pct(r.eliminationRate)],
    ['Prior entropy (bits)',fmt(r.priorEntropyBits)],['Posterior entropy (bits)',fmt(r.posteriorEntropyBits)],['Expected remaining',fmt(r.expectedRemaining)],['Worst-case remaining',r.worstBucket],
    ['Expected regret',fmt(r.expectedRegret)],['Worst-case regret',fmt(r.worstCaseRegret)],['Information regret (bits)',fmt(r.informationRegretBits)],['Feedback possibilities',r.feedbackOutcomes],
    ['Observed feedback probability',pct(r.feedbackProbability)],['Reference solve probability',pct(r.uniformSolveProbability)],['Consistent possible secret',r.canBeSecret?'Yes':'No'],['Distinct symbols',r.distinctSymbols],
    ['New symbols tested',r.newSymbols],['Symbol coverage',r.symbolCoverage+' / 6'],['Repeated guess',r.repeated?'Yes':'No'],['Information-only probe',r.isProbe?'Yes':'No']];
  for(const [label,value]of fields){const box=node('div',{class:'fact'});box.append(node('span',{},label),node('strong',{},value));$('moveFacts').append(box);}
  $('moveDistribution').textContent=JSON.stringify({counterfactual:{bestExpectedCode:codeLabel(decodeGuess(r.bestExpectedGuessId)),bestExpectedRemaining:r.bestExpectedRemaining,
    bestWorstCaseCode:codeLabel(decodeGuess(r.bestWorstGuessId)),bestWorstBucket:r.bestWorstBucket,bestInformationCode:codeLabel(decodeGuess(r.bestInformationGuessId)),bestInformationBits:r.bestInformationBits},feedbackPartitions:r.feedbackBuckets},null,2);
}
async function loadRecord(append=false){
  if(!view.session){$('recordCoverage').textContent='Connect to the server to view retained account/session history. Browser-practice games are not sent to the server.';return;}
  const data=await api('/analytics/me'+(append&&view.recordCursor?'?before='+encodeURIComponent(view.recordCursor):''));
  view.record=data;view.recordRows=append?[...view.recordRows,...data.recent]:data.recent;view.recordCursor=data.nextCursor;
  $('recordCoverage').textContent=data.coverage;$('recordStats').replaceChildren(...[['Started',data.totals.started],['Completed',data.totals.completed],['Forfeits',data.totals.forfeits],['Ranked results',data.totals.ranked_results]].map(([k,v])=>stat(k,fmt(v,0))));
  table('recordGroups',[{label:'Config',render:r=>r.config_id},{label:'Difficulty',key:'difficulty'},{label:'Games',key:'games'},{label:'W / L / D',render:r=>`${r.wins} / ${r.losses} / ${r.draws}`},
    {label:'Match points',render:r=>pct(r.matchPointsPercentage)},{label:'Human solve rate',render:r=>pct(r.humanSolveRate)},{label:'Avg cost',render:r=>fmt(r.average_penalized_guesses)},
    {label:'Fallback moves',key:'fallback_moves'},{label:'Repeated guesses',key:'repeated_guesses'}],data.groups);
  table('recordStreaks',[{label:'Configuration',key:'configId'},{label:'Difficulty',key:'difficulty'},{label:'Current win streak',key:'currentWinStreak'},{label:'Best win streak',key:'bestWinStreak'}],data.streaks);
  table('recordHistory',[{label:'Created',render:r=>new Date(r.created_at).toLocaleString()},{label:'Difficulty',key:'difficulty'},{label:'Outcome',render:r=>r.outcome||r.phase},{label:'You / opponent',render:r=>`${r.human_cost??'—'} / ${r.jev_cost??'—'}`},
    {label:'Ranked',render:r=>r.eligible&&r.verified_at?'Yes':'No'},{label:'Open',render:r=>{const b=node('button',{},'Review');b.addEventListener('click',async()=>{try{await loadMatch(r.id);showPage(isTerminal(view.match)?'analysis':'play');}catch(e){errorNotice(e);}});return b;}}],view.recordRows);
  $('moreHistory').classList.toggle('hidden',!data.nextCursor);
}
async function loadLeaders(){
  const q=new URLSearchParams({scope:$('leaderScope').value,difficulty:$('leaderDifficulty').value});
  try{
    const data=await api('/leaderboards?'+q);$('leaderConfig').textContent=`${data.scope.toUpperCase()} · ${data.configId} · top ${data.limit}; provisional below ${data.minimumEstablishedGames} games`;
    table('leaderTable',[{label:'Rank',render:r=>r.established?r.rank:'Provisional'},{label:'Player',key:'display_name'},{label:'Match points',render:r=>pct(r.match_points_percentage)},
      {label:'W / L / D',render:r=>`${r.wins} / ${r.losses} / ${r.draws}`},{label:'Games',key:'games'},{label:'Forfeits',key:'forfeits'},{label:'Avg guess cost',render:r=>fmt(r.average_penalized_guesses)}],data.rows,'No eligible results for this scope and configuration.');
    const c=await api('/analytics/overview?'+q);table('communityStats',[{label:'Guess cost',key:'guesses'},{label:'Human games',key:'human'},{label:'Opponent games',key:'jev'}],c.histogram);
    $('communityCoverage').textContent=`${c.distributionCoverage.definition}; ${fmt(c.distributionCoverage.matches,0)} results in the distribution. ${c.notes}`;
  }catch(e){$('leaderTable').replaceChildren(node('p',{class:'muted'},e.message));$('communityStats').replaceChildren();$('communityCoverage').textContent='';throw e;}
}
async function loadBenchmarks(){
  try{const response=await fetch('/benchmark-summary.json',{cache:'no-store'});if(!response.ok)throw new Error('No packaged benchmark summary is available. Run npm run bench:exhaustive.');const data=await response.json();
    $('benchmarkCoverage').textContent=`Measured ${data.generatedAt}. ${data.coverage}. ${data.live?'Includes live provider calls.':'No live JEV calls were made. These are deterministic baselines and selector ablations.'}`;
    table('benchmarkTable',[{label:'Policy',key:'policy'},{label:'Secrets',key:'secrets'},{label:'Solved',render:r=>pct(r.solveRate)},{label:'Mean guesses',render:r=>fmt(r.meanCost,3)},
      {label:'Maximum cost',key:'maxCost'},{label:'p95 cost',render:r=>fmt(r.p95Cost,1)},{label:'Provider calls',key:'providerCalls'}],data.policies);
  }catch(e){$('benchmarkCoverage').textContent=e.message;}
}
// Native controls, no inline handlers, HTML injection, drag dependency, or third-party UI code.
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
$('difficulty').value=storage.get('difficulty','jev');if(!$('difficulty').value)$('difficulty').value='jev';
$('difficulty').addEventListener('change',()=>storage.set('difficulty',$('difficulty').value));
$('showEvidence').checked=storage.get('evidence',true);$('showEvidence').addEventListener('change',()=>{storage.set('evidence',$('showEvidence').checked);renderEvidence();});
$('randomSecret').addEventListener('click',()=>{view.secret=randomCode();storage.set('secret',view.secret);renderEditor('secret');});
$('start').addEventListener('click',()=>startMatch(false));$('localStart').addEventListener('click',()=>startMatch(true));
$('submitGuess').addEventListener('click',submitGuess);$('stepJev').addEventListener('click',driveOpponent);$('autoJev').addEventListener('change',()=>{if($('autoJev').checked)driveOpponent();});
$('nextMatch').addEventListener('click',()=>{view.match=null;view.practice=null;view.report=null;view.analysisReplay=null;storage.set('currentMatchId',null);render();});
$('resign').addEventListener('click',async()=>{if(!confirm('Resign this match? Ranked resignations count as a loss.'))return;try{await sendAction({type:'RESIGN'});}catch(e){errorNotice(e);}});
$('reviewMatch').addEventListener('click',()=>showPage('analysis'));
$('retryRequest').addEventListener('click',async()=>{if(!view.pendingRequest)return;try{await sendAction(view.pendingRequest.action,view.pendingRequest);if($('autoJev').checked)driveOpponent();}catch(e){errorNotice(e);}});
$('login').addEventListener('click',()=>{location.href='/api/auth/discord';});$('logout').addEventListener('click',async()=>{try{await api('/logout',{method:'POST'});storage.set('currentMatchId',null);location.reload();}catch(e){errorNotice(e);}});
$('analysisActor').addEventListener('change',renderMoves);$('moveDetail').addEventListener('change',renderMoveDetail);
$('exportAlternatives').addEventListener('click',async()=>{
  if(!view.analysisReplay||!analyzer)return;const button=$('exportAlternatives');button.disabled=true;
  try{const id=crypto.randomUUID();const csv=await new Promise((resolve,reject)=>{const listener=e=>{if(e.data.id!==id)return;analyzer.removeEventListener('message',listener);e.data.error?reject(new Error(e.data.error)):resolve(e.data.csv);};analyzer.addEventListener('message',listener);analyzer.postMessage({id,operation:'alternatives',replay:view.analysisReplay});});download('mastermind-all-alternatives.csv',csv,'text/csv;charset=utf-8');}
  catch(error){errorNotice(error);}finally{button.disabled=false;}
});
$('exportJson').addEventListener('click',()=>{if(view.report)download('mastermind-'+view.report.matchId+'-analytics.json',JSON.stringify(view.report,null,2));});
$('exportCsv').addEventListener('click',()=>{if(view.report)download('mastermind-'+view.report.matchId+'-moves.csv',csvText(['human','jev'].flatMap(actor=>view.report[actor].rows.map(r=>({actor,...r})))),'text/csv;charset=utf-8');});
$('exportDecisions').addEventListener('click',()=>{if(view.report)download('mastermind-'+view.report.matchId+'-decisions.csv',csvText(view.report.decisions),'text/csv;charset=utf-8');});
$('exportReplay').addEventListener('click',()=>{if(view.analysisReplay)download('mastermind-'+view.analysisReplay.matchId+'-replay.json',JSON.stringify(view.analysisReplay,null,2));});
$('importReplay').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>262144)throw new Error('Replay exceeds the 256 KiB import limit.');const replay=JSON.parse(await file.text());await verifyReplay(replay);
    const report=await analyzeReplay(replay);view.report=report;view.analysisReplay=replay;view.imported=true;renderAnalysis();$('replayVerification').textContent='Valid internal replay and salted commitments. Imported / unranked; server provenance has not been established.';
  }catch(e){$('replayVerification').textContent='Verification failed: '+e.message;}
});
$('refreshRecord').addEventListener('click',()=>loadRecord().catch(errorNotice));$('moreHistory').addEventListener('click',()=>loadRecord(true).catch(errorNotice));
$('refreshLeaders').addEventListener('click',()=>loadLeaders().catch(errorNotice));
$('exportRecord').addEventListener('click',async()=>{
  try{let data=await api('/analytics/me'),rows=[...data.recent],cursor=data.nextCursor;while(cursor){const page=await api('/analytics/me?before='+encodeURIComponent(cursor));rows.push(...page.recent);cursor=page.nextCursor;}
    download('mastermind-retained-record.json',JSON.stringify({...data,recent:rows,nextCursor:null,exportedAt:new Date().toISOString()},null,2));
  }catch(e){errorNotice(e);}
});
document.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName)||$('page-play').classList.contains('hidden'))return;
  const kind=view.match?.phase==='human_break'?'guess':!view.match?'secret':null;if(!kind||view.busy)return;
  const symbol=SYMBOLS.indexOf(event.key.toUpperCase());if(symbol>=0){event.preventDefault();fillSymbol(kind,symbol);}
  else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();view.selected[kind]=(view.selected[kind]+(event.key==='ArrowRight'?1:3))%4;renderEditor(kind);$(kind+'Slots').children[view.selected[kind]].focus();}
  else if(event.key==='Backspace'){event.preventDefault();const values=kind==='secret'?view.secret:view.guess;values[view.selected[kind]]=null;renderEditor(kind);}
  else if(event.key==='Enter'&&kind==='guess'&&event.target.tagName!=='BUTTON'){event.preventDefault();submitGuess();}
  else if(event.key==='Enter'&&kind==='guess'&&event.target.classList.contains('slot')){event.preventDefault();submitGuess();}
});
render();bootstrap();
