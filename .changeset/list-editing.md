---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/react": minor
---

List editing. Core: `toggleList`, `wrapInList`, `splitListItem`, `sinkListItem`, `liftListItem`, `liftListItemAtStart`, `listTypeAt` and `listKeymap()` (in every editor): Enter splits an item and leaves the list on an empty one, Tab and Shift+Tab nest and lift items (outside a list Tab is left to the browser), Backspace at an item's start lifts it, Ctrl/Cmd+Shift+7 and +8 toggle numbered and bulleted lists; `editor.commands.toggleList`, `wrapInList`, `indentListItem`, `outdentListItem`. Backspace after a list and Delete before one join into it. Each list change is its own undo step. View: Ctrl/Cmd+Shift+digit shortcuts work on every layout; `insertParagraph` and one-character delete inputs (keyboards without keydown) go through the same key bindings. React: toolbar buttons for bulleted and numbered lists (pressed inside one), decrease and increase indent.
