# ADR-0016: Text boxes as stories in floating anchors (schema 10)

- **Status:** Accepted when merged, task 33.1 (2026-11-27), by an agent's review, as the owner
  asked for Phase 33 (one PR per task, reviewed, merged).
- **Context:** until Phase 33 a text box was opaque: the run's `mc:AlternateContent` (Word's
  DrawingML text box with its VML copy for Word 2007), a bare `w:drawing` or a VML `w:pict` kept
  verbatim, not drawn, its text out of reach of the caret, find and the agent. Floating pictures
  are modeled (`picture.float`, ADR-0006) and drawn as CSS floats in their paragraph; tight and
  through wrapping are drawn as square. Headers, footers and notes are stories edited on their
  page by a nested view (ADR-0007). Phase 33 makes text boxes real and gives pictures and boxes
  Word's layout options; Phase 34 (shapes) builds on what this decides.

## Decision

1. **A text box's text is a story.** `StoryJSON.kind` gains `textBox`; its id is
   `textbox:<n>` for the body's boxes and `textbox:<relationship id>/<n>` for a header's or
   footer's (numbered in the part's reading order, so reading the package again names them the
   same: export compares each with the file's to keep an unchanged one verbatim). It is edited
   as a note is: `editor.story(id)`, `StoryStep`s in the body's history, one undo stack, review
   and find over every story. What a box may hold is what a note may, and no page or column
   break (Word refuses them). Word puts boxes in the body, headers and footers only: a box in a
   note, a comment or another box stays opaque on import and is refused by `parseDocument`.
2. **The box is a `textBox` node, a floating anchor like a picture.** An inline run atom with
   `story`, `width` and `height` (EMU), `float` (the picture's `checkFloat`: position, wrapping,
   side, distances; null in line with text), what it is drawn with (`fill` RRGGBB or null,
   `outline` color and width or null, `inset`, `verticalAlign`, `autoFit`), `alt`, `title`, and
   `ext`, the run content it was read from. Theme colors are resolved to RRGGBB on import (the
   theme link stays in `ext`). A rotated box, a non-rectangular shape with text, a linked box
   (`wps:linkedTxbx`), a group, a box filled with a picture stay opaque: shapes are Phase 34's.
   A box that goes takes its story in the same transaction (`textBoxesPlugin`), as a note's
   reference does; a story no box showed is left alone.
3. **Export writes into what was read.** Unchanged (its story as read, its look as `ext` says),
   a box comes back byte for byte. Edited text goes into every `w:txbxContent` of `ext`, the
   DrawingML and its VML copy, and Word 2007's cached drawing (`o:gfxdata`) is dropped. A changed
   size, position, wrapping, fill, outline or inset is written into the DrawingML in place
   (`frameEdits`, shared with pictures from this task: a picture's changed float is no longer
   written as a new drawing), and the VML copy, which would show the old box, is left out (Word
   2010 and later read DrawingML); so it is for a copy (two boxes with one `wp:docPr` id). A
   VML-only box that changed, and a new one, are written as a DrawingML text box without a VML
   copy. Word 16 opens all of these without repair (`scripts/corpus/textbox-roundtrip.mjs`).
4. **Drawing (33.2): the box where a floating picture is.** The view and `renderDocument` lay the
   box out with the code that places floating pictures (a CSS float in its paragraph, or an
   absolutely placed element for in front and behind), and draw its story's blocks inside it,
   read-only, with the renderer stories already use. Print and `exportPdf` follow.
5. **Editing (33.3): on its page, as a note.** A click in a drawn box mounts a nested
   `EditorView` of the story there (`paged: false`), the body read-only around it; Escape or a
   press outside leaves. Find and replace already read every story, text boxes included.
6. **Tight and through: the box for now.** Text goes around the frame's rectangle, as for
   square; the file's wrap polygon is kept in `ext` and written back while the wrapping is
   unchanged, and a new tight or through wrapping gets the frame's rectangle as its polygon,
   which is what Word draws for a rectangular picture or box. A polygon that is not the
   rectangle (Word's Edit Wrap Points, a picture with transparent edges) is not followed: noted
   in limitations.md.
7. **Schema 10.** A `textBox` node or a story of kind `textBox` needs it; a document saying 9
   or less holding one is refused. v9 → v10 changes the version only: a box an earlier release
   kept opaque stays so until the `.docx` is imported again, as v4 → v5 did for notes. Schema 9
   is not published yet either; a bump rather than adding to it, so the two phases' releases
   can go apart.

## Options rejected

- **The text in the node (a `textBox` with block content):** inline nodes cannot hold blocks
  without a second kind of paragraph flow inside the line, and every paragraph walk (numbering,
  find, review, the agent's handles) would meet blocks inside inline content. Stories already
  give a tree of its own with one history.
- **The box as a block between paragraphs:** Word anchors it in a run; moving with text and
  in-line boxes need the inline place, and the file has it there.
- **Rewriting the whole drawing on any change:** loses effects, the wrap polygon, z-order and
  Word's ids, which the frame edits keep.

## Consequences

- Every place that walks stories sees a new kind: those that list headers and footers or notes
  filter by kind already; the agent reads a box's paragraph without the box's text until it
  learns stories of this kind (noted in limitations.md).
- Find, replace, accept and reject all reach text boxes through the stories they already walk.
- A copy of a box needs its story copied with a fresh id (as notes' are): the clipboard work of
  33.3.
