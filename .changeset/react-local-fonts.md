---
"@folijs/react": minor
---

The Font box lists the fonts installed on the machine in Chromium browsers (the Local Font Access API): opening the built-in box the first time asks the browser's permission; once allowed, they are listed at once on later visits. Elsewhere, or when refused, the box offers its own fonts as before. `FoliToolbar`'s `localFonts={false}` (or `FoliEditor`'s `toolbarProps`) never asks.
