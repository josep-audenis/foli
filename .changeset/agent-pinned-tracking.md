---
"@folijs/agent": patch
---

A session tracks its edits whatever the document's own tracking switch says (`settings.trackRevisions`, new in `@folijs/core` 1.6), without changing that setting: a document saved with tracking off still gets the agent's edits as tracked changes, and is saved with tracking off. Works with `@folijs/core` 1.6 (a style or list the session adds is now undone with its edit, as in the editor).
