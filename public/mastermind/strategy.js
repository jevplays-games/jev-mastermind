/** Exact candidate partitions. Pure module; no hidden secret argument exists. */
import { CODE_COUNT, decodeGuess, actionId, encodeGuess, DIFFICULTIES } from './rules.js';
export const POLICY_VERSION = 'mm-policy-v1';
export const CODES = Object.freeze(Array.from({ length: CODE_COUNT }, (_, i) => Object.freeze(decodeGuess(i))));
export const ALL_IDS = Object.freeze(Array.from({ length: CODE_COUNT }, (_, i) => i));
const COUNTS = CODES.map(c => { const a = new Uint8Array(6); c.forEach(n => a[n]++); return a; });
let table, tableReference;
/** Lazy 1.60 MiB lookup, computed rather than downloaded. Feedback ID = exact*5+misplaced. */
export function feedbackTableReference() {
  if (tableReference) return tableReference;
  tableReference = new Uint8Array(CODE_COUNT * CODE_COUNT);
  for (let a = 0; a < CODE_COUNT; a++) {
    const x = CODES[a], cx = COUNTS[a];
    for (let b = a; b < CODE_COUNT; b++) {
      const y = CODES[b], cy = COUNTS[b];
      const exact = (x[0]===y[0]) + (x[1]===y[1]) + (x[2]===y[2]) + (x[3]===y[3]);
      let overlap = 0;
      for (let k=0; k<6; k++) overlap += Math.min(cx[k], cy[k]);
      tableReference[a*CODE_COUNT+b] = tableReference[b*CODE_COUNT+a] = exact*5 + overlap-exact;
    }
  }
  return tableReference;
}
export function feedbackTable() {
  if (table) return table;
  const t = new Uint8Array(CODE_COUNT * CODE_COUNT);
  // Flat digit and symbol-count arrays avoid per-pair array indirection and Math.min calls.
  const d = new Uint8Array(CODE_COUNT * 4), c = new Uint8Array(CODE_COUNT * 6);
  for (let i = 0; i < CODE_COUNT; i++) for (let k = 0; k < 4; k++) { const n = CODES[i][k]; d[i*4+k] = n; c[i*6+n]++; }
  for (let a = 0; a < CODE_COUNT; a++) {
    const a4 = a*4, a6 = a*6, x0 = d[a4], x1 = d[a4+1], x2 = d[a4+2], x3 = d[a4+3];
    const c0 = c[a6], c1 = c[a6+1], c2 = c[a6+2], c3 = c[a6+3], c4 = c[a6+4], c5 = c[a6+5];
    for (let b = a; b < CODE_COUNT; b++) {
      const b4 = b*4, b6 = b*6;
      const exact = (x0===d[b4]) + (x1===d[b4+1]) + (x2===d[b4+2]) + (x3===d[b4+3]);
      let y, overlap = 0;
      y = c[b6];   overlap += c0 < y ? c0 : y;
      y = c[b6+1]; overlap += c1 < y ? c1 : y;
      y = c[b6+2]; overlap += c2 < y ? c2 : y;
      y = c[b6+3]; overlap += c3 < y ? c3 : y;
      y = c[b6+4]; overlap += c4 < y ? c4 : y;
      y = c[b6+5]; overlap += c5 < y ? c5 : y;
      t[a*CODE_COUNT+b] = t[b*CODE_COUNT+a] = exact*5 + overlap-exact;
    }
  }
  return table = t;
}
export function consistentSecretsReference(history) {
  const lookup = feedbackTable();
  let ids = [...ALL_IDS];
  for (const h of history) {
    const guessId = h.guessId ?? encodeGuess(h.guess);
    if (!Number.isInteger(guessId) || guessId < 0 || guessId >= CODE_COUNT ||
      !Number.isInteger(h.exact) || !Number.isInteger(h.misplaced) || h.exact < 0 || h.misplaced < 0 ||
      h.exact + h.misplaced > 4 || (h.exact === 3 && h.misplaced === 1)) throw new Error('Invalid feedback history.');
    const offset = guessId * CODE_COUNT, wanted = h.exact*5 + h.misplaced;
    ids = ids.filter(id => lookup[offset+id] === wanted);
  }
  if (!ids.length) throw new Error('Feedback history is inconsistent.');
  return ids;
}
function validateFeedback(h) {
  const guessId = h.guessId ?? encodeGuess(h.guess);
  if (!Number.isInteger(guessId) || guessId < 0 || guessId >= CODE_COUNT ||
    !Number.isInteger(h.exact) || !Number.isInteger(h.misplaced) || h.exact < 0 || h.misplaced < 0 ||
    h.exact + h.misplaced > 4 || (h.exact === 3 && h.misplaced === 1)) throw new Error('Invalid feedback history.');
  return guessId;
}
/** Same result as consistentSecretsReference without copying and re-filtering the full ID list per entry. */
export function consistentSecrets(history) {
  const lookup = feedbackTable();
  let ids = null;
  for (const h of history) {
    const guessId = validateFeedback(h);
    const offset = guessId * CODE_COUNT, wanted = h.exact*5 + h.misplaced, out = [];
    if (ids === null) { for (let id = 0; id < CODE_COUNT; id++) if (lookup[offset+id] === wanted) out.push(id); }
    else for (let i = 0; i < ids.length; i++) { const id = ids[i]; if (lookup[offset+id] === wanted) out.push(id); }
    ids = out;
  }
  if (ids === null) ids = [...ALL_IDS];
  if (!ids.length) throw new Error('Feedback history is inconsistent.');
  return ids;
}
export function partitionMetrics(guessId, remaining, detail = false) {
  if (!remaining.length) throw new Error('Empty candidate space.');
  const buckets = new Uint16Array(25), lookup = feedbackTable(), offset = guessId * CODE_COUNT;
  for (const s of remaining) buckets[lookup[offset+s]]++;
  let worstBucket = 0, expectedNumerator = 0, entropy = 0, feedbackOutcomes = 0;
  for (const n of buckets) if (n) {
    worstBucket = Math.max(worstBucket, n); expectedNumerator += n*n; feedbackOutcomes++;
    if (detail) { const p=n/remaining.length; entropy -= p*Math.log2(p); }
  }
  const result = { worstBucket, expectedNumerator, expectedRemaining: expectedNumerator/remaining.length, feedbackOutcomes };
  if (detail) { result.expectedInformationBits=entropy; result.buckets=Array.from(buckets); }
  return result;
}
export function sampleEvenly(ids, cap) {
  if (ids.length <= cap) return [...ids];
  return Array.from({length:cap}, (_, i) => ids[Math.floor(i*(ids.length-1)/(cap-1))]);
}
const expectedSort = (a,b) => a.expectedNumerator-b.expectedNumerator || a.worstBucket-b.worstBucket || Number(b.canBeSecret)-Number(a.canBeSecret) || a.guessId-b.guessId;
const minimaxSort = (a,b) => a.worstBucket-b.worstBucket || expectedSort(a,b);
export function buildCandidatesReference(history, difficulty = 'normal') {
  if (!DIFFICULTIES.includes(difficulty) || history.length >= 10 || history.some(h => h.exact === 4)) throw new Error('Cannot generate candidates.');
  const remaining = consistentSecrets(history), possible = new Set(remaining);
  const used = new Set(history.map(h => h.guessId ?? encodeGuess(h.guess)));
  const usedSymbols = new Set(history.flatMap(h => h.guess ?? CODES[h.guessId]));
  let ids = history.length === 9 ? [...remaining] : difficulty==='easy' || difficulty==='normal'
    ? sampleEvenly(remaining, difficulty==='easy'?8:32) : ALL_IDS.filter(id => !used.has(id));
  ids = ids.filter(id => !used.has(id));
  let candidates = ids.map(guessId => ({
    guessId, actionId: actionId(guessId), guess: [...CODES[guessId]], canBeSecret: possible.has(guessId),
    distinctSymbols: new Set(CODES[guessId]).size,
    unusedSymbolCount: new Set(CODES[guessId].filter(n => !usedSymbols.has(n))).size,
    ...(difficulty==='easy' ? {} : partitionMetrics(guessId, remaining))
  }));
  const evaluatedCount = candidates.length;
  if (difficulty==='hard') candidates.sort(expectedSort);
  if (difficulty==='jev') {
    candidates.sort(minimaxSort);
    if (history.length < 9) candidates = candidates.filter(c => c.worstBucket === candidates[0].worstBucket);
  }
  const cap = {easy:8,normal:32,hard:64,jev:128}[difficulty];
  // Final-attempt candidates are all possible secrets; cap deterministically, never invent a probe.
  candidates = candidates.slice(0, cap);
  if (!candidates.length) throw new Error('No untried candidate.');
  if (difficulty !== 'easy') {
    const e = [...new Set(candidates.map(c => c.expectedNumerator))].sort((a,b)=>a-b);
    const w = [...new Set(candidates.map(c => c.worstBucket))].sort((a,b)=>a-b);
    candidates.forEach(c => { c.expectedRank = e.indexOf(c.expectedNumerator)+1; c.worstRank = w.indexOf(c.worstBucket)+1; });
  }
  return { remainingCount: remaining.length, evaluatedCount, candidates, policyVersion: POLICY_VERSION };
}
const DISTINCT = Uint8Array.from(CODES, c => new Set(c).size);
const SYMBOL_MASK = Uint8Array.from(CODES, c => c.reduce((m, n) => m | (1 << n), 0));
const POPCOUNT = Uint8Array.from({ length: 64 }, (_, m) => { let n = 0; for (let k = 0; k < 6; k++) n += (m >> k) & 1; return n; });
/** Output-identical to buildCandidatesReference; per-code constants are precomputed and no per-candidate Sets are built. */
export function buildCandidates(history, difficulty = 'normal') {
  if (!DIFFICULTIES.includes(difficulty) || history.length >= 10 || history.some(h => h.exact === 4)) throw new Error('Cannot generate candidates.');
  const remaining = consistentSecrets(history);
  const possible = new Uint8Array(CODE_COUNT), usedId = new Uint8Array(CODE_COUNT);
  for (let i = 0; i < remaining.length; i++) possible[remaining[i]] = 1;
  let usedMask = 0;
  for (const h of history) {
    const id = h.guessId ?? encodeGuess(h.guess);
    if (!Number.isInteger(id) || id < 0 || id >= CODE_COUNT) return buildCandidatesReference(history, difficulty);
    usedId[id] = 1;
    for (const n of (h.guess ?? CODES[h.guessId])) {
      if (!Number.isInteger(n) || n < 0 || n > 5) return buildCandidatesReference(history, difficulty);
      usedMask |= 1 << n;
    }
  }
  let ids = history.length === 9 ? remaining : difficulty==='easy' || difficulty==='normal'
    ? sampleEvenly(remaining, difficulty==='easy'?8:32) : ALL_IDS;
  ids = ids.filter(id => !usedId[id]);
  const withMetrics = difficulty !== 'easy';
  let candidates = ids.map(guessId => ({
    guessId, actionId: actionId(guessId), guess: [...CODES[guessId]], canBeSecret: possible[guessId] === 1,
    distinctSymbols: DISTINCT[guessId],
    unusedSymbolCount: POPCOUNT[SYMBOL_MASK[guessId] & ~usedMask & 63],
    ...(withMetrics ? partitionMetrics(guessId, remaining) : {})
  }));
  const evaluatedCount = candidates.length;
  if (difficulty==='hard') candidates.sort(expectedSort);
  if (difficulty==='jev') {
    candidates.sort(minimaxSort);
    if (history.length < 9) candidates = candidates.filter(c => c.worstBucket === candidates[0].worstBucket);
  }
  const cap = {easy:8,normal:32,hard:64,jev:128}[difficulty];
  candidates = candidates.slice(0, cap);
  if (!candidates.length) throw new Error('No untried candidate.');
  if (withMetrics) {
    const e = [...new Set(candidates.map(c => c.expectedNumerator))].sort((a,b)=>a-b);
    const w = [...new Set(candidates.map(c => c.worstBucket))].sort((a,b)=>a-b);
    candidates.forEach(c => { c.expectedRank = e.indexOf(c.expectedNumerator)+1; c.worstRank = w.indexOf(c.worstBucket)+1; });
  }
  return { remainingCount: remaining.length, evaluatedCount, candidates, policyVersion: POLICY_VERSION };
}
/** Clearly labeled baseline/ablation. This selector is not JEV. */
export function selectDeterministic(built, difficulty) {
  const choices = [...built.candidates];
  if (difficulty==='easy') choices.sort((a,b)=>b.unusedSymbolCount-a.unusedSymbolCount || b.distinctSymbols-a.distinctSymbols || a.guessId-b.guessId);
  else choices.sort(difficulty==='jev'?minimaxSort:expectedSort);
  return choices[0];
}
export function fallbackGuess(history) {
  const used = new Set(history.map(h=>h.guessId));
  return consistentSecrets(history).find(id=>!used.has(id));
}
export function referenceChoice(history, kind = 'minimax', rng = () => 0) {
  const remaining = consistentSecrets(history), used = new Set(history.map(h=>h.guessId));
  if (remaining.length===1) return remaining[0];
  if (kind==='random-consistent') return remaining[Math.floor(rng()*remaining.length)];
  const ids = ALL_IDS.filter(id=>!used.has(id));
  if (kind==='random-legal') return ids[Math.floor(rng()*ids.length)];
  if (kind==='minimax' && !history.length) return 7; // Fixed AABB reference opening.
  const possible = new Set(remaining);
  const values = (history.length===9?remaining:ids).map(guessId=>({guessId,canBeSecret:possible.has(guessId),...partitionMetrics(guessId,remaining)}));
  values.sort(kind==='expected'?expectedSort:minimaxSort); return values[0].guessId;
}
