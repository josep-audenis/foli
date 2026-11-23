---
"@folijs/core": minor
"@folijs/view": minor
---

Presence (22.9): `presenceMessage`, `receivePresence`, `removePresence` and `presence(state)` in `@folijs/core` carry who else edits the document, in what colour and where (their selection mapped through every change, nothing in the document or its undo); `EditorView` marks their selections with the CSS Custom Highlight API and draws their caret and name over the page. Body only for now.
