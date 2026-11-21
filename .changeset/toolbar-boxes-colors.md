---
"@folijs/react": minor
---

Toolbar: an app's item can be a box (`ToolbarSelect`) or a color menu (`ToolbarColorMenu`), and
the built-in ones take other fonts, sizes and colors through a copy
(`{ ...toolbarItems.textColor, colors: { ...toolbarItems.textColor.colors, options } }`).
`toolbarItems` now types its boxes and color menus as what they are, not `ToolbarButton` (they
never had a `command`).
