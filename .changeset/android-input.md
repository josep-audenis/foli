---
"@folijs/view": minor
---

Android keyboards: Backspace at a numbered paragraph's start removes its number (the keyboard's
delete of the paragraph boundary is taken as Backspace at a caret), and a paragraph split inside
its text, made in the DOM without `beforeinput`, is read back as Enter instead of discarded.
