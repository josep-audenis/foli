---
"@folijs/react": minor
---

Toolbar: a color menu with `colors.custom` has a last entry, "More colors…", that opens the
browser's color field, so `pick` gets any `#rrggbb`
(`{ ...toolbarItems.textColor, colors: { ...toolbarItems.textColor.colors, custom: true } }`).
