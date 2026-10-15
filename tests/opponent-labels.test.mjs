/** Local practice is never presented as Jev: the analytics outcome card, the record tables, every label derived from
 * a match and every export name the opponent that actually played, and never print the raw `jev` difficulty or
 * `jev_break` phase key. The hardest difficulty tier is called Jev in the difficulty menus (stored key `jev`); it may
 * appear only as that difficulty ("Jev difficulty"), never as the opponent. */
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DIFFICULTIES,reconstructReplay} from '../public/typecrack/rules.js';
import {analyzeMatch,csvText} from '../public/typecrack/analytics.js';
import {getMatch} from '../server/db.js';
import {outcomeNote,opponentKind,opponentLabel,difficultyLabel,finishLabel,resultLabel,OPPONENT_LABELS} from '../public/labels.js';
import {harness,createBody,actionBody,fakeJev} from './helpers.mjs';
const legacyReplay=JSON.parse(readFileSync(new URL('./fixtures/legacy-mastermind-replay.json',import.meta.url),'utf8'));
// Names Jev as the opponent. Only a negation ("not Jev") or the difficulty tier ("Jev difficulty") may mention Jev on a local match.
const presentsJev=text=>/\bjev\b/.test(text)||/\bJev\b/.test(text.replace(/\bnot Jev\b/g,'').replace(/\bJev difficulty\b/g,''));
const moves=(...sources)=>sources.map(source=>({type:'GUESS',actor:'jev',guessId:7,source}));
const replay=(actions,extra={})=>({format:'jev-replay-v1',game:'typecrack',difficulty:'jev',configId:'mm-f93deb5ecdf108bf4d6fb8bd',finishReason:'normal',actions,...extra});
const menu=id=>Object.fromEntries([...readFileSync(new URL('../public/index.html',import.meta.url),'utf8').match(new RegExp(`<select id="${id}">(.*?)</select>`))[1]
  .matchAll(/<option value="(\w+)"[^>]*>([^<]*)<\/option>/g)].map(([,value,text])=>[value,text]));

