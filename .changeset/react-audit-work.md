---
"@folijs/react": patch
---

`FoliComments` measures nothing while hidden or without threads, and measures once a frame while typing instead of on every change; `FoliCanvas` calls the latest `upload` and `resource` through one function each, so an inline function no longer redraws every picture on each render; a built-in toolbar dialog closed by an edit from elsewhere gives the focus back to where it came from; the font, size and style boxes stepped with the arrow keys apply on Enter (or when they lose the focus), one undo step, not one per value passed; Escape drops the value.
