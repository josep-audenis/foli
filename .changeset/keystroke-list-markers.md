---
"@folijs/core": patch
"@folijs/react": patch
---

Faster keystrokes in long documents: list numbers no longer resolve every paragraph's whole
formatting on each change (only numbered paragraphs are), and `FoliComments` no longer scans the
document on each change when it has no comments. A third to a half off a keystroke's handler at
100 pages in Chromium.
