---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/react": minor
---

Text boxes are edited where they are drawn (33.3): a click puts the caret in a box, Escape
leaves it selected; find goes into boxes. `insertTextBox` and `selectedTextBox` in core,
`storyView.editTextBox`, and the toolbar's Text Box item (Insert ▸ Text). Copies of boxes paste
as boxes of their own; the word count with notes counts boxes as Word's option does.
