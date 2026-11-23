---
"@folijs/view": patch
---

The editing host and `renderDocument`'s pages carry `translate="no"`: the browser's page translation (Chrome's Translate) no longer rewrites the document's text, which the view read back as typing and saved (as tracked changes while tracking). `destroy()` removes the attribute it added.
