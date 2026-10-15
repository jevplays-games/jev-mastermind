/** Regenerates legacy-mastermind-matches.json from the PRE-RENAME code, so the fixture is real stored data.
 *  git -C <clone> archive 931c7f6 | tar -x -C <dir>    then    node tests/fixtures/make-legacy-matches.mjs <dir> */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const old=resolve(process.argv[2]??'');const from=p=>import(pathToFileURL(resolve(old,p)).href);
const {harness,createBody,actionBody}=await from('tests/helpers.mjs'),{one,all}=await from('server/db.js');
const h=await harness();
const ok=r=>{if(r.status<200||r.status>299)throw new Error(JSON.stringify(r.data));return r.data;};
const post=async(m,action)=>ok(await h.request('/api/matches/'+m.matchId+'/actions',{method:'POST',body:actionBody(m.revision,action)}));
const create=async()=>ok(await h.request('/api/matches',{method:'POST',body:createBody()}));
// One match in the opponent leg (human solved at guess 2, opponent moved once), one in the human leg (two guesses).
let a=await create();const {targetForHuman}=JSON.parse((await one(h.db,'SELECT secrets_json FROM matches WHERE id=?',a.matchId)).secrets_json);
a=await post(a,{type:'GUESS',guess:[5,5,5,5]});a=await post(a,{type:'GUESS',guess:targetForHuman});a=await post(a,{type:'STEP_JEV'});
let b=await create();b=await post(b,{type:'GUESS',guess:[0,1,2,3]});b=await post(b,{type:'GUESS',guess:[4,4,5,5]});
const rows=await all(h.db,'SELECT * FROM matches ORDER BY created_at');h.close();
writeFileSync(new URL('./legacy-mastermind-matches.json',import.meta.url),JSON.stringify({
  generatedBy:'jev-mastermind 931c7f6 (pre-rename), tests/helpers.mjs harness, local deterministic opponent',
  note:'Real rows from the pre-rename server; owner_key/discord_user_id are replaced with the test session on insert.',rows},null,2)+'\n');
console.log(rows.map(r=>`${r.id} ${r.phase} ${JSON.parse(r.state_json).game}`).join('\n'));
