---
"@folijs/agent": patch
---

`updateFields` leaves a table of contents as it is unless `contents: true` is passed. Built without pages, its entries came back with their page numbers empty, and nothing said so; now `text` says a table was left and how to build it, and when one is built, that its entries are new blocks whose page numbers are empty until Word updates the field. A comment's initials are each word's first letter or digit: "Claude (trial)" is `Ct`, not `C(`.
