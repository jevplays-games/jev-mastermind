# Measured Mastermind benchmark

Generated 2026-09-22T05:32:54.358Z.

Every one of the 1,296 possible codes for every selected policy.

No live JEV calls. All opponent policies are local baselines/ablations.

## Results

| Policy | Secrets | Solved | Mean cost | Maximum cost |
|---|---:|---:|---:|---:|
| local-easy | 1296 | 1296 | 4.5648 | 7 |
| local-normal | 1296 | 1296 | 4.4167 | 6 |
| local-hard | 1296 | 1296 | 4.3974 | 6 |
| local-jev | 1296 | 1296 | 4.4583 | 5 |
| reference-minimax | 1296 | 1296 | 4.4583 | 5 |
| reference-expected | 1296 | 1296 | 4.3974 | 6 |
| random-consistent | 1296 | 1296 | 4.6458 | 7 |
| random-legal | 1296 | 1267 | 6.2647 | 11 |

- Local policies are deterministic selector ablations, not live JEV measurements.
- Exhaustive enumeration needs no sampling confidence interval for this finite configuration.
- Human-selected secret distributions can differ from uniform enumeration.
- Cached selector timings are not inference latency; cacheHit is exported per turn.
- Fallback-containing live games are identifiable and are not pure model-strength observations.
- Pairs compare codebreaking on matched secrets, not human codemaker skill.
