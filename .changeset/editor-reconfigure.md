---
"@folijs/core": minor
"@folijs/react": minor
---

`editor.reconfigure({ plugins })` replaces an editor's plugins in place, keeping the document, the selection, undo history and the state of the plugins in both lists; open stories' editors and `editor.commands` follow. React's `plugins` prop now follows changes through it instead of warning (`extensions` are still read once). `useCommand(name)` no longer throws for a command the editor does not have: it is disabled until a plugin gives it (a plugin the parent adds in the same render), and a removed plugin's command goes with it. Starting or leaving a shared session no longer needs a new editor.
