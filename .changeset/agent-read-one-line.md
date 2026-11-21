---
"@folijs/agent": patch
---

A read keeps every block on one line whatever its text holds: a carriage return, a line or paragraph separator (U+2028, U+2029) and a next-line character (U+0085) show as `↵`, as a line break does. Text in a document could otherwise start a line that reads as another block.
