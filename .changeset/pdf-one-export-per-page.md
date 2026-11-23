---
"@folijs/pdf": patch
---

Two `exportPdf` calls given one page run one after the other: before, the second replaced the first's document while it printed, so on a server with a pool of pages one user's PDF could hold another's document. New options `signal` (an `AbortSignal`) and `timeout` (milliseconds) stop an export. The README says to keep `@folijs/pdf` external in bundlers.
