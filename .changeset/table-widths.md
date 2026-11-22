---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/react": minor
---

Autofit tables widen a column for content that cannot break (a long word, a picture), as Word
does, keeping Word's saved widths otherwise, the same on every page a table goes over; fixed
tables keep their grid. The Table menu has Column width… (`"columnWidth"` dialog) to set the
selection's column width from the keyboard; core's `columnAt(state)` gives that column and the
widths it may take. New toolbar strings: "Column width…", "Column width", "Column width (cm)",
"Enter a width in cm from {min} to {max}.", "This column cannot be made wider or narrower.".
