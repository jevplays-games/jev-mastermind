/** Display labels for match analytics and the record page. Pure (no DOM) so the tests import it directly.
 * Local practice is never presented as Jev: the stored difficulty key `jev` is a cohort label for the hardest tier,
 * not a statement about who played, so it is shown by its policy, and the opponent is read from the moves themselves
 * (AGENTS.md: never silently turn local, forced or fallback into jev). Stored keys and exports are unchanged. */
export const DIFFICULTY_LABELS=Object.freeze({easy:'Easy',normal:'Normal',hard:'Hard',jev:'Minimax-filtered'});
export const FINISH_LABELS=Object.freeze({normal:'Completed',resign:'Resigned',expire:'Expired'});
export const RESULT_LABELS=Object.freeze({win:'Win',loss:'Loss',draw:'Draw',human_break:'In progress, your leg',jev_break:'In progress, opponent leg',complete:'Complete',forfeit:'Forfeit',void:'Void'});
export const OPPONENT_LABELS=Object.freeze({local:'Local solver, not Jev',jev:'Jev',jevFallback:'Jev with fallback',fallback:'Fallback selector, not Jev'});
const lookup=(table,key)=>Object.hasOwn(table,key)?table[key]:'Unknown';
export const difficultyLabel=key=>lookup(DIFFICULTY_LABELS,key);
export const finishLabel=key=>lookup(FINISH_LABELS,key);
export const resultLabel=key=>lookup(RESULT_LABELS,key);
/** Who played leg two, from the replay's own opponent moves, so an imported file is labelled the same way as a live
 * match. `hint` is the live match's server label; it is used only when no opponent move was recorded (a match that
 * ended in leg one). Returns null when nothing identifies the opponent. */
export function opponentKind(replay,hint=null){
  const sources=new Set((replay?.actions??[]).filter(a=>a?.actor==='jev'&&a.type==='GUESS').map(a=>a.source));
  if(sources.has('local')||replay?.configId==='browser-practice-v1')return 'local';
  if(sources.has('jev'))return sources.has('fallback')?'jevFallback':'jev';
  if(sources.size)return 'fallback';
  if(typeof hint==='string'&&/^local/i.test(hint))return 'local';
  if(typeof hint==='string'&&/^jev/i.test(hint))return 'jev';
  return null;
}
export function opponentLabel(replay,hint=null){const kind=opponentKind(replay,hint);return kind?OPPONENT_LABELS[kind]:null;}
/** The analytics outcome card's note, for example "Local solver, not Jev · Minimax-filtered · Completed". */
export function outcomeNote(replay,hint=null){
  return [opponentLabel(replay,hint),difficultyLabel(replay?.difficulty),finishLabel(replay?.finishReason)].filter(Boolean).join(' · ');
}