test('a local-opponent match at the jev difficulty is labelled as a local solver, never as Jev',()=>{
  const note=outcomeNote(replay(moves('local','local','local')));
  assert.equal(note,'Local solver, not Jev · Jev difficulty · Completed');
  assert.equal(presentsJev(note),false,note);
  assert.notEqual(note,'jev · normal');
});
test('browser practice is local even when it ended before the opponent moved',()=>{
  const note=outcomeNote(replay([],{configId:'browser-practice-v1',finishReason:'resign'}));
  assert.equal(note,'Local solver, not Jev · Jev difficulty · Resigned');assert.equal(presentsJev(note),false,note);
});
test('Jev is named only when Jev made a move; forced and fallback moves alone are not Jev',()=>{
  assert.equal(outcomeNote(replay(moves('jev','jev','forced'))),'Jev · Jev difficulty · Completed');
  assert.equal(outcomeNote(replay(moves('jev','fallback'))),'Jev with fallback · Jev difficulty · Completed');
  assert.equal(opponentKind(replay(moves('fallback','forced'))),'fallback');
  assert.equal(presentsJev(outcomeNote(replay(moves('fallback','forced')))),false);
  assert.equal(opponentKind(replay(moves('jev','local'))),'local');// any local move: never Jev
});
test('with no opponent move the live match label decides; an unidentified opponent is left out',()=>{
  const leg1=replay([],{finishReason:'resign',difficulty:'normal'});
  assert.equal(outcomeNote(leg1,'Local deterministic opponent — not Jev'),'Local solver, not Jev · Normal difficulty · Resigned');
  assert.equal(outcomeNote(leg1,'Jev + deterministic analysis'),'Jev · Normal difficulty · Resigned');
  assert.equal(outcomeNote(leg1),'Normal difficulty · Resigned');
  assert.equal(opponentLabel(leg1),null);
});
test('an imported pre-rename replay (local opponent) is labelled from its own moves',()=>{
  const note=outcomeNote(legacyReplay);
  assert.equal(note,'Local solver, not Jev · Normal difficulty · Completed');assert.equal(presentsJev(note),false,note);
});
test('difficulty labels are the difficulty menus\' tier names; no finish or result label prints a raw key or names Jev',()=>{
  const leaderboard=menu('leaderDifficulty'),setup=menu('difficulty');
  for(const d of DIFFICULTIES){
    assert.notEqual(difficultyLabel(d),'Unknown',d);assert.notEqual(difficultyLabel(d),d,d);// never the raw key
    assert.equal(difficultyLabel(d),leaderboard[d],d);assert.ok(setup[d].startsWith(difficultyLabel(d)+' · '),setup[d]);
  }
  for(const f of ['normal','resign','expire'])assert.notEqual(finishLabel(f),'Unknown',f);
  for(const r of ['win','loss','draw','human_break','jev_break','complete','forfeit','void']){assert.notEqual(resultLabel(r),'Unknown',r);assert.equal(/jev|_/i.test(resultLabel(r)),false,r);}
  assert.equal(difficultyLabel('__proto__'),'Unknown');
  for(const [kind,label] of Object.entries(OPPONENT_LABELS))if(kind==='local'||kind==='fallback')assert.equal(presentsJev(label),false,label);
});
async function finish(h,{resign=false}={}){
  let r=await h.request('/api/matches',{method:'POST',body:createBody({difficulty:'jev'})});assert.equal(r.status,201,JSON.stringify(r.data));let m=r.data;
  const act=async action=>{const x=await h.request('/api/matches/'+m.matchId+'/actions',{method:'POST',body:actionBody(m.revision,action)});assert.equal(x.status,200,JSON.stringify(x.data));m=x.data;};
  if(resign)await act({type:'RESIGN'});
  else{await act({type:'GUESS',guess:(await getMatch(h.db,m.matchId)).secrets.targetForHuman});while(m.phase==='jev_break')await act({type:'STEP_JEV'});}
  const replayResponse=await h.request('/api/matches/'+m.matchId+'/replay');assert.equal(replayResponse.status,200);
  return {match:m,replay:replayResponse.data};
}
test('server matches: the local opponent, real Jev and a provider fallback are each labelled by who played',async()=>{
  const local=await harness();try{
    const {match,replay:rp}=await finish(local);assert.match(match.opponent,/not Jev/);
    const note=outcomeNote(rp,match.opponent);assert.equal(note,'Local solver, not Jev · Jev difficulty · Completed');assert.equal(presentsJev(note),false,note);
    const resigned=await finish(local,{resign:true});
    assert.equal(outcomeNote(resigned.replay,resigned.match.opponent),'Local solver, not Jev · Jev difficulty · Resigned');
  }finally{local.close();}
  const jev=await harness({production:true,provider:fakeJev()});try{
    await jev.signIn();const {match,replay:rp}=await finish(jev);assert.equal(opponentKind(rp,match.opponent),'jev');
    assert.equal(outcomeNote(rp,match.opponent),'Jev · Jev difficulty · Completed');
  }finally{jev.close();}
  const failing=await harness({production:true,provider:fakeJev({failure:429})});try{
    await failing.signIn();const {match,replay:rp}=await finish(failing);
    assert.ok(rp.actions.filter(a=>a.actor==='jev').every(a=>a.source!=='jev'));
    assert.equal(opponentKind(rp,match.opponent),'fallback');assert.equal(presentsJev(outcomeNote(rp,match.opponent)),false);
  }finally{failing.close();}
});
/** Every string value in an export that mentions jev, with its key. Keys are schema names (`jev`, `jevCost`, ...), not labels. */
function jevValues(value,key='',out=[]){
  if(typeof value==='string'){if(/jev/i.test(value))out.push(`${key}=${value}`);}
  else if(Array.isArray(value))value.forEach(v=>jevValues(v,key,out));
  else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))jevValues(v,k,out);
  return out;
}
// The only string values allowed to say jev: the stored tier key (difficulty), the opponent-leg data key (actor) and the
// stored replay format id. None of them is a label.
const allowedJevValues=new Set(['difficulty=jev','actor=jev','format=jev-replay-v1']);
const assertNeverJev=(name,data)=>assert.deepEqual(jevValues(data).filter(v=>!allowedJevValues.has(v)),[],name);
test('every export of a local-opponent match presents the local solver, never Jev',async()=>{
  const h=await harness();try{
    const {match,replay:rp}=await finish(h);const id=match.matchId;
    const full=(await h.request('/api/matches/'+id)).data,serverReport=(await h.request('/api/matches/'+id+'/analytics')).data;
    const serverCsv=(await h.request('/api/matches/'+id+'/analytics?format=csv',{raw:true})).data,record=(await h.request('/api/analytics/me')).data;
    // The browser's exports (public/game.js): the full JSON report, the moves and decisions CSVs and the replay.
    const report=analyzeMatch(reconstructReplay(rp),rp.reveal,{decisions:full.decisions,timings:full.timings,exhaustive:true});
    const moveRows=['human','jev'].flatMap(actor=>report[actor].rows.map(r=>({actor,...r})));
    for(const [name,data] of [['replay',rp],['analytics JSON',report],['moves CSV rows',moveRows],['decisions CSV rows',report.decisions],['server analytics',serverReport],['retained record',record]])assertNeverJev(name,data);
    assert.ok(rp.actions.filter(a=>a.actor==='jev').length>0);assert.ok(rp.actions.filter(a=>a.actor==='jev').every(a=>a.source==='local'));
    for(const r of [report,serverReport]){
      assert.ok(r.decisions.length>0);assert.ok(r.decisions.every(d=>d.source==='local'&&d.modelVersion==='local-deterministic-v1'&&d.reason==='provider_not_configured'));
      assert.equal(r.provider.jevCalls,0);assert.equal(r.provider.localMoves,r.decisions.length);
    }
    assert.equal(outcomeNote(rp,match.opponent),'Local solver, not Jev · Jev difficulty · Completed');
    // CSV text: the opponent leg's actor key is the only jev, in the first column.
    for(const text of [csvText(moveRows),csvText(report.decisions),serverCsv])assert.equal(/jev/i.test(text.replace(/^"jev",/gm,'')),false,text.slice(0,200));
  }finally{h.close();}
});
test('the interface builds the outcome card and record tables from these labels',()=>{
  const ui=readFileSync(new URL('../public/game.js',import.meta.url),'utf8');
  assert.match(ui,/import \{ outcomeNote,difficultyLabel,resultLabel \} from '\.\/labels\.js';/);
  assert.match(ui,/stat\('Outcome',resultLabel\(r\.outcome\),outcomeNote\(/);
  assert.equal(ui.includes("r.difficulty+' · '+r.finishReason"),false);
  assert.equal(ui.includes("key:'difficulty'"),false);
  assert.equal(ui.includes('r.outcome||r.phase},'),false);
  // The exports in the test above are built exactly as the interface builds them.
  assert.ok(ui.includes("csvText(['human','jev'].flatMap(actor=>view.report[actor].rows.map(r=>({actor,...r}))))"));
  assert.ok(ui.includes('csvText(view.report.decisions)'));
});
