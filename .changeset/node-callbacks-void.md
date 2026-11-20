---
"@folijs/core": patch
---

`Node.descendants`, `Node.nodesBetween` and `Fragment.nodesBetween` take a callback that returns
nothing (`boolean | void`): TypeScript 5 refused one without a `return` (the decorations pattern
of the extensions guide), as the callback was typed `boolean | undefined`.
