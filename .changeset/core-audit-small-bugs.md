---
"@folijs/core": patch
---

Smaller fixes from the audit of 1.4.0: a new tracked change no longer reuses a table row's revision id (a duplicate `w:id` on export); a `MERGEFIELD` with a date picture (`\@`) reads ISO dates only, not what `Date.parse` guesses (`"12"` was 2001-12-01); `SEQ \r` with no number counts on instead of restarting at 0; roman, letter and ordinal numbers of fractions show their digits, and negative ordinals take their size's suffix (`-1st`); a reply whose parent is missing can be resolved; a string `schemaVersion` gets a message saying it must be a number.
