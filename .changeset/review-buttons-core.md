---
"@folijs/core": minor
---

`nextChange` / `previousChange` no longer stop for good at an inserted or deleted paragraph mark:
they go on to the change after it. New commands for Word's Review buttons: `acceptChangeAndNext`,
`rejectChangeAndNext` (resolve, then select the next change, in one undo step),
`nextChangeWrapping`, `previousChangeWrapping` (on from the first or last change past the end),
and the `revealSelection` meta they set.
