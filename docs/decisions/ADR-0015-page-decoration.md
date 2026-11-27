# ADR-0015: Page decoration in the model (schema 9)

- **Status:** Accepted when merged, task 32.1 (2026-11-27), by an agent's review, as the owner
  asked for Phase 32 (one PR per task, reviewed, merged).
- **Context:** Word's Design tab decorates pages: a page color (`w:background`, the first child
  of `w:document`), page borders (`w:pgBorders` in a section's `w:sectPr`), watermarks (a shape
  in the headers), and line numbers (`w:lnNumType`, Layout tab). Until Phase 32 Foli kept
  `w:pgBorders` and `w:lnNumType` only inside a section's verbatim `ext` and did not draw them,
  never read `w:background` (the package kept it), and kept a watermark as an opaque run of its
  header. Editing any of them means modeling them; drawing them means the editing view and
  `renderDocument` (print, `exportPdf`) know them. The change reaches core (schema), docx
  (import, export) and view (drawing): hence this record.

## Decision

1. **Page color: `settings.background`.** Word's page color is the document's, not a section's,
   and the envelope's `settings` is already what the document holds beside its content, edited
   through `EnvelopeStep`s (undo, collaboration). It is `{ color, themeColor, themeTint,
   themeShade, ext }`: the values Word's Page Color writes, and the element verbatim. Export
   keeps the element as it was while its values match, Fill Effects (VML children) included;
   otherwise writes `w:background` anew with the values only, as Word does when a color is
   picked, and removes it when there is none. A color set anew (no `ext`) also turns on
   `w:displayBackgroundShape` in the settings part: without it Word does not show the color. A
   file's own background leaves its settings as they are (shown or hidden as the file says). Not a part of its own in the
   envelope: one more top-level key for one element was not worth the migration surface.
2. **Page borders and line numbers: section parts.** `section.pageBorders` (`top`, `left`,
   `bottom`, `right` as `BorderJSON`; `offsetFrom`, `display`, `zOrder`) and
   `section.lineNumbers` (`countBy`, `start`, `distance`, `restart`), read from and written to
   `w:sectPr` as the other parts are (`keptOrFresh`: an unchanged part is copied from `ext`, a
   changed one written in CT_SectPr's order). A tracked setup change records them as it records
   the rest (`w:sectPrChange`). `countBy` is required: an `lnNumType` without it numbers no
   line in Word, and stays in `ext`.
3. **Schema 9.** Holding any of them makes a document need schema 9 (ADR-0008: saved with the
   lowest version its content needs, so earlier 1.x keep reading what has none); a document
   that says 8 or less holding one is refused. v8 → v9 changes the version only. Phase 32's
   later tasks add to v9 before it is released (a watermark node, 32.3; a paragraph's
   `suppressLineNumbers`, 32.5); nothing of v9 is published before the phase ends.
4. **Watermarks (built in 32.3).** Recognised on import: a header run whose VML shape is Word's
   watermark (`PowerPlusWaterMarkObject…`, a `v:textpath` text; `WordPictureWatermark…`, a
   `v:imagedata` picture) becomes a `watermark` inline node with what Word's dialog sets (text,
   font, color, size, layout, semitransparent; or the picture, scale, washout) and the run
   verbatim, written back as it was while those values match, else as Word writes one. Every
   other shape stays opaque. Drawn by the view on every page of the header's sections, under
   the text.
5. **Drawing.** The view and `renderDocument` draw both on each page from the same helpers
   (`view/src/word/decoration.ts`): the color as the page's background (printed: `print-color-
   adjust: exact`), the borders as one element over the page that pointer events pass through,
   behind the text for `zOrder` back. What is not drawn is in limitations.md ("Page
   decoration").

## Consequences

- Documents with page borders or line numbers read by 1.9 or earlier keep them in `ext`; read
  again by this release they are modeled, and saving writes them back as they were.
- Changing page borders writes them without what the model does not hold (a border's shadow,
  an art border's picture relationship): Word's dialog sets them again the same way.
