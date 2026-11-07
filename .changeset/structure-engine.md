---

## "@folijs/core": minor

Structure editing in the engine (for lists in schema v2): `ReplaceAroundStep`; `Transform.wrap`, `lift`, `split(pos, depth, typesAfter)` and `join(pos, depth)`; the checks `findWrapping`, `liftTarget`, `canSplit`, `canJoin` and `ResolvedPos.blockRange`; `NodeSelection`; node specs `atom` and `selectable`; mark spec `inclusive`. Breaking: `Transform.split(pos, after)` is now `split(pos, depth, typesAfter)` (`split(pos, 1, [after])`); `StepMap.side` is replaced by `sides`.
