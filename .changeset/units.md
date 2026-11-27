---
"@folijs/react": minor
---

`FoliToolbar`'s `units` (`"in"` or `"cm"`, `LengthUnit`): the unit of Page setup, the column width
dialog, the Paragraph and Tabs dialogs and the Layout tab's Indent boxes. By default the
locale's, as Word's: inches where `navigator.language` is in the United States, Liberia or
Myanmar, centimetres elsewhere. A box also takes a length typed with its unit. Changed strings:
Page setup's labels and the column width dialog's no longer say "(cm)" ("Page width", "Top
margin"…, "Set column widths (separated by ;)", "Column width", "Enter a width from {min} to
{max}.").
Set column widths in Page setup are separated by `;` only (a width may be typed with its unit,
`2 cm`), not by spaces. `FoliMiniToolbar` takes `units` too (`FoliEditor` passes its
`toolbarProps.units`).
