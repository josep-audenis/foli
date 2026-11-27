---
"@folijs/core": minor
"@folijs/react": minor
---

Word's View tab's Ruler: `toggleRuler`, `setRulerShown` and `rulerShown` in core (a setting, no
undo step), `toolbarItems.ruler` in the ribbon's View tab (kept on a comment-only toolbar), and
`FoliEditor` drawing both rulers while it is on (`ruler` turns it on at first, `ruler={false}`
never draws them).
