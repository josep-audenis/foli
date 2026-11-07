---
"@folijs/core": minor
"@folijs/view": minor
---

Document format v2 (`schemaVersion: 2`): bullet and ordered lists (`bulletList`, `orderedList` with `start`, `listItem`), `horizontalRule`, `align` on paragraphs and headings (`start`, `center`, `end`, `justify`; changing a block's type keeps it), and the marks `link` (`href` limited to relative URLs and http, https, mailto, tel: see `isSafeHref`), `textColor` and `highlight` (lowercase `#rrggbb`: see `isColor`). Documents saved by 0.1.0 (v1) load unchanged through a migration; 0.1.0 cannot read v2 documents. Attributes equal to their default are no longer written to JSON. `MARK_TYPES` now lists every mark (attribute-free ones are `SIMPLE_MARK_TYPES`). The view does not render the new types yet. `setBlockType` no longer applies (or records undo) when nothing changes; `toggleMark` with invalid attributes (a link with an unsafe href) does not apply instead of throwing.
