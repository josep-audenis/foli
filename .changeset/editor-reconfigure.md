---
"@folijs/core": minor
"@folijs/react": minor
---

`editor.reconfigure({ plugins })` replaces an editor's plugins in place, keeping the document, the selection, undo history and the state of the plugins in both lists; open stories' editors and `editor.commands` follow. React's `plugins` prop now follows changes through it instead of warning (`extensions` are still read once). Starting or leaving a shared session no longer needs a new editor.
