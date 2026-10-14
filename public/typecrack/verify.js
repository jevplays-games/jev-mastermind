import { RULES_VERSION, reconstructReplay } from './rules.js';
export function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export async function sha256(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:canonical(value)));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export function randomToken(bytes=32) { return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join(''); }
export function randomCode() {
  const code=[];
  while(code.length<4) { const bytes=crypto.getRandomValues(new Uint8Array(8)); for(const b of bytes) if(b<252 && code.length<4) code.push(b%6); }
  return code;
}
export function commitSecret(matchId,role,code,salt) {
  return sha256(JSON.stringify(['jev-mastermind-commit-v1',matchId,role,RULES_VERSION,code,salt]));
}
export async function createCommitments(matchId,secrets) {
  return {targetForHuman:await commitSecret(matchId,'targetForHuman',secrets.targetForHuman,secrets.humanTargetSalt),
    targetForJev:await commitSecret(matchId,'targetForJev',secrets.targetForJev,secrets.jevTargetSalt)};
}
export async function verifyReplay(replay) {
  const state=reconstructReplay(replay),secrets=replay.reveal;
  if(!/^[a-f0-9]{64}$/.test(secrets.humanTargetSalt??'') || !/^[a-f0-9]{64}$/.test(secrets.jevTargetSalt??'')) throw new Error('Invalid commitment salt.');
  const expected=await createCommitments(state.matchId,secrets);
  if(canonical(expected)!==canonical(state.commitments)) throw new Error('Commitment mismatch.');
  return {state,valid:true,proves:'Internal replay and commitment consistency only; official eligibility is server-side.'};
}
