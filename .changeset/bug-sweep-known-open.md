---
"@folijs/core": patch
"@folijs/view": patch
"@folijs/react": patch
"@folijs/docx": patch
"@folijs/mcp": patch
---

The bugs the earlier sweeps left known and open, each fixed with a regression test.

**core**

- Accepting several whole-deleted paragraphs before a table gives the same result in any order: the chain goes after a paragraph that stays, and one paragraph stays where Word's rules need it (at the start, between tables).

**docx**

- A document that binds WordprocessingML to another prefix (or none) exports with its `fldSimple` fields and modeled attributes well-formed, instead of being refused.

**view**

- With field codes shown, a code holding U+E000 in a header or footer is kept beside a page number.

**react**

- A link dialog opened from inside another dialog gives the focus back to the Link button on cancel.
- A tab removed from `tabs` and added again is not selected by itself.
- Arrow keys in the toolbar and its tabs follow right-to-left layouts.
- Mod-K with two toolbars on one editor opens one link dialog: the toolbar holding the focus, else the first mounted.
- An open menu closes when its item is disabled.

**mcp**

- A save's export error is one line, as an open's is.
- A byte order mark before the first message is ignored, also when it comes split over chunks.
- The server stops, instead of waiting forever, when its output closes while an answer waits to be taken.
- Saving a document again under its own file's name in other capitals is allowed.
