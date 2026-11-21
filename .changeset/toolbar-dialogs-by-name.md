---
"@folijs/react": minor
---

Toolbar: an app's button can open one of the toolbar's own dialogs by name
(`ToolbarDialog` with `dialog: "link" | "picture" | "insertTable" | "pageSetup" |
"crossReference" | "controlProperties" | "noteOptions"`). Types only: `ToolbarDialog["dialog"]`
is now a function or one of those names, so code that calls an item's `dialog(props)` checks
`typeof item.dialog === "function"` first.
