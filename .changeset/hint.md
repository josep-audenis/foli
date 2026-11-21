---
"@folijs/core": minor
"@folijs/view": minor
---

A hint: `view.hint(target, { ms })` and core's `hint(editor, target, options)` scroll to a range and mark it for a few seconds (`::highlight(foli-hint)`), then let the mark fade, without changing the document, the selection, undo or the focus. The range follows edits made while it shows. A point shows its paragraph; a header's, footer's or note's range marks its drawn copies; core's `hint` also takes `{ bookmark }`. `StoryView.hint` is optional.
