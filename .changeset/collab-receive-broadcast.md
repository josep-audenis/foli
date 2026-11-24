---
"@folijs/core": minor
---

`receiveBroadcast(state, broadcast)` takes a collaboration broadcast as received and checks it against the editor's version: it applies the part the editor lacks, says `had` for a duplicate and `gap` for one from later, instead of applying it at the wrong version. `receiveTransaction` takes the broadcast's version as an optional fourth argument and throws a `RangeError` naming both versions when it does not fit.
