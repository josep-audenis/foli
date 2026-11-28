# ADR-0017: Shapes as drawn anchors with DrawingML's geometry (schema 11)

- **Status:** Accepted when merged, task 34.1 (2026-11-27), by an agent's review, as the owner
  asked for Phase 34 (one PR per task, reviewed, merged). Implemented in Phase 34 (34.1–34.6) as
  decided, plus: a file's custom dash kept as `custom` (34.5), and Word's `a:shade` and `a:tint`
  taken in linear light (34.6).
- **Context:** until Phase 34 a shape was opaque: the run's `mc:AlternateContent` (Word's
  DrawingML `wps:wsp` with its VML copy for Word 2007) or a bare `w:drawing`, kept verbatim, not
  drawn. Phase 33 made Word's plain text box (an upright rectangle holding text) a `textBox`
  node: a floating anchor like a picture (`float`, `frameEdits`), its text a story of kind
  `textBox` edited on its page. Shapes are the rest of `wps:wsp`: every preset geometry
  (`a:prstGeom`, some 190 in DrawingML), custom geometry (`a:custGeom`, Word's freeforms and
  curves), turned and flipped, filled with a color or a gradient, lined with dashes and arrows,
  and often holding text. Phase 35.6 (cover pages) and Phase 40 (charts, SmartArt) draw on what
  this decides.

## Decision

1. **A shape is a `shape` node, a floating anchor like a picture and a text box.** An inline
   run atom with `geometry` (the preset's name, `custom` for a custom geometry), `adjust` (the
   preset's adjust values, `a:avLst`), `custom` (a custom geometry's guides and paths: commands
   whose arguments are numbers or guide names, as the file has them), `width`/`height` (EMU),
   `float` (a picture's), `rotation` (60 000ths of a degree), `flipH`/`flipV`, `fill` (RRGGBB,
   null for none; with a gradient, its first stop) and `gradient` (stops, a linear angle or a
   path), `outline` (color, width, `prstDash`, head and tail ends; null for none), `alt`,
   `title`, `decorative`, and `ext`, the run content it was read from. A theme's style
   (`wps:style`: `a:fillRef`, `a:lnRef` into the theme's `a:fmtScheme`, `a:fontRef`) is resolved
   to colors and widths on import, as Phase 33 resolves a text box's; effects (shadows, glow,
   soft edges, 3-D: `a:effectLst`, `a:scene3d`, `a:sp3d`, `a:effectRef`) stay in `ext`, not drawn.
2. **Text in a shape is a text box's story.** `story` (null: no text) names a story of kind
   `textBox`, numbered with the text boxes in reading order (`textbox:<n>`); `inset`,
   `verticalAlign`, `autoFit` as a text box's, and `textColor` (the style's font color, the
   text's color where it sets none). Everything Phase 33 does for a box's story (removed with
   its node in one undo step, copied with it, counted, found, opened on its page) does for a
   shape's. A text box stays a `textBox`: Word's plain upright rectangle with text is read as
   one; a turned one, or text in any other geometry, is a `shape` (ADR-0016's "rotated box"
   becomes one here).
3. **What stays opaque:** a group (`wpg:wgp`), a drawing canvas (`wpc:wpc`), a shape filled with
   a picture or a pattern (`a:blipFill`, `a:pattFill`, `a:grpFill`), a linked text box
   (`wps:linkedTxbx`), vertical text, a VML-only shape (`w:pict` without DrawingML: Word 2007
   files), and a shape in a note, a comment or a text box (Word puts shapes in the body,
   headers and footers, as text boxes).
4. **Drawn as SVG from DrawingML's own definitions (34.2).** The presets Word's Shapes gallery
   offers in Lines, Rectangles, Basic Shapes, Block Arrows, Stars and Callouts, about 45 of them,
   are kept in the view as their ECMA-376 definitions (guides, paths, adjust handles, text
   rectangle) and evaluated by one interpreter of DrawingML's guide formulas, which draws custom
   geometries too and gives 34.4 its adjustment handles. A preset not among them is drawn as its
   bounding rectangle (fill and line), kept whole in the file. Paths are SVG `path`s scaled to the
   shape's box, turned and flipped about its center; `fill="none"`/`stroke="0"` paths and the
   darken/lighten fills of 3-D presets (`can`, `cube`) as the definitions say; line ends as SVG
   markers sized from the line's width.
5. **Export writes into what was read**, as for text boxes: an unchanged shape comes back byte
   for byte (its look compared with what its `ext` says); a changed transform, geometry, fill
   or line is written into its `wps:spPr` in place (the other line properties, cap and join,
   kept), its frame by `frameEdits`, its text into its `w:txbxContent`, and Word's VML copy left
   out. A new shape is written as DrawingML without a VML copy (`wps:cNvCnPr` for a line), its
   fill and line explicit rather than a theme style.
6. **Checked against Word.** The corpus gains `12-shapes-poster.docx` (Word-made: 32 presets in a
   grid, an adjusted, a flipped, a gradient, a dashed, a text-holding shape, lines with ends, a
   freeform, a shape wrapped square, a header's line). A shape is drawn as Word draws it when, in
   its box, Foli's page and Word's PDF (pdf.js at 96 px per inch) agree by ink within 2 px
   (`apps/playground/src/ink.ts`) with a score of at least 0.9; its place within 1.5 px, as
   Phase 33's boxes. Word 16 opens Foli's unchanged, edited and new shapes without repair
   (`scripts/corpus/shape-roundtrip.mjs`, 34.6).
7. **Schema 11.** A `shape` node needs it; a document saying 10 or less holding one is refused.
   v10 → v11 changes the version only: a shape an earlier release kept opaque stays so until the
   `.docx` is imported again.

## Options rejected

- **Text boxes as shapes (one node):** Word's text box is a `wps:wsp` too, and one node would be
  tidier, but schema 10's `textBox` is already in the model, the view and the commands Phase 33
  built; a second node that shares its story machinery costs less than migrating them.
- **Each preset as hand-written drawing code:** forty functions that only approximate Word's
  formulas, no custom geometry, and no adjustment handles; the definitions are what Word draws
  from.
- **Rewriting the whole shape on any change:** loses effects, the theme style, Word's ids and
  the VML copy of what did not change.

## Consequences

- Every place that walks a text box's story walks a shape's (`node.attrs.story` on a `shape`).
- Layout Options, Position, Size, Bring Forward, Send Backward and Align (Phase 33) work on
  shapes as on pictures and text boxes; a shape turns (`rotation`) as a picture does.
- Until 34.2 a shape is imported but not drawn (as an opaque drawing was not).
- The agent reads a shape's paragraph without its text, as a text box's (limitations.md).
