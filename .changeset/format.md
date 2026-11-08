---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/react": minor
---

Alignment, colors and horizontal rules. Core: `setAlign`, `setTextColor`, `setHighlight` (null removes; at a caret, for the next typed text), `insertHorizontalRule`, `alignAt`, `colorAt`, `Transform.setBlockAttrs`, and `editor.commands` for each; typing over a selected rule replaces it with a paragraph, Enter adds one after it; arrow keys select a rule from the text beside it and leave it again (`arrowAcrossLeaf`). View: Up/Down onto a rule from a textblock's first or last line. React: toolbar alignment group, text color and highlight menu buttons (accessible menus, fixed palette), horizontal rule button; CSS variables `--foli-link-color`, `--foli-marker-color`, `--foli-rule-color`, `--foli-rule-thickness`; a rule is a taller box (easier to click) with its line in the middle.
