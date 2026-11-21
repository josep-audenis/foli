---
"@folijs/core": minor
"@folijs/view": minor
---

A hint: `view.hint(target, { ms })` and core's `hint(editor, target, options)` scroll to a range and mark it for a few seconds (`::highlight(foli-hint)`), then let the mark fade, without changing the document, the selection, undo or the focus. The range follows edits made while it shows. `StoryView.hint` is optional.
