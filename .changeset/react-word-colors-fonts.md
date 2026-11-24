---
"@folijs/react": minor
---

Word's color grid in the toolbar: Text color and Shading show the document's theme colors (Office's theme when it has none) with five shades each, Word's ten standard colors, and "More colors…" for any color. Highlight offers all of Word's highlight colors. A color menu takes `columns` (swatches in a grid) and `options` as a function of the state; a `ToolbarColor` may carry a `shade`. The Font box lists about thirty common fonts. New strings: the theme slot names, the shade names ("Lighter {percent}%", "Darker {percent}%") and the added color names; removed: "Gray", "Light gray", "Light orange", "Light yellow".
