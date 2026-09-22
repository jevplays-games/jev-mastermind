# Exhaustive analytics specification

Version: `mm-analytics-v1`. Implementation: `public/mastermind/analytics.js`; browser calculation in `analytics-worker.js`; authoritative summaries in `server/matches.js`; retained aggregate queries in `server/analytics.js`.

## 1. Collection boundaries

| Layer | Source of truth | Availability |
|---|---|---|
| Feedback and accepted actions | Authoritative rules reducer | As the game progresses |
| JEV evidence | Accepted server decision audit, allowlisted JEV history | During the opponent's leg; full audit after completion |
| Human deduction/counterfactual metrics | Reconstructed completed transcript | After termination only |
| Ranked eligibility/outcome | Server verification, not browser analytics | On finalization |
| Browser-practice analysis | Explicitly untrusted local state | Never contributes official scores |
| Account metrics | Retained matches for current account/session | Authenticated session endpoint |
| Community metrics | Verified ranked records in requested cohort | World public; verified fresh context for Server/Channel |
| Operational metrics | Redacted event records and bounded audit sample | Operator bearer token only |

The human's target code and salts are withheld until the match terminates. The human's chosen code is visible to its owner but **never** to JEV. No JEV request includes the human's guesses or the human's score. Candidate calculations depend only on the codebreaker's own previous feedback.

The API's match-analytics endpoint intentionally calculates selected-guess metrics only and returns `comparison: selected_guess_only`. All-alternative comparisons happen in the browser Web Worker, or in the offline benchmark, so a large browser report does not consume trusted edge CPU or influence ranking. That report returns `comparison: all_1296_legal_guesses_per_turn`. Missing counterfactual fields in the cheaper API report are `null`, not zero.

## 2. Mathematical definitions

Let S be the codes consistent with all prior feedback to the current codebreaker. Initially |S| = 6^4 = 1,296 and H(S) = log2(1,296), approximately 10.33985 bits.

For a proposed guess g, partition S by the feedback response r. Let n_r be each nonempty bucket's size and p_r = n_r / |S|.

```
worstBucket(g)       = max_r n_r
expectedRemaining(g)= sum_r(n_r * n_r) / |S|
expectedBits(g)     = -sum_r(p_r * log2(p_r))
realizedBits        = log2(|S_before| / |S_after|)
feedbackProbability = |S_after| / |S_before|
referenceSolveProb  = 1 / |S_before| if g is in S, otherwise 0
```

These probabilities assume a **uniform reference distribution over consistent codes**. They are not JEV's subjective probabilities, an estimate of human code selection, or empirical human success rates. Identical feedback history yields identical calculated metrics, independent of the actual unrevealed code.

Entropy is uncertainty about the secret. A final forced guess can gain zero new bits while still being necessary to win. Similarly, worst-case, expected-remaining, and maximum-information objectives can favor different guesses. None is automatically a proof of minimum total guesses over the entire future decision tree.

“Regret” is a descriptive one-step gap, not a psychological judgment:

```
expectedRegret       = selected expectedRemaining - min over all legal guesses
worstCaseRegret      = selected worstBucket - min over all legal guesses
informationRegret   = max expectedBits over all legal guesses - selected expectedBits
```

Floating-point gaps are clamped below at zero. Expected-optimal summary counting uses a 1e-9 tolerance; integer worst-case ties are exact. The comparator pool includes all 1,296 legal guesses, including information-only probes and repeats. A difficulty-policy shortlist is not the comparator universe.

## 3. Played-move dictionary

Each row belongs to one actor and turn. CSV exports add `actor`; nested JSON groups rows under `human` and `jev`.

