---
"@folijs/core": minor
---

The `remote` transaction meta (22.6, ADR-0012): a transaction of steps another editor made, received as they are, is kept out of history and tracking (`tr.addToHistory` is false for it), the locked content controls' filter lets it through, and the comments, controls and notes plugins append nothing to it (the sender already sent what they appended). Ids new revisions, comments, notes, controls, list definitions and generated bookmarks take can be kept apart between editors of one document (22.5, by the collab plugin's client id); a single editor's are as before.
