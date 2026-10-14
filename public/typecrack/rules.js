/** Pure, shared Mastermind rules. Never infer game state from DOM or accept client feedback. */
export const RULES_VERSION = 'mm-4x6-10-v1';
export const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard', 'jev']);
export const SYMBOLS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);
export const CODE_COUNT = 1296;
export const MAX_GUESSES = 10;
export function assertCode(code) {
  if (!Array.isArray(code) || code.length !== 4 || !code.every(n => Number.isInteger(n) && n >= 0 && n < 6)) {
    throw new Error('A code must contain exactly four integer symbols from 0 to 5.');
  }
  return code;
}
export function encodeGuess(code) { assertCode(code); return code.reduce((id, n) => id * 6 + n, 0); }
export function decodeGuess(id) {
  if (!Number.isInteger(id) || id < 0 || id >= CODE_COUNT) throw new Error('Invalid guess ID.');
  return [Math.floor(id / 216), Math.floor(id / 36) % 6, Math.floor(id / 6) % 6, id % 6];
}
export const actionId = id => { decodeGuess(id); return `g:${String(id).padStart(4, '0')}`; };
export function parseActionId(id) {
  if (typeof id !== 'string' || !/^g:\d{4}$/.test(id)) throw new Error('Invalid action ID.');
  const n = Number(id.slice(2)); decodeGuess(n); return n;
}
export function codeLabel(code) { return assertCode(code).map(n => SYMBOLS[n]).join(''); }
export function scoreGuess(secret, guess) {
  assertCode(secret); assertCode(guess);
  const s = [0,0,0,0,0,0], g = [0,0,0,0,0,0];
  let exact = 0, overlap = 0;
  for (let i = 0; i < 4; i++) { exact += Number(secret[i] === guess[i]); s[secret[i]]++; g[guess[i]]++; }
  for (let i = 0; i < 6; i++) overlap += Math.min(s[i], g[i]);
  return { exact, misplaced: overlap - exact };
}
export function createInitialState({ matchId, difficulty = 'normal', configId = 'practice-v1', commitments = {} } = {}) {
  if (typeof matchId !== 'string' || !matchId) throw new Error('A match ID is required.');
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('Invalid difficulty.');
  return {
    game: 'mastermind', rulesVersion: RULES_VERSION, matchId, difficulty, configId,
    revision: 0, phase: 'human_break', commitments: structuredClone(commitments),
    legs: { human: { history: [], status: 'active', solvedAt: null }, jev: { history: [], status: 'waiting', solvedAt: null } },
    actions: [], outcome: null, finishReason: null
  };
}
export const isTerminal = state => ['complete', 'forfeit', 'void'].includes(state.phase);
export const breakerCost = leg => leg.status === 'solved' ? leg.solvedAt : 11;
export function getScore(state) {
  return { humanCost: breakerCost(state.legs.human), jevCost: state.phase === 'forfeit' ? null : breakerCost(state.legs.jev) };
}
export function getOutcome(state) { return state.outcome; }
export function getLegalActions(state, actor) {
  if (isTerminal(state) || state.phase !== `${actor}_break`) return [];
  return Array.from({ length: CODE_COUNT }, (_, id) => actionId(id));
}
export function applyAction(state, action, secrets) {
  if (state.rulesVersion !== RULES_VERSION || isTerminal(state)) throw new Error('Match is terminal or rules version is unsupported.');
  const next = structuredClone(state);
  if (action.type === 'RESIGN' || action.type === 'EXPIRE') {
    if (action.actor !== 'human') throw new Error('Only the human can forfeit.');
    next.phase = 'forfeit'; next.outcome = 'loss'; next.finishReason = action.type.toLowerCase();
    next.actions.push({ type: action.type, actor: 'human' }); next.revision++;
    return next;
  }
  if (action.type !== 'GUESS' || !['human', 'jev'].includes(action.actor) || state.phase !== `${action.actor}_break`) {
    throw new Error('Action is not legal in the current phase.');
  }
  assertCode(action.guess);
  const target = action.actor === 'human' ? secrets.targetForHuman : secrets.targetForJev;
  const feedback = scoreGuess(target, action.guess);
  const leg = next.legs[action.actor], guessId = encodeGuess(action.guess);
  if (leg.history.length >= MAX_GUESSES) throw new Error('No guesses remain.');
  leg.history.push({ guessId, guess: [...action.guess], ...feedback });
  const savedAction = { type: 'GUESS', actor: action.actor, guessId };
  if (action.actor === 'jev') {
    if (!['jev', 'forced', 'fallback', 'local'].includes(action.source)) throw new Error('JEV decision source is required.');
    savedAction.source = action.source;
    if (action.decisionRef) savedAction.decisionRef = String(action.decisionRef);
  }
  next.actions.push(savedAction); next.revision++;
  if (feedback.exact === 4) { leg.status = 'solved'; leg.solvedAt = leg.history.length; }
  else if (leg.history.length === MAX_GUESSES) leg.status = 'failed';
  if (leg.status !== 'active') {
    if (action.actor === 'human') { next.phase = 'jev_break'; next.legs.jev.status = 'active'; }
    else {
      next.phase = 'complete'; next.finishReason = 'normal';
      const a = breakerCost(next.legs.human), b = breakerCost(next.legs.jev);
      next.outcome = a < b ? 'win' : a > b ? 'loss' : 'draw';
    }
  }
  return next;
}
/** Explicit allowlist: neither the human's leg, secret, result nor identity reaches JEV. */
export function getJevView(state) {
  return { game: 'mastermind', difficulty: state.difficulty, attemptNumber: state.legs.jev.history.length + 1,
    attemptsRemaining: MAX_GUESSES - state.legs.jev.history.length,
    history: state.legs.jev.history.map(({ guessId, guess, exact, misplaced }) => ({ guessId, guess: [...guess], exact, misplaced })) };
}
export function getPublicView(state, secrets) {
  const view = structuredClone(state);
  view.yourCode = [...secrets.targetForJev];
  if (isTerminal(state)) view.reveal = structuredClone(secrets);
  return view;
}
export function serialize(state) { return JSON.stringify(state); }
export function deserialize(text) {
  const state = JSON.parse(text);
  if (state?.game !== 'mastermind' || state.rulesVersion !== RULES_VERSION || !Array.isArray(state.actions)) throw new Error('Invalid state.');
  return state;
}
export function makeReplay(state, secrets) {
  if (!isTerminal(state)) throw new Error('Replays are revealed only after the match ends.');
  return { format: 'jev-replay-v1', game: 'mastermind', rulesVersion: RULES_VERSION,
    matchId: state.matchId, difficulty: state.difficulty, configId: state.configId,
    commitments: structuredClone(state.commitments), reveal: structuredClone(secrets),
    actions: structuredClone(state.actions), expectedOutcome: state.outcome, finishReason: state.finishReason };
}
/** Reconstructs only. A standalone replay is never proof of a ranked server result. */
export function reconstructReplay(replay) {
  if (replay?.format !== 'jev-replay-v1' || replay.game !== 'mastermind' || replay.rulesVersion !== RULES_VERSION ||
      !Array.isArray(replay.actions) || replay.actions.length > 21) throw new Error('Invalid replay format.');
  assertCode(replay.reveal?.targetForHuman); assertCode(replay.reveal?.targetForJev);
  let state = createInitialState(replay);
  for (const action of replay.actions) {
    state = applyAction(state, action.type === 'GUESS' ? { ...action, guess: decodeGuess(action.guessId) } : action, replay.reveal);
  }
  if (!isTerminal(state) || state.outcome !== replay.expectedOutcome || state.finishReason !== replay.finishReason) throw new Error('Replay result mismatch.');
  return state;
}