| Fields | Meaning / units |
|---|---|
| `turn`, `guessId`, `code` | One-based attempt; stable base-six ID; A–F display string |
| `exact`, `misplaced` | Authoritative duplicate-safe feedback counts |
| `candidatesBefore`, `candidatesAfter` | Consistent codes before/after this feedback |
| `eliminated`, `eliminationRate` | Removed codes, and removed/before |
| `priorEntropyBits`, `posteriorEntropyBits` | log2 of the respective candidate counts |
| `realizedInformationBits` | Actual uncertainty reduction after observed feedback |
| `expectedInformationBits` | Entropy of all possible feedback for the selected guess |
| `expectedRemaining`, `worstBucket` | Mean and maximum remaining candidates under the reference |
| `feedbackOutcomes` | Number of nonempty feedback buckets |
| `feedbackProbability`, `surpriseBits` | Observed bucket's reference probability and -log2 thereof |
| `uniformSolveProbability` | Uniform-reference chance of exact solution on this guess |
| `canBeSecret`, `isProbe` | Consistent guess versus a legal information-only probe |
| `repeated` | Same guess already submitted; legal but uses another attempt |
| `distinctSymbols`, `newSymbols`, `symbolCoverage` | Unique symbols in guess, newly tested symbols, cumulative symbols |
| `bestExpectedRemaining`, `bestExpectedGuessId` | Best expected remaining count and a deterministic representative |
| `bestWorstBucket`, `bestWorstGuessId` | Best minimax bucket and representative |
| `bestInformationBits`, `bestInformationGuessId` | Greatest information and representative |
| `expectedRegret`, `worstCaseRegret`, `informationRegretBits` | Exact one-step counterfactual gaps |
| `feedbackBuckets` | All nonempty `{exact, misplaced, count}` outcomes for this guess |

The machine-readable inventory is generated from a real packaged sample report and supplements this dictionary with observed data types. It is an inventory, not a restrictive API validator; empty lists cannot establish all possible nested provider keys.

## 4. All-alternative export

**Export all alternatives CSV** produces `1,296 × total played guesses` rows across both legs. Every row contains actor, turn, alternative ID/code, whether it was selected, whether it could be the secret, current candidate count, reference solve probability, expected remaining candidates, worst bucket, expected information, feedback-outcome count, and the entire nonempty feedback partition.

This permits independent recomputation of rankings, regret, top alternatives, final-attempt tradeoffs, and strategy comparisons without rerunning the provider. It does not include a speculative free-form rationale. There are zero rows for unplayed turns; forfeit statistics do not invent moves.

The usual played-move CSV is smaller and contains one row per actual guess. Nested partitions in CSV are quoted JSON strings. String cells beginning with spreadsheet formula triggers are prefixed with an apostrophe. Actual finite negative numeric values remain numeric, including paired benchmark cost differences.

## 5. Per-leg and match summaries

Leg summaries include guesses, solved status, final candidates and entropy, total information, repeats, probes, moves eliminating zero candidates, average expected bits, average information and expected-remaining regret, counts of minimax/expected-optimal guesses, and cumulative symbol coverage.

A no-elimination guess excludes an exact winning guess: claiming the known solution is not labeled an information-gathering mistake. Unplayed legs have zero guesses, full initial uncertainty, and null means. No fake JEV result is created on forfeit.

Code-pattern labels classify multiplicities: `4`, `3+1`, `2+2`, `2+1+1`, `1+1+1+1`. Pattern breakdowns in the benchmark distinguish repeated-color structure from ordinary color identity.

The match envelope records analytics/rules/config versions, difficulty, phase, result, finish reason, match ID, reference-distribution description, code patterns, score costs, decision audits, timing distributions, and provider totals. Replay files reveal salts and secrets only after termination.

## 6. JEV audit and reliability

Each decision audit records the selected ID, source, reason when applicable, candidate IDs, offered count, evaluated count, consistent-secret count, selected features, request byte length, request hash, exact model/prompt/policy versions, local decision reference, decision wall time, actual observed HTTP attempts, invalid-response count, error reason codes, confidence, selected probability, probability map, and observed token usage.

Sources must not be conflated:

| Source | Interpretation | Ranked effect |
|---|---|---|
| `jev` | A validated actual provider response | Allowed with all other eligibility checks |
| `forced` | Only one policy action or one possible solution; no inference required | Allowed |
| `fallback` | Provider failure, unavailable configuration/quota, or expired lease | Entire match excluded |
| `local` | Explicit deterministic practice selector | Entire match excluded |

`attempts` includes observed retries. An expired prior lease may record `unobservedReservedAttempts`: calls reserved by a crashed process cannot honestly be classified as completed, unused, free, or billed. Such a record marks usage incomplete; observed attempts remain the known lower bound. Provider errors without reported usage are not silently converted into a complete zero-cost observation.

