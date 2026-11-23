---
"@folijs/view": patch
"@folijs/core": patch
---

Smaller fixes from the audit of 1.4.0 in the view: `w:widowControl="0"` is honoured by the editor's pages and `renderDocument` (a paragraph splits at any line), and core resolves a `widowControl` set nowhere as on, as Word does; Ctrl+click (Cmd+click) on a link to a bookmark, a table of contents' entry (`HYPERLINK \l`) or a cross-reference with `\h` goes to the bookmark; a `beforeinput` the view does not carry out (`formatJustifyCenter`, `insertTranspose`…) is said once in the console instead of dropped silently, and `formatIndent`, `formatOutdent` and `insertFromYank` are carried out; a header or footer whose view fails to open leaves the body editable; a render that throws draws everything again next time; a drop-down's option ids are unique per view; `renderDocument`'s print rules apply to its own pages only; an editor inside a shadow root reads its focus and selection there (Chromium, Firefox; not WebKit, see limitations).
