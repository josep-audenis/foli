---
"@folijs/agent": patch
---

A read keeps every block on one line whatever the document holds: a carriage return, a line or paragraph separator (U+2028, U+2029) and a next-line character (U+0085) show as `↵`, as a line break does, in a block's text and in everything a document names that is shown (a style, a list number, a control's tag, title, items and value, a field's instruction and a merge field's name in what `updateFields` says; `styles()` and `controls()` give the names that way, and take them back that way). A document could otherwise start a line that reads as another block. A refusal that quotes a block's text quotes at most 2,000 characters of it.
