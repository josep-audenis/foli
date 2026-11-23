---
"@folijs/core": minor
---

The collaboration client (22.7, ADR-0012): `collab({ version, clientID })`, a plugin for `createEditor`, with `sendableSteps(state)`, `receiveTransaction(state, steps, clientIDs)` and `getVersion(state)`. An authority (`@folijs/collab`) orders every step; each editor keeps its unconfirmed steps and rebases them over what it receives (mirrored maps), envelope changes merged entry by entry. Received steps are not undoable: undo takes back only the user's own changes, mapped over everyone else's. A property test runs 2 to 5 clients making random edits (text, marks, lists, styles, tables, comments, tracking, a header, notes, undo) with messages delayed and reordered: 1000 runs end with identical documents the schema accepts.
