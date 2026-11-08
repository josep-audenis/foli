---
"@folijs/view": minor
---

HTML paste reads schema v2: lists at any depth (`ul`/`ol`/`li`, `start`, a list nested directly in a list), Word list paragraphs (`mso-list` levels, numbered or bulleted from their marker) and Google Docs lists, rules (`hr`), links from `a[href]` when the href is safe (in-page `#…` anchors dropped), text color and highlight from inline styles and `<font color>` (black text and white highlight are defaults), and block alignment (`text-align`, `align`). Lists and rules that cannot be pasted as a slice go in as whole blocks at the caret (a list pasted into a list item joins it). Copy writes the same structures, so Foli's HTML reads back as the same document.
