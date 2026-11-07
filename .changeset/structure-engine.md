---
"@folijs/core": minor
---

Structure editing in the engine (for lists in schema v2): `ReplaceAroundStep`; `Transform.wrap`, `lift`, `split(pos, depth, typesAfter)` and `join(pos, depth)`; the checks `findWrapping`, `liftTarget`, `canSplit`, `canJoin` and `ResolvedPos.blockRange`; `NodeSelection`; the node spec `selectable` and the mark spec `inclusive` (a link does not grow when typing at its end). The node spec `atom` is declared for the view (task 7.3) and has no effect yet. Breaking: `Transform.split(pos, after)` is now `split(pos, depth, typesAfter)` (`split(pos, 1, [after])`); `StepMap.side` is replaced by `sides`.
