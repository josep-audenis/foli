---
"@folijs/react": patch
---

`FoliComments` measures nothing while hidden or without threads, and measures once a frame while typing instead of on every change; `FoliCanvas` calls the latest `upload` through one function, so an inline one is no change of the view's options (a new `resource` still draws the pictures again: keep it memoized); a built-in toolbar dialog closed by an edit from elsewhere gives the focus back to where it came from; the font, size and style boxes stepped with the arrow keys (not on Apple platforms, where the arrows open the list) apply on Enter or Tab, one undo step, not one per value passed; Escape or leaving the box another way drops the value.