`inputTokensReported` and `outputTokensReported` sum only available provider usage. No dollar estimate is embedded: pricing can change and absent usage is not zero actual billing. Reconcile against the provider's invoice for accounting. Provider confidence measures the answer distribution, **not** the probability of solving or winning. Calibration against outcomes would need a justified target and observational dataset; this project does not invent a calibration statistic.

## 7. Time metrics

`serverObservedHumanIntervalsMs` measures intervals between accepted human actions as observed by the server. It includes thinking, browser pauses, network time, and revisits; it is not purified reaction time and does not alter scores. Only actual human guesses enter this distribution, not resignation events.

`jevDecisionLatencyMs` includes local candidate preparation and provider/retry handling for accepted decisions; local and forced decisions remain visible by source. Benchmark `selectorWallMs` is a local wall-time measurement with `cacheHit`; cached values must not be described as fresh inference latency. Provider latency is reported separately in live benchmark rows.

Distribution objects contain finite-observation count, mean, min, max, p50/p90/p95/p99, and sample standard deviation. Quantiles linearly interpolate sorted observations at `(n-1)*p`. Empty distributions use null; sample deviation is null for fewer than two observations. Missing provider confidence is excluded rather than treated as zero.

## 8. Player record and cohorts

Record totals include started, active, completed, forfeited, voided, verified, and ranked results. Per-configuration/per-difficulty groups include games, W/L/D, forfeits, normal completions, human solves, average penalized guesses, repeats, mean expected information, fallbacks, known tokens, missing-usage match count, and provider attempts.

`humanSolveRate = solves / normal_completions`. Forfeits are reported separately and incur a cost of 11 in penalized averages. `winRate = wins / all terminal games in the group`; `matchPointsPercentage = (wins + 0.5*draws) / group games`. Win-streak counters use only eligible verified ranked outcomes in each cohort; a loss or draw breaks the streak.

History uses a 100-record keyset page plus a `nextCursor`, and the interface's record export follows every page. Daily activity covers the latest 90 days, grouped by UTC day, configuration, and difficulty. Retained totals are not mislabeled all-time immutable totals: guest records are purged after 30 days and operator retention can remove signed-in history.

Wilson 95% intervals for observed win proportions are explicitly descriptive. Repeated games from one person are not necessarily independent draws. The exhaustive finite-space baseline does not use a sampling interval for coverage of its complete enumerated configuration.

## 9. Community and leaderboard analytics

World, Server, and Channel each use one immutable opponent configuration and difficulty. Guild/channel attribution is snapshotted at match start from a verified launch, not inferred from arbitrary URL parameters. A direct site match contributes to World only.

The leader metric is match points percentage. Tie-breaks: fewer average penalized human guesses, then more matches. Equal substantive metrics share a `DENSE_RANK`; account ID supplies stable display order without breaking that shared rank. Fewer than 10 ranked matches is provisional and receives no established rank. Queries return the top 50.

Community totals count all retained eligible records in the cohort. Detailed distributions use at most the latest 5,000 and explicitly return coverage and a partial flag. Cost 11 is failure/forfeit; absent JEV cost on forfeit is excluded from that distribution, not fabricated as 11.

## 10. Operations, privacy, and retention

Allowlisted events record match start/action/decision/completion, verification, exports, launch/context/auth flow outcomes, and rejected requests. Secrets, salts, raw request bodies, OAuth tokens, raw IP addresses, email, and display names are excluded from event metadata. The operational endpoint requires a separate administrator bearer secret, never exposed in the browser.

Events are retained for 30 days and written best-effort. Official result totals query authoritative matches, not event counts. The admin report's audit sample is bounded to 20,000 decisions and labels truncation. API abuse counters use daily salted IP-derived buckets rather than raw IP storage and persist atomically across Worker isolates.

No third-party analytics SDK, pixel, advertising identifier, session recording, or hidden chain-of-thought collector is present. Raw completed replays expose their two selected codes by design and should be shared deliberately. Signed-in retention and deletion policy must be published by the operator before public release.
