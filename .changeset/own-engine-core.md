---
"@folijs/core": patch
---

The replace algorithm, step maps, steps, structure checks, selections, transactions and history
helpers are rewritten as Foli's own code, with the same API and saved format. One edge case
changes: a structure step (split, join, wrap, lift) mapped onto a range that starts inside a text
node now fails instead of deleting the rest of that text.
