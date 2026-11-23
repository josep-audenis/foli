---
"@folijs/docx": patch
---

Export correctness from the audit of 1.4.0: a new package writes `w:compat` with `compatibilityMode` 15, so Word no longer opens it in compatibility mode; `doNotUseHTMLParagraphAutoSpacing` is written into an existing settings part that lacks it; a relationship whose part the package lacks gets that part where it points instead of a second relationship; `xml:space="preserve"` inherited from a paragraph or run is read; a cell or table naming both `left` and `start` (or `right` and `end`) writes one element for the side; drawing ids are found in single quotes and in UTF-16 parts. New export options `asDocument` and `dropped`: a `.docm`, `.dotm` or `.dotx` written as a plain `.docx`, its main part's type changed and its VBA project left out and reported.
