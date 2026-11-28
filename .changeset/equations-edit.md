---
"@folijs/core": minor
"@folijs/docx": minor
"@folijs/view": minor
"@folijs/react": minor
---

Equations are edited (schema 12, ADR-0018): an `equation` node holds Word's OMML, read and written
back as it is by `@folijs/docx`; `insertEquation`, `setEquation`, `selectedEquation`,
`isDisplayEquation` in core; `unicodeMathToOmml`, `ommlToUnicodeMath` and `equationElement` in
the view (Word's linear format, own reader and writer); Insert ▸ Equation in React
(`toolbarItems.equation`: Word's gallery, Insert New Equation…, Edit Equation…; the `"equation"`
dialog). Documents with an equation need schema 12. New toolbar messages: the gallery's names
and the dialog's labels.
