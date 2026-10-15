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
/** Commitment hash domain for new matches. */
export const COMMIT_LABEL='jev-typecrack-commit-v2';
/** Every match committed before the Typecrack rename (stored D1 rows, exported replays) was hashed under this label.
 * Verification must keep accepting it; removing it makes all of those replays fail. */
export const LEGACY_COMMIT_LABELS=Object.freeze(['jev-mastermind-commit-v1']);
export function commitSecret(matchId,role,code,salt,label=COMMIT_LABEL) {
  return sha256(JSON.stringify([label,matchId,role,RULES_VERSION,code,salt]));
}
export async function createCommitments(matchId,secrets,label=COMMIT_LABEL) {
  return {targetForHuman:await commitSecret(matchId,'targetForHuman',secrets.targetForHuman,secrets.humanTargetSalt,label),
    targetForJev:await commitSecret(matchId,'targetForJev',secrets.targetForJev,secrets.jevTargetSalt,label)};
}
export async function verifyReplay(replay) {
  const state=reconstructReplay(replay),secrets=replay.reveal;
  if(!/^[a-f0-9]{64}$/.test(secrets.humanTargetSalt??'') || !/^[a-f0-9]{64}$/.test(secrets.jevTargetSalt??'')) throw new Error('Invalid commitment salt.');
  let matched=false;
  for(const label of [COMMIT_LABEL,...LEGACY_COMMIT_LABELS]) if(canonical(await createCommitments(state.matchId,secrets,label))===canonical(state.commitments)){matched=true;break;}
  if(!matched) throw new Error('Commitment mismatch.');
  return {state,valid:true,proves:'Internal replay and commitment consistency only; official eligibility is server-side.'};
}
