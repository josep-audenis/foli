# API reference

The public API of the five packages, as of 0.6.0 (`@folijs/pdf` first released in 0.6.0), with
the export lists of 12.2 ([ADR-0008](decisions/ADR-0008-1.0-contract-and-extensions.md)).

**Stable or internal.** Every name on this page is **stable** unless marked **internal**: the
package's entry exports it, and from 1.0 it changes only as ADR-0008's semver rules allow (before
1.0, 0.x minors may still break it; changes are listed in each package's changelog). Internal
names are on `@folijs/core/internal`, the entry the other Foli packages use, with no promise at
all: any release may change them. Each package's exact surface is its API report,
`packages/<name>/api-report.d.ts` ([contributing.md](contributing.md#api-reports)); a module
export that is in neither entry is left out of the published types.

- [`@folijs/react`](#folijsreact): components and hooks
- [`@folijs/core`](#folijscore): documents, the headless editor, commands
- [`@folijs/view`](#folijsview): the editable DOM view without React
- [`@folijs/docx`](#folijsdocx): `.docx` import and export
- [`@folijs/pdf`](#folijspdf): PDF from Foli's pages, through a headless Chromium page

## `@folijs/react`

Peer dependencies: `react` and `react-dom` 18.2+ or 19, and `@folijs/core` and `@folijs/view` at
exactly its own version (after 0.6.0). Stylesheet: `@folijs/react/styles.css`
([styling.md](styling.md)). Stable with the components: their props and handles
(`FoliEditorProps`, `FoliEditorHandle`, `FoliChange`, `FoliCanvasProps`, `FoliCanvasHandle`,
`FoliCommentsProps`, `FoliNavigationProps`, `FoliToolbarProps`) and the hooks' options
(`UseFoliEditorOptions`, `UseEditorStateOptions`).

### `<FoliEditor>`

An editable document on pages, with a toolbar. Creates its own editor and provides it to its
`children`. Uncontrolled: the editor owns the document. Since 8.7d1 it edits Word's model (with
Word's toolbar; schema v5 since 0.6.0): a document saved by 0.1.0 to 0.5.0 given to it is
migrated (`parseDocument`), and what it reports is v5.

| Prop             | Type                                             | Default      | Notes                                                                                               |
| ---------------- | ------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------- |
| `initialContent` | `EditorDocument`                                 | empty A4     | Read once, on mount; any version (migrated). Later: `editor.setDocument()` or a new `key`.          |
| `plugins`        | `readonly Plugin[]`                              | `[]`         | Read once, on mount. Unstable API.                                                                  |
| `extensions`     | `readonly Extension[]`                           | `[]`         | Read once, on mount: custom nodes and marks, with their view hooks (`ViewExtension`).               |
| `author`         | `string`                                         | `"Author"`   | Read once: who edits (tracked changes are made in this name).                                       |
| `trackChanges`   | `boolean`                                        | `false`      | Read once: record edits as tracked changes (the toolbar turns it on and off).                       |
| `reviewView`     | `ReviewView`                                     | `"markup"`   | Read once: how tracked changes show (the toolbar changes it).                                       |
| `onChange`       | `(change: FoliChange) => void`                   | —            | After every content change made through transactions. Not for selection changes or `setDocument`.   |
| `toolbar`        | `boolean`                                        | `true`       | Show `FoliToolbar` above the pages.                                                                 |
| `comments`       | `boolean \| "auto"`                              | `"auto"`     | The comments pane beside the pages: while the document has comments (`"auto"`), always, never.      |
| `readOnly`       | `boolean`                                        | `false`      | Read, select, copy; no editing. Disables the toolbar.                                               |
| `placeholder`    | `string`                                         | `""`         | Shown while the document is empty.                                                                  |
| `label`          | `string`                                         | `"Document"` | Accessible name of the editable area.                                                               |
| `upload`         | `(file) => Promise<…>`                           | —            | Where pasted, dropped and inserted image files go (the view's `upload`); the toolbar's Picture too. |
| `resource`       | `(key, resource) => string \| null \| undefined` | —            | The URL to show a picture's image from (`packageImages` for a .docx package); `null` shows its box. |
| `className`      | `string`                                         | —            | Added to the `.foli-canvas` element.                                                                |
| `children`       | `ReactNode`                                      | —            | Rendered between the toolbar and the pages, inside the editor's context.                            |

`ref` → `FoliEditorHandle`: `{ editor: Editor; focus(): void }` (`editor.setDocument` takes
a document of any version too).

`FoliChange`:

- `editor: Editor`
- `transactions: readonly Transaction[]`: this change's transactions (several when plugins
  append their own).
- `document: FoliDocument`: the document right after this change (content, styles,
  numbering, comments, page setup), serialized on first read. Read it when you save, not on
  every change. Save `change.document`, never `change`: `JSON.stringify(change)` gives
  `{ editor, transactions, document }`, which `parseDocument` rejects.

### `<FoliCanvas>`

The pages alone, for your own layout. Props: `editor` (default: the nearest
`FoliEditorProvider`'s), `readOnly`, `placeholder`, `label`, `className`, `upload`, `resource`,
as above (`upload` and `resource` are the view's options, in place from its first render; give
`resource` a stable function: a new one draws every picture again).
`ref` → `FoliCanvasHandle`: `{ focus(): void }` (focuses the document, shows the editor's
selection and scrolls it into view).

### `<FoliComments>`

The comments pane: the document's threads beside the pages, each level with its text and moved
down below the one before when they would overlap; resolved threads dimmed. Reply, Edit (comments
of plain text, a line per paragraph), Resolve/Reopen, Delete; a new empty comment (the toolbar's
New comment) opens for writing (Ctrl/Cmd+Enter saves, Escape cancels; one left empty is
deleted). Focusing a thread outlines its text; a caret in commented text marks its thread. Not
printed. Props: `editor` (default: the nearest provider's), `readOnly` (no actions), `label`
(default "Comments"), `className`, `hidden` (not shown, still following the editor). Edit keeps
the comment's paragraph style (Word's CommentText); a comment with other formatting is not
editable here. `FoliToolbar`'s `comments` prop shows New comment (only with a pane). Render it beside the pages (`FoliEditor` does, in
`.foli-editor-body`): it finds the commented text (`data-foli-comments` in the view) in the
nearest ancestor that holds them.

### `<FoliNavigation>`

Finding and going places, as in Word (`FoliEditor` includes it; alone, render it next to the view
of the same editor). Props: `editor` (default: the nearest provider's), `readOnly` (no replacing,
no changing bookmarks).

- **Find and replace** (`.foli-find-panel`, a dialog that is not modal, with Find, Replace and Go to
  tabs): Ctrl+F, Ctrl+H, Ctrl+G (Cmd on Apple platforms). Typing marks the matches of the body and
  of every story and scrolls to the next one, moving nothing in the document; Enter goes to it and
  on, Shift+Enter back, F3 and Shift+F3 too, with the panel closed as well. A match in a header,
  footer or note opens it where it is, and a match in the body leaves it. Match case, Whole words.
  Replace shows a match first and replaces it on the second press; Replace all is one undo step and
  says what it left and why. Go to takes a page, a bookmark or a heading. Escape closes it and
  gives the focus back.
- **Bookmarks** (`.foli-bookmarks`): Ctrl+Shift+F5. Add at the selection (a name in use moves that
  bookmark, as in Word), Go to, Rename, Delete; Hidden bookmarks lists Word's own.
- **Outline** (`.foli-outline`, a `nav` beside the pages): the headings with their pages, the one
  the caret is under marked `aria-current`; Up and Down move, Enter goes there.

**The keys are taken only while the focus is in the document or in these panels.** Elsewhere on the
page Ctrl+F is the browser's, and so it is everywhere when no `FoliNavigation` is mounted. The
toolbar's Navigate menu opens the same panels.

### `<FoliToolbar>`

Word's controls: paragraph style (with Word's Heading 1 to 3 when the document has not used
them yet), font and size boxes · bold, italic, underline, strikethrough, link, text color,
highlight · align left, center, align right, justify, line spacing · bulleted list, numbered
list (pressed inside one), decrease and increase indent (list levels, else half-inch stops) ·
New comment (with `comments`: on the selection, written in the pane), Track changes (pressed while on), Show changes as (All markup, Simple markup, No markup),
previous and next change, Accept, Reject (the change at the caret or the selected ones),
Accept all, Reject all ·
undo, redo · Table (a menu), Table style (a box of the document's table styles and Word's Table
Grid), Shading (a menu of light cell fills; both in a table, not while tracking) · Picture… (a dialog) · page break · Section, Header (menus) · Controls (a menu: rich text, plain text, drop-down list, combo box, date picker, check box, picture around a selected one, repeating section, Add repeating item, Control properties… (a dialog: title, tag, the two locks, list items, date format, line breaks)) · Fields (a menu: page number, date, Cross-reference… (a dialog of the document's headings and bookmarks), table of contents, update the selected fields or all of them, show field codes). A pointer pick in a box calls `onClickCommand`, like a button click.
Up and Down on a closed box apply each value they pass (Chrome and Firefox on Windows), one
undo step each. Text color and highlight are menu buttons (WAI-ARIA menu, `menuitemradio`
items) with a fixed palette (Word's highlight colors), the current color checked; arrow keys,
Home and End move, Enter picks, Escape closes back to the button. The alignment buttons show
the selection's alignment pressed (none when mixed).
A WAI-ARIA toolbar: one Tab stop, arrow keys, Home and End move between buttons; toggle buttons
have `aria-pressed`; buttons stay focusable when disabled (`aria-disabled`). Clicking a button
keeps the document's selection.

Link (pressed in a link) and Mod-K in the document open the link dialog under the toolbar
(`.foli-link-dialog`, `role="dialog"`, "Add link" or "Edit link"): a URL field prefilled with
the link at the selection, Apply (Enter), Remove link (for an existing link), Cancel (Escape).
The URL is normalized (`normalizeHref`) and validated: an unsafe one is not applied, the field
gets `aria-invalid` and an announced message. Closing returns the focus where it was (the
document, or the button). The toolbar opens the dialog for any `openLinkEditor` request, so
Mod-K needs a `FoliToolbar` for the editor; none opens while it is `disabled`.

Picture… (`upload` prop: where the file goes; `FoliEditor` passes its own) opens a dialog under
the toolbar (`.foli-picture-dialog`, `role="dialog"`). With nothing selected, "Insert picture":
an image file, its alt text (required unless "Decorative (no alt text)" is checked), Insert
and Cancel; the file is measured, uploaded and inserted at its natural size no wider than the
page's text (without `upload`, the button is disabled). With a picture selected, "Edit
picture": its alt text, decorative, and its width and height in px with "Keep proportions"
(the size disabled while changes are tracked), Apply and Cancel. A field that is wrong is
marked (`aria-invalid`) with an announced message; Escape cancels; a change to the document or
the selection closes it. This is also the keyboard way to resize a picture.

Section is a menu button of the same kind: Page setup…, section breaks (next page, continuous,
even page, odd page), Remove section break, Column break. Page setup… opens a dialog under the
toolbar (`.foli-setup-dialog`, `role="dialog"`, "Page setup") for the caret's section: how it
starts, orientation (swapping width and height), page size and margins in centimetres, columns,
the space between them, a line between them and set widths. Only what changed is applied; a wrong
value marks its field with an announced message; Apply (Enter), Cancel (Escape).

Header is a menu button: Edit header, Edit footer, Close header and footer, and the checkbox items
Different first page, Different odd and even pages and Link to previous (with a story open). While
a story is open the toolbar's commands go to it.

Notes is a menu button: Insert footnote and Insert endnote (the caret goes into the new note), Go
to note or reference, Convert footnotes to endnotes and back, and Note options…, a dialog
(`.foli-table-dialog`, "Note options"): which notes, position, number format, start (for numbers
that do not restart) and numbering; Apply (Enter), Cancel (Escape). It applies to the whole document.

Table is a menu button (WAI-ARIA menu: `menuitem` items, "Repeat as header row" a
`menuitemcheckbox` checked when the selection's rows are header rows): Insert table…, insert row
above or below, insert column left or right, delete rows, columns or the table, merge cells,
split cell. An item that cannot apply at the selection is `aria-disabled` (still focusable);
arrow keys, Home and End move, Enter runs, Escape closes back to the button. Insert table… opens
a dialog under the toolbar (`.foli-table-dialog`, `role="dialog"`, "Insert table"): Rows (1 to
1000) and Columns (1 to 63), Insert (Enter), Cancel (Escape). A number out of range marks its
field (`aria-invalid`) with an announced message, as does a caret where no table can go. Insert
closes it and calls `onClickCommand` (the focus goes to the document, where the table is);
Cancel returns the focus to the Table button. A change to the document or the selection closes
it, and only one of the link and insert table dialogs is open at a time.

| Prop             | Type         | Default        | Notes                                                               |
| ---------------- | ------------ | -------------- | ------------------------------------------------------------------- |
| `editor`         | `Editor`     | context        |                                                                     |
| `disabled`       | `boolean`    | `false`        | Pass it whenever the canvas is `readOnly`.                          |
| `onClickCommand` | `() => void` | —              | After a click ran a command (`FoliEditor` focuses its canvas here). |
| `label`          | `string`     | `"Formatting"` | Accessible name.                                                    |
| `className`      | `string`     | —              | Added to `.foli-toolbar`.                                           |

### Hooks and provider

- `useFoliEditor({ initialContent?, plugins?, extensions?, author?, trackChanges?, reviewView? }): Editor`:
  creates an editor on the first render
  (`initialContent` of any version, migrated; default an empty document) and keeps it for the
  component's lifetime. Later option changes are
  ignored. Throws `FoliDocumentError` for invalid content.
- `<FoliEditorProvider editor={editor}>`: makes `editor` the one the components and hooks
  below it use.
- `useCurrentEditor(): Editor`: the nearest provider's (or `FoliEditor`'s) editor. Throws
  outside one.
- `useEditorState(selector, { editor?, isEqual? })`: a slice of the state; the component
  re-renders only when it changes (`isEqual`, default `Object.is`). The selector
  `(state, editor) => T` runs after every transaction: keep it cheap.

## `@folijs/core`

No DOM: runs in Node, workers and the browser.

### Documents

Documents are schema v5, Word's model with tables, pictures, stories, fields and content controls ([document-model.md](document-model.md)).

- `createDocument(content?, section?): FoliDocument`: a new document: `content` (schema v5;
  default: one empty paragraph) on A4 with 25.4 mm margins, with Normal, Heading 1–6, List
  Paragraph and Hyperlink styles, bullet and number definitions, in 11 pt Georgia with 1.5
  lines (the look a migrated 0.2.0 document has). `section` is in twips (`mmToTwips(mm)`) and
  merged over that page (`pageSize` and `margins` part by part). Not validated. (0.2.0's took
  v2 content and millimetre settings; to start from those, pass
  `{ schemaVersion: 2, settings, content }` to `parseDocument` or the editor.)
- `parseDocument(input: unknown, options?: ParseOptions): FoliDocument`: validates untrusted input (e.g. parsed JSON)
  and returns a copy in canonical form; a document saved by 0.1.0 to 0.5.0 is validated as
  such and migrated (`migrateToV3`, `migrateToV4`, `migrateToV5`). Throws `FoliDocumentError`, whose message
  names the place (`content.content[2].marks[0].type: …`) and says when a newer Foli saved the
  document; never drops content silently. `ParseOptions`: `extensions`, the custom node and
  mark types the document may hold ([below](#custom-nodes-and-marks)); a custom type none of them
  declares is kept as it is. `parseContent(json, { path?, fragment?, extensions? })` parses
  content alone into a `doc` node, with Word's table rules (`ContentOptions`: `ParseOptions` plus
  the path errors name and whether it is content to paste, which a table may end).
- `FoliDocument`: `{ schemaVersion: 5, section, defaults, styles, numbering, theme?, comments,
  resources?, stories?, controls?, settings?, content }` and its parts (`SectionJSON`, `StyleJSON`, `TablePropertiesJSON`,
  `RowPropertiesJSON`, `CellPropertiesJSON`, `TableConditionJSON`, `MeasureJSON`,
  `ResourceJSON`, `StoryJSON`, `ControlJSON`, `WordSettingsJSON`…), in Word's units (twips; EMU
  for pictures). `FoliDocumentV3` and `FoliDocumentV4`: schema 3 and 4 documents.
- `SCHEMA_VERSION` (5), `HIGHLIGHT_COLORS`, `JUSTIFICATIONS`, `TABLE_CONDITIONS`, the unit
  conversions (`twipsToMm`, `mmToTwips`, `twipsToPt`, `ptToTwips`, `twipsToPx`,
  `halfPointsToPt`, `TWIPS_PER_INCH`, `TWIPS_PER_POINT`). Internal: `schema` (the Word content
  schema; an editor's is `state.schema`), `checkSection`, `checkControl`, `RUN_PROPERTY_MARKS`.
- `isSafeHref(href)` and `isColor(color)`: the rules links and colors from outside a document
  must follow.
- `PAGE_SIZES` (`A4`, `Letter`), `DEFAULT_SETTINGS` and `DocumentSettings`: page geometry in
  millimetres, what `editor.settings` gives.
- Schema v2, kept to read 0.2.0 documents and pasted HTML: `FoliDocumentV2`, `parseContentV2`,
  `migrateToV3(document)`, and its JSON types (`DocJSON`, `ParagraphJSON`, `HeadingJSON`,
  `TextJSON`…, with `MARK_TYPES`, `SIMPLE_MARK_TYPES`, `HEADING_LEVELS`, `ALIGNMENTS`).

### Custom nodes and marks

An app adds its own node and mark types to the Word schema with an `Extension` (ADR-0008):
`{ name, nodes?, marks?, plugins? }`, given to `createEditor({ extensions })`,
`parseDocument(document, { extensions })` and `exportDocx(document, package, { extensions })`.

- Type names have a namespace: `<namespace>:<name>`, lowercase letters, digits and `-`
  (`acme:mention`). A name without one, or declared twice, throws a `RangeError` when the editor
  is made. Word's types never have a colon.
- A node (`ExtensionNodeSpec`) is a leaf: inline (`inline: true`, group `inline`) or a block
  (group `block`); no `content`. Its `attrs` are as in `NodeSpec` (`validate` each), and
  `text(attrs)` is the text it stands for: plain text on the clipboard, what find matches, its
  text in `.docx`, how the view draws it without a node view. A mark is a `MarkSpec`.
- Stored as ordinary node and mark JSON by type name ([document-model.md](document-model.md#custom-nodes-and-marks)).
  Custom types never change `SCHEMA_VERSION`.
- **Without its extension** a custom type is never dropped: it loads as a foreign node
  (`foreignInline`, `foreignBlock`, drawn as its type in brackets, selected and deleted whole) or
  a foreign mark, its attributes checked only as plain JSON (64 KiB at most), and is saved back
  by `getDocument`, `parseDocument` and `exportDocx` as it was. Pasted into an editor that has the
  extension, it is the custom type again.
- Find matches a custom node's `text(attrs)` as one position; replace leaves it (`locked`).
  Inserting or deleting one while tracking is a tracked change, accepted or rejected as text is.
- Extensions' `plugins` run after `EditorOptions.plugins`, before the built-ins.
- `editor.extensions` is the list the editor was made with (its stories' editors have it too):
  how a view finds the view hooks of a `ViewExtension` ([`@folijs/view`](#view-extensions)).

### Formatting (internal)

This whole section is internal (`@folijs/core/internal`): the renderers and `.docx` use it.

- `new Resolver(document)`: a document's effective formatting, as Word computes it.
  `paragraph(attrs)` gives a paragraph's properties (`ParagraphFormat`) and the formatting of its
  text (`RunFormat`); `run(paragraphRun, marks)` a run's; `markers(paragraphs)` the list markers
  (`ListMarker`: text, suffix, formatting) of a document's paragraphs in order.
  `table(attrs)` gives a table's properties over its style's (`TableFormat`);
  `cell(table, row, cell, place)` a cell's (`CellFormat`: the table style's parts that apply,
  shading, borders, margins, vertical alignment; `place` is a `CellPlace`), and
  `paragraph(attrs, cellFormat)` a paragraph's in that cell. `tableConditions(look, place)`
  lists the table style's parts that apply to a cell.
  `formatNumber(n, format)` writes a number in a Word number format.

### Editor

`createEditor({ document?, plugins?, extensions?, author?, trackChanges?, reviewView? }): Editor`: a headless editor (state, commands, undo
history, change notifications) of a Word's model document (schema v5). The document is
validated and, when saved by 0.1.0 to 0.5.0, migrated (`parseDocument`; default:
`createDocument()`); `setDocument` behaves the same way. `EditorDocument` is what both take:
`FoliDocument | FoliDocumentV2`. The editor keeps its styles, numbering and sections,
`getDocument()` returns a v5 document (a copy) and `settings` are its last section's page (`sectionSettings(section)`; Word's Letter page with
inch margins where the section leaves them out). The commands edit as Word does: Enter
leaves the section break and the paragraph's own attributes on the second paragraph, and at the
end of a paragraph whose style names a next style (a heading: Normal) starts that style;
`toggleMark` and `isMarkActive` for bold, italic, underline, strike, double strike, caps,
small caps and hidden act on what the text shows (turning bold off in a bold heading writes
"not bold"); Backspace and Delete step over bookmarks and comment ranges, and select a field,
content control or table before deleting it; joining paragraphs keeps the second one's section
break, and a paragraph left with nothing by a join or a deletion from its start is removed whole
(the next one keeps its properties, as in Word); typed text never takes a tracked-change mark (except its own `insertion` when tracking).

Tracked changes: `createEditor({ author?, trackChanges?, reviewView? })` (author default "Author"; tracking
off by default; a `.docx`'s setting is `DocxImport.trackRevisions`). With tracking on, every
edit the editor dispatches is rebuilt as Word records it (`trackTransaction(state, tr)`): what it
removes stays with a `deletion` mark and what it adds gets an `insertion` mark (author, date,
Word's next free id; typing on joins the change next to it); a paragraph mark removed or
added is recorded on the paragraph (`revision.deletion` / `revision.insertion`); deleting one's
own insertion removes it for real. The caret goes before what Backspace deleted, after what
Delete deleted. Formatting is recorded as Word records it: a run's properties before its first
tracked change on a `formatChange` mark (`previous`: run property marks), a paragraph's on its
`formatChange` attribute (`previous`: its properties, without the mark's look); later changes
keep that record, and one's own insertions record none. An edit that would delete
or insert a block Foli does not model (an opaque block) is not made while tracking; tables are
tracked row by row. Undo and redo, transactions with
`addToHistory: false` and those with the `untracked` meta are not tracked; an edit that cannot
be recorded is not made. `editor.commands.setTrackChanges(on, author?)` (the
`setTrackChanges` command), `editor.trackingChanges`, `trackState(state)` (`{ on, author, view }`).

Review view: how the editor's views show changes, kept in its state (`createEditor({
reviewView })`, `editor.commands.setReviewView(view)`, `setReviewView`, `trackState(state).view`):
`ReviewView` is `"markup"` (inserted text underlined, deleted text struck through, in the
author's color, a bar beside changed paragraphs), `"simple"` (the text as if accepted, with the
bar, in the editor's view; `renderDocument` draws none) or `"final"` (as if accepted). Deleted
text is hidden, not removed, so positions and editing are unchanged; the caret never goes into
it, next and previous change skip it. While tracking, and wherever it is hidden, Backspace and
Delete step over deleted text.

Comments (not tracked changes; each its own undo step): `editor.commands.addComment(content,
{ author?, initials? })` comments the selection (its range around it, the reference mark after
it; at a caret, a point; select-all, the whole text), `replyToComment(id, content, options?)`
(a reply to a reply answers the thread), `editComment(id, content)`, `resolveComment(id, done =
true)` (the whole thread), `deleteComment(id)`
(its replies and anchors too; false for a comment anchored inside content kept verbatim, an
opaque block, which stays), `deleteAllComments()` (threads anchored there kept); the same as commands. `content` is text
(a paragraph per line) or schema v3 blocks; the author defaults to the editor's. A comment whose
reference mark an edit removes goes too, with its replies (a tracked deletion keeps it until
accepted). `commentAnchors(doc)` gives each comment's range and reference positions.
Accepting and rejecting (not tracked themselves; each its own undo step; undo takes them back):
`editor.commands.acceptChange()` / `rejectChange()` (the changes at the caret, the paragraph's
recorded formatting only when no other is there; in a selection, the selected part of each), `acceptAllChanges(author?)` / `rejectAllChanges(author?)`, `nextChange()` /
`previousChange()` (select the change after or before the selection); the same as commands
(`acceptChange`, `rejectChange`, `acceptAllChanges(author?)`, `rejectAllChanges(author?)`,
`nextChange`, `previousChange`). `trackedChanges(doc)` lists the changes (`Change`: `kind`,
`id`, `author`, `date`, `from`, `to`, `move`) in document order: runs with one change mark,
paragraph marks inserted or deleted (their closing token), paragraphs' recorded formatting.
Accepting removes deleted content (a deleted paragraph mark joins the paragraph with the next,
keeping the first one's properties, or removes it whole when nothing of it is left) and drops records; rejecting removes inserted content (an
inserted paragraph mark joins it with the next, which keeps its own properties: the original
mark's), drops deletion records and restores recorded formatting. Both ends of a move go together.

Word formatting (these do not apply to a state without a v3 envelope). Run properties,
alignment and line spacing are written directly only where the styles do not already give the
value; space before and after and indents are always written. Built-in styles the document has
not used yet ("heading 1" to "heading 9", "List Paragraph", "Hyperlink") are added with Word's
definitions (the Word 2013 to 2019 template's) the first time they are applied, as Word does:

- Styles: `paragraphStyles(state)` (the document's paragraph styles, the default first, then
  Word's Heading 1 to 3 if missing), `paragraphStyleAt(state)`, `setParagraphStyle(id)` (an id
  the document has, or `Heading1`–`Heading9`, `ListParagraph`). `setBlockType("heading",
  { level })` uses the document's "heading N" style, `setBlockType("paragraph")` the default
  style.
- Text: `setFontFamily(name | null)`, `fontFamilyAt(state)`, `setFontSize(points | null)`,
  `fontSizeAt(state)` (the size applies to complex scripts too, as Word's size box does).
  `setTextColor` writes Word's color (null: "Automatic"); `setHighlight` writes one of Word's
  highlight colors (`HIGHLIGHT_HEX`) as a highlight and any other color as a plain shading fill;
  null removes the highlight and a plain fill (patterned shading stays).
- Paragraphs: `setAlign` writes Word's justification; `setLineSpacing(multiple | null)`,
  `lineSpacingAt(state)`, `setParagraphSpacing({ before?, after? })` in points (turning that
  side's auto spacing off), `changeIndent(1 | -1)` (a list level for a numbered paragraph, only
  to a level its list defines, and a numbered heading takes that level's style; else the next
  half-inch stop), `canOutdent(state)`.
- Lists are Word's numbering: `toggleList` / `wrapInList` number the paragraphs (a list of the
  kind right before goes on; otherwise bullets share one definition and a numbered list starts
  at 1 in a new instance; definitions are added to the document's numbering), and put Normal
  paragraphs in "List Paragraph"; `listKindAt(state)` gives `"bulletList"`, `"orderedList"` or
  null. Tab at a list paragraph's start goes a level deeper (over several paragraphs it indents
  them), Shift+Tab a level up (out of the list at the top), Enter in an empty list paragraph a
  level up (at the top it ends the list), Backspace at its start removes the number. Elsewhere
  Tab types a tab (`insertTab`); in the view, Escape then Tab (or Shift+Tab) moves the focus on
  instead, and a read-only view leaves Tab to the browser.
- Links get the document's "Hyperlink" character style, removed with the link.
- Clipboard (internal; the view uses these): `copiedDefinitions(context, content)` gives the styles,
  numbering and comments copied content references, with the document's id
  (`wordContext(state).id`, which tells a copy inside the document from one from another); `fitPaste(state, content, definitions?)`
  validates pasted v3 content and definitions (none: the document's own, but unsafe links are
  dropped) and returns
  `{ doc, envelope }`, the content fitted to the document and its envelope with what it added;
  `fitPastedV2(state, content)` does the same for schema v2 content (pasted HTML). Apply the
  envelope with `withEnvelope(tr, envelope)` and its comments with
  `setComments(tr, current.comments, envelope.comments)` (`withEnvelope` ignores comments: they
  change only through `CommentStep`s, which undo and redo take back); `wordContext(state)` gives
  the current one. `WordContext`, `WordEnvelope`, `FittedPaste`, `WordDefinitions`, `Story`,
  `StoryStep` and `EnvelopeStep`, named elsewhere on this page, are internal too.

| Member                         | Notes                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                        | Current immutable `EditorState` (`state.doc`, `state.selection`).                                                                                                                                                                                                                                                             |
| `settings`                     | Page size and margins (mm) of the current document's last section (the view lays each section out with its own).                                                                                                                                                                                                              |
| `commands.*`                   | Run a command, return whether it applied: `insertText(text)`, `deleteSelection()`, `deleteBackward(unit?)`, `deleteForward(unit?)`, `joinBackward()`, `joinForward()`, `splitBlock()`, `insertHardBreak()`, `insertPageBreak()`, `toggleMark(type, attrs?)`, `setBlockType(type, attrs?)`, `selectAll()`, `undo()`, `redo()`. |
| `isMarkActive(type)`           | Whether the mark is active at the selection (or stored for the next typed text).                                                                                                                                                                                                                                              |
| `select(anchor, head?)`        | Places a text selection (positions clamped into the document).                                                                                                                                                                                                                                                                |
| `run(command)`, `can(command)` | Run any `Command`, or dry-run it. `can` builds the whole transaction: not per keystroke.                                                                                                                                                                                                                                      |
| `handleKey(key)`               | Runs the first bound command for a key name such as `"Mod-b"`.                                                                                                                                                                                                                                                                |
| `dispatch(tr)`                 | Applies a transaction (`state.tr`).                                                                                                                                                                                                                                                                                           |
| `getDocument()`                | The current document (`FoliDocument`).                                                                                                                                                                                                                                                                                        |
| `setDocument(doc)`             | Replaces the document and settings, clears undo history. Listeners get an empty transaction list.                                                                                                                                                                                                                             |
| `story(id)`                    | An `Editor` over a story (header, footer or note), null when there is none: its own selection, every change a step of this editor's history. `getDocument` gives the story as the content; `undo` and `redo` are the document's.                                                                                              |
| `storyView`                    | Set by the view showing the pages: `open` (the story open there: `id`, `side`, `variant`, `section`), `edit(side, page?)`, `editNote(id?)`, `toReference()`, `close()`, `fieldLayout` and `updateFields(options?, editor?)` (fields, from its pages). `storyChanged()` tells listeners it changed.                            |
| `subscribe(listener)`          | `(state, transactions) => void` after every change (selection included); returns unsubscribe. `transactions.some(tr => tr.docChanged)` tells content changes apart.                                                                                                                                                           |
| `extensions`                   | The extensions it was made with (`EditorOptions.extensions`); a view reads its node views, mark views, decorations and plugin views from them.                                                                                                                                                                                |

Headers and footers: `ensureStory(side, variant, section)` makes one where none shows,
`setStoryLinked(side, variant, linked, section?)` links a section's to the previous section's or
unlinks it with a copy, `setDifferentFirstPage(on, section?)`, `setDifferentEvenPages(on)`.
`documentSections(state)`, `storyOfSection(sections, index, side, variant)` and
`pageVariant(section, page, evenAndOdd)` say which story a page shows.

Notes: `insertNote(kind = "footnote", { customMark? })` adds the reference and the story (one undo
step, Word's `footnote text` and `footnote reference` styles made when missing; not in a story);
`setNoteProperties(kind, { position, format, start, restart })` sets them for the whole document;
`convertNotes(to, story?)` turns notes into the other kind. `noteNumbers(doc, envelope, { pageOf,
hideDeleted })` gives each reference's number, `noteTexts(numbers)` them by story,
`noteAtSelection(state)` the reference at the selection, `noteProperties(envelope, kind, section?)`
what is in force. Deleting a reference deletes its note in the same transaction; while tracking
both are recorded, as Word does, and settled together.

Headings: `setBlockType("heading", { level: 2 })`; back to text: `setBlockType("paragraph")`.
Lists: `commands.toggleList("bulletList" | "orderedList")` (removes the selection's numbering
when it is a list of that kind, else numbers it), `wrapInList(kind)`, `indentListItem()` and
`outdentListItem()` (Tab and Shift+Tab). Links: `commands.setLink(href)` (links the selection, replacing
links there; at a caret in a link, changes that link; elsewhere inserts the href as linked
text) and `removeLink()` (the links in the selection, or the whole link around the caret). Both
normalize then validate: an unsafe href (`javascript:`…) does not apply. Formatting:
`commands.setAlign("start" | "center" | "end" | "justify")` (`start` is the default),
`setTextColor(color | null)` and `setHighlight(color | null)` (`#rrggbb`; null removes; at a
caret, for the next typed text). `toggleMark("link", { href })` refuses an unsafe href too.

### Commands

Commands are `(state, dispatch?) => boolean` and run with `editor.run(command)`:
`insertText(text)`, `deleteSelection`, `deleteBackward(unit?)`, `deleteForward(unit?)` (unit
`"char"` or `"word"`), `joinBackward`, `joinForward`, `splitBlock`, `insertHardBreak`,
`insertPageBreak`, `selectAll`, `toggleMark(type, attrs?)`, `setBlockType(type, attrs?)`,
`undo`, `redo`; lists: `toggleList(kind)`, `wrapInList(kind)`, `splitListItem` (Enter in an
empty list paragraph), `sinkListItem` (Tab), `liftListItem` (Shift+Tab), `liftListItemAtStart`
(Backspace at a list paragraph's start), and `listKeymap()` binding them (part of every editor,
before `baseKeymap()`); formatting: `setAlign(align)`, `setTextColor(color)`,
`setHighlight(color)`, and `arrowAcrossLeaf(dir, from)` (arrow keys around an opaque block:
`"char"` from a caret at a paragraph edge, `"line"` when the caret is on its first or last
line, `"none"` only from a selected block); links: `setLink(href)`, `removeLink`,
`insertLink(href, text?)` (replaces the selection with linked text), `openLinkEditor` (Mod-K:
dispatches a transaction that changes nothing and carries `linkEditorRequest`; check it with
`requestsLinkEditor(tr)` to open your own link UI). `normalizeHref(input)` trims, turns `\` into
`/`, percent-encodes spaces, and adds `mailto:` to an email address and `https://` to a host
name (`example.com/page`; a relative file name like `page.html` becomes one too: write
`./page.html`); `autolinkHref(text)` is the href for pasted text that is one URL
(`http(s)://…`, `mailto:…`, `www.…`), or null. Helpers: `isMarkActive(state, type)`,
`listKindAt(state)`, `linkAt(state)` (the href of the link at the selection, or null),
`alignAt(state)` and `colorAt(state, "textColor" | "highlight")` (shared by the whole
selection, else null),
`undoDepth(state)`, `redoDepth(state)`,
`marksAt`. `baseKeymap()` is the default key binding plugin (keys in
[getting-started.md](getting-started.md#keyboard)).

Sections (11.6, schema v3 and later): `insertSectionBreak(kind)` (`nextPage`, `continuous`,
`evenPage`, `oddPage`; at the selection's start, in a body paragraph), `removeSectionBreak` (the
break ending the caret's section; in the last section, the one before it), `setSectionSetup({
pageSize, margins, columns, type })` (the caret's section; `pageSize` and `margins` merge, refused
when no room for text is left), `insertColumnBreak`; `sectionAt(state)` (`setup`, `pos`, `index`,
`count`), `sectionColumns(section)` (widths and spaces in twips). Undo takes all of them back, the
last section's setup through `EnvelopeStep`. While tracking they are recorded as Word records
them: an inserted or deleted paragraph mark, `w:sectPrChange` for a setup; `trackedChanges(doc,
section)` lists those as `sectionFormatting`, and accepting and rejecting resolve them.

Tables (on the table around the selection: a cell selection's rectangle, or the caret's cell):
`insertTable(rows, columns)` (Word's Table Grid style, up to 1000 rows and 63 columns),
`insertRow(dir)`, `deleteRows`, `insertColumn(dir)`, `deleteColumns`, `deleteTable`,
`mergeCells`, `splitCell`, `toggleHeaderRow` (`isHeaderRow(state)`), `setTableStyle(name |
null)` (`tableStyles(state)`, `tableStyleAt(state)`), `setCellShading(fill | null)` (`RRGGBB`),
`setColumnWidth(tablePos, column, twips)`; `CellSelection`, `extendCellSelection(axis, dir)`,
`goToCell(dir)`, `goToCellVertically(dir)`, `cellsAsTable(selection)`, `pasteCells(tr, table)`.
Rows inserted and deleted while tracking are tracked; column, merge, split, header, style,
shading and width commands do not apply while tracking.

Pictures: `insertPicture({ contentType, url? | data?, width, height, alt?, title?,
decorative? }, { requireAlt = true })` (size in EMU; alt text required unless `decorative` or
`requireAlt: false`, which the view uses for pasted and dropped files; the image becomes a new
resource of the document; tracked while tracking), `setPictureSize(pos, width, height)` (not
while tracking), `setPictureAlt(pos, alt, decorative?)`, `selectedPicture(state)` (a node
selection of a picture, and its position).

Fields (11.8, ADR-0007; markers in the model, see
[document-model.md](document-model.md)). `updateFields(editor, { layout, data, now, only })` works
results out and writes them in one transaction, one undo step, recorded as tracked changes when
tracking is on (a story's change is a `StoryStep` of it), and returns `{ updated, unchanged, rebuilt,
skipped }`. Locked fields stay; a field left as it was is in `skipped`, with its `instruction`, its
`story` and why (`locked`, `unknown`, `no-layout`, `no-data`, `missing-bookmark`,
`unsupported-switch`, `self-reference`, `failed`, `untrackable`). `layout` is a `FieldLayout` (`pages`, `pageAt(pos)`: `number`,
`sectionPages`, `format`), what `view.updateFields` passes: without one, page fields keep their
results. `data`: `MERGEFIELD` values by name (any case; left alone without it); `now`: for `DATE` and
`TIME`; `only`: a range of the editor's tree (a caret: the field around it) or a function of the
`Field`, else every field of the body and the stories. `PAGE`, `NUMPAGES` and `SECTIONPAGES` in a
story are never written: the view draws them page by page.

| Field                                     | Honours                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| every one                                 | `\*` `MERGEFORMAT` (the old result's first run's look; without it the code's), `CHARFORMAT`, `Arabic`, `ArabicDash`, `ROMAN`, `roman`, `ALPHABETIC`, `alphabetic`, `Ordinal`, `Hex`, `Upper`, `Lower`, `FirstCap`, `Caps`; `\#` numeric pictures (`0`, `#`, `x`, `,`, `.`, `+`, `-`, `'text'`, `;` sections) |
| `PAGE`, `NUMPAGES`, `SECTIONPAGES`        | the section's number format for `PAGE`                                                                                                                                                                                                                                                                       |
| `DATE`, `TIME`                            | `\@` date pictures (English names)                                                                                                                                                                                                                                                                           |
| `SEQ id [bookmark]`                       | `\c`, `\n`, `\r n` (the first written counts), `\s level`, `\h` (shown again by a `\*` number format)                                                                                                                                                                                                        |
| `REF name` (or the bookmark's name alone) | `\h`, `\n`, `\r`, `\w`, `\p`, `\t`; without a number switch, the bookmark's text with its formatting                                                                                                                                                                                                         |
| `PAGEREF name`                            | `\h`, `\p`                                                                                                                                                                                                                                                                                                   |
| `TOC`                                     | `\o`, `\u`, `\t`, `\h`, `\z`, `\n`, `\b`, `\p`, `\w`, `\x`; styles `TOC1`-`TOC9` made as Word's when missing, `_Toc` bookmarks, a right tab with dots, nested `PAGEREF`s                                                                                                                                     |
| `MERGEFIELD name`                         | from `data`: `\b`, `\f` (only around a value), `\@`, `\#`                                                                                                                                                                                                                                                    |

Inserting, each one undo step: `insertField(instruction, { result?, layout?, data?, now? })`,
`insertPageNumber(options?)`, `insertDate(picture = "d MMMM yyyy", options?)`,
`insertCrossReference({ to, show: "text" | "page" | "number", link = true, layout? })` (`to`: a
bookmark's name or a heading's position; a heading gets a `_Ref` bookmark),
`crossReferenceTargets(state)` (`bookmarks`, `headings`), `insertTableOfContents({ from = 1, to = 3,
hyperlinks = true, layout? })` (in a paragraph of its own; not in a story). Reading:
`fieldsIn(tree)` (`from`, `to`, `separator`, `codeEnd`, `resultFrom`, `resultTo`, `instruction`,
`name`, `result`, `locked`, `deleted`, `parent`, `inCode`), `fieldAround(tree, pos)`,
`parseFieldInstruction(text)`, `formatDatePicture(date, picture)`,
`formatNumericPicture(value, picture)`; `fieldDisplay(paragraphs, codes)` (what a renderer hides),
`fieldCodesShown(state)`, `toggleFieldCodes`. A selection crossing a field's markers takes the whole
field; Backspace or Delete at its edge selects it first, as in Word. A caret put at the very start
or end of a result goes just outside the field, so what is typed there is not lost to an update.
A table of contents lists paragraphs by their style's level (a heading style, a style based on one,
a style with an outline level) and, with `\u`, by their own outline level; hidden text is left out.

Content controls (11.9, ADR-0007). `editor.commands.setControlValue(target, value)` fills the
controls with that id or tag, in the body and, from the body's editor, the stories, as one undo
step, tracked when tracking is on; it returns whether any took it. `value`: text; a list item's
value or shown text (a combo box takes any text, a drop-down list only its items); a `Date` or
`yyyy-mm-dd`; `true` or `false` for a check box; `{ content: NodeJSON[] }` for rich text; `null` or
`""` empties it, bringing its placeholder back. A locked or bound control refuses.
`editor.controlValues()` reads them all (`controlValues(state)`: one tree): `id`, `kind`, `tag`,
`title`, `story`, `showingPlaceholder`, `text`, `value`, `content` (rich text).

| Command                                 | Does                                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `insertControl(kind, options?)`         | At the caret, around selected text or paragraphs; `title`, `tag`, `lock`, `items`, `dateFormat`, `placeholder`, `checked`, `multiLine` |
| `setControlValue(target, value, join?)` | The command behind `editor.commands.setControlValue`, for one tree                                                                     |
| `setControlProperties(target, patch)`   | `title`, `tag`, `lock`, `items`, `dateFormat`, `multiLine`; allowed on a locked control                                                |
| `addRepeatingItem(target?)`             | A copy of the caret's (or the last) item of a repeating section                                                                        |
| `insertControlText(text)`               | Text into a plain text, combo box or date control: what paste uses                                                                     |

`controlsIn(tree)`, `controlAt(tree, pos)` (`id`, `level`, `from`, `to`, `contentFrom`, `contentTo`),
`controlProperties(state, id)` and `controlIsReadOnly(control)` find them.

Find and replace (11.11), by the rules Word was seen to follow (ADR-0007):

| Function                                     | Does                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `findAll(editorOrDocument, query, options?)` | `FindMatch[]` (`story`, null for the body; `from`, `to`; `text`), the body then each story. `matchCase`, `wholeWord` |
| `replace(editor, match, text, options?)`     | One match, the caret after it                                                                                        |
| `replaceAll(editor, query, text, options?)`  | Every match, in every story: one undo step, tracked when tracking is on                                              |
| `nextMatch(editor, matches, backward?)`      | The match after (before) the selection, around the end                                                               |
| `findInText(text, query, options?)`          | The same matching over a plain string: `[from, to]` pairs                                                            |

What is found is what shows: a field's code only while codes are shown (its result then not), text
deleted as a tracked change only in the `markup` review view, no control's placeholder, no hidden
text, no page number a story's page draws. A match runs across runs, formatting, field markers,
bookmarks and comment anchors, not across a note reference, a picture or a paragraph end. Both
replacing functions return `{ replaced, refused: [{ match, reason }] }`; nothing is skipped silently.
`reason`: `locked` (a locked or bound control), `control` (what the control's kind does not take, or
over its edge), `field` (over the edge of a field's result), `field-code`, `deleted`, `stale`,
`refused`. The replacement takes the first matched character's formatting and, unless `matchCase`,
its capitals (`hello` over `Hello` gives `World` for `world`, over `HELLO` `WORLD`). A tab and a line
feed in it make a tab and a line break. Bookmarks and comment anchors inside a match stay.
Regular expressions are not offered: a pattern can hang the page.

Bookmarks and the outline:

| Function                                      | Does                                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insertBookmark(editor, name, range?)`        | Over the selection or `range` of that editor's tree (a caret: a point). A name in use, in any case or story, moves it                                      |
| `renameBookmark(editor, name, next)`          | With the `REF`, `PAGEREF`, `NOTEREF` and links that point at it                                                                                            |
| `deleteBookmark(editor, name)`                | Whichever tree it is in; true when it went                                                                                                                 |
| `listBookmarks(editorOrState, options?)`      | `name`, `story`, `from`, `to`, `text`, `hidden`; `{ hidden: true }` adds Word's own (`_Toc…`, `_Ref…`)                                                     |
| `isBookmarkName(name)`                        | A letter, then letters, digits and `_`, 40 at most                                                                                                         |
| `goTo(editor, { story, from, to }, options?)` | Selects it and shows it, through the view when there is one (`focus`: the document takes the focus)                                                        |
| `documentOutline(state, layout?)`             | `pos`, `level`, `text`, `number`, `page` (with `editor.storyView.fieldLayout`): the body's headings, by the rule of a table of contents with `\o` and `\u` |

The first three return `{ ok: true, bookmark }` or `{ ok: false, reason }` (`invalid-name`,
`no-place`, `missing`, `exists`, `refused`), except `deleteBookmark`. Bookmarks are not tracked, as
in Word; each change is one undo step.

### Model, state and plugins

Stable, for plugins and code that edits documents directly:

- Model: `Node` (and `TextNode`), `Fragment`, `Slice`, `Mark`, `ResolvedPos`, `NodeRange`,
  `Schema`, `NodeType`, `MarkType`, `ContentMatch`, `NodeSpec`, `MarkSpec`, `SchemaSpec`,
  `AttributeSpec`, `AttributeSpecs`, `Attrs`, `NodeJSON`, `MarkJSON`, `SliceJSON`,
  `ReplaceError`.
- State: `EditorState`, `EditorStateConfig`, `Transaction`, `Command`, `Plugin`, `PluginKey`,
  `PluginSpec`; selections: `Selection`, `TextSelection`, `NodeSelection`, `AllSelection`,
  `CellSelection`, `SelectionJSON`.
- Transforms: `Transform`, `TransformError`, `Step`, `StepResult`, `ReplaceStep`,
  `ReplaceAroundStep`, `AddMarkStep`, `RemoveMarkStep`, `NodeMarkupStep`, `NodeMarkupBatchStep`,
  `StepMap`, `Mapping`, `Mappable`, `MapResult`; `canJoin`, `canSplit`, `findWrapping`,
  `liftTarget`, `NodeTypeWithAttrs`.
- History: `history(options?)` (`HistoryOptions`: `newGroupDelay`, `depth`), the `closeHistory`
  and `joinHistory` transaction metadata, `undo`, `redo`, `undoDepth`, `redoDepth`; a
  transaction's `addToHistory`. The plugin's state is internal. Of the built-in plugins only
  `history()`, `baseKeymap()` and `listKeymap()` are exported (ADR-0008).
- The option, result and JSON types of the functions on this page are stable with them:
  `EditorOptions`, `Extension`, `ExtensionNodeSpec`, `ParseOptions`, `ContentOptions`, `EditorListener`, `DocumentTarget`, `NavigationRequest`, `FoundMatches`,
  `OpenStory`, `StoryView`, `DeleteUnit`, `CommentContent`, `CommentOptions`, `ChangeKind`,
  `ChangeFilter`, `ControlInsertOptions`, `ControlPropertiesPatch`, `ControlRange`,
  `ControlValue`, `ControlValueInput`, `CrossReference`, `CrossReferenceTargets`,
  `FieldDisplay`, `FieldInstruction`, `FieldPage`, `FieldSkip`, `FieldSkipReason`,
  `FindOptions`, `ReplaceRefusal`, `ReplaceReport`, `InsertFieldOptions`,
  `TableOfContentsOptions`, `UpdateFieldsOptions`, `InsertNoteOptions`, `NoteKind`,
  `NoteNumber`, `NoteNumberOptions`, `NewPicture`, `BookmarkInfo`, `BookmarkResult`,
  `OutlineEntry`, `SectionAt`, `SectionBreakKind`, `SectionColumns`, `SectionSetup`,
  `StorySide`, `StoryVariant`, `TrackState`, `ListKind`, `Alignment`, `Justification`,
  `PageSize`, `PageMargins`, `TableCondition`; the document's parts `AbstractNumberingJSON`,
  `BorderJSON`, `CommentJSON`, `NotePropertiesJSON`, `NumberingInstanceJSON`,
  `NumberingLevelJSON`, `ParagraphPropertiesJSON`, `ThemeJSON`; schema v2's `BlockJSON`,
  `InlineJSON`, `BulletListJSON`, `OrderedListJSON`, `ListItemJSON`, `HorizontalRuleJSON`,
  `PageBreakJSON`, `HardBreakJSON`, `TextJSON`, `SimpleMarkJSON`, `LinkMarkJSON`,
  `ColorMarkJSON`, `MarkName`, `MarkNameJSON`, `SimpleMarkName`, `HeadingLevel` and
  `SAFE_LINK_PROTOCOLS`. `addComment` is the command behind `editor.commands.addComment`.

### Internal: `@folijs/core/internal`

What the other Foli packages need from core without a promise (they are installed at one version,
as exact peer dependencies, so each runs with the core it was built with). Not for apps: any
release may change it.

- The Word context and envelope: `wordContext`, `WordContext`, `WordEnvelope`, `withEnvelope`,
  `setComments`, `Story`, `StoryStep`, `CommentStep`, `EnvelopeStep`, `EnvelopeKey`.
- The formatting resolver: `Resolver`, `ParagraphFormat`, `RunFormat`, `ListMarker`,
  `TableFormat`, `CellFormat`, `CellPlace`, `tableConditions`, `formatNumber`.
- Clipboard fitting: `copiedDefinitions`, `fitPaste`, `fitPastedV2`, `FittedPaste`,
  `WordDefinitions`.
- The view's layout and editing helpers: `caretStop`, `sameSpot`, `controlSpot`,
  `keepTablesApart`, `noteKindOf`, `referencesIn`, `typedMarks`, `deleteSelectionKeepingTables`.
- The Word schema and validation, for `.docx`: `schema`, `checkSection`, `checkControl`, `Check`,
  `RUN_PROPERTY_MARKS`.
- `documentJSON(envelope, doc)`: an editor's document as apps get it (`getDocument`, React's
  `onChange`), foreign types written back.
- Custom types: `CUSTOM_TYPE` (the name pattern), `foreignTextOf` and `withForeignText` (the
  text a `.docx` control showed for a custom node, carried on its JSON in memory, never saved).

## `@folijs/view`

The editable view without a framework. Needs a browser DOM. Peer dependency: `@folijs/core` at
exactly its own version (after 0.6.0). Content controls: it draws the frame
and title of the control the caret is in or the pointer is over; Alt+Down (or its button) opens a
list or date picker, Space or a click changes a check box, Left and Right stop at a control's edges.

```ts
const view = new EditorView(host, editor, { editable: true, placeholder: "" });
```

`EditorViewOptions`: `editable`, `placeholder`, `resource`, `upload`, `paged`, `noteMark`.

- Makes `host` a `contenteditable` textbox (`role="textbox"`, `aria-multiline`) and renders the
  editor's state into it as `section.foli-page` elements sized from their section's page setup.
  Removes the host's children. Give the host an accessible name yourself.
- An editor holding a schema v3 document is shown as Word formats it (the blocks of
  `renderDocument`, list numbers, tracked changes as markup, opaque content shown and not
  editable) and laid out with Word's paragraph spacing and keep rules, each section on pages
  of its own setup (a section starts a new page unless it is continuous with the same setup). Copy writes the HTML as Word formats it (resolved formatting inline, headings, list
  numbers Word reads back) and Foli JSON with the styles, numbering and comments the content
  uses; paste fits Foli JSON, HTML and text to the document (`fitPaste`, `fitPastedV2`: its own
  styles by name, others added, lists of another document as lists of their own, comments
  copied, bookmarks whose names it has left out).
- `view.setOptions({ editable?, placeholder?, resource?, upload? })`: changes the given options.
  `upload(file)`: where pasted and dropped image files go (ADR-0006's upload hook), resolving to
  the URL the app stores the file at (or a `data:` URL, opting in) or `{ src, alt?, decorative? }`;
  without it image files are not pasted or dropped. `view.insertFiles(files)` inserts image files
  where the selection is now through it (that place mapped through changes made during the
  upload), at their natural size no wider than the page's text, and resolves to how many it
  inserted (never rejects: a failed upload is skipped, reported on the console); a picture
  inserted without alt text is marked.
  `resource(key, resource)`: the URL to show a picture's image from (`key` in the document's
  `resources`); undefined for a key: the resource's own image `data:` URL or web/`blob:` URL,
  else a box of the picture's size with its alt text; `null` (or "") for a key: that box. A web
  URL in a JSON document is fetched as soon as it is shown (with no referrer): an app that
  must not fetch them returns `null` for such resources. A new resolver draws every picture
  again (after a running composition, the selection kept); `resource: null` clears it.
- Pictures are drawn in their line at their size (96 px per inch), as `img` (with their alt
  text; a decorative one an empty alt) inside a non-editable span, one position in the text;
  one without alt text and not decorative is named "Picture without alt text" (`NO_ALT_LABEL`)
  and marked (`data-foli-no-alt`, a dashed outline, not printed). A click selects a picture (a
  node selection, outlined); dragging the handle at its corner resizes it with its aspect ratio
  kept (`setPictureSize` on release; Escape cancels). An image pasted alone (no text: a
  screenshot) and image files dropped go in through `upload`.
- A floating picture (`float`) is drawn first in its paragraph and the lines go around it: square
  (tight and through as square) as a CSS float on its side, top and bottom as a float as wide as
  the paragraph, behind and in front of text absolutely positioned on its page (pages are
  `position: relative; isolation: isolate`). A click on it selects it at its place in the text
  (an empty anchor there); its outline and handle are on the picture.
- Every page shows its header and footer (`.foli-region`, `.foli-header`, `.foli-footer`), page
  fields filled. `view.openStory("header" | "footer", page?)` opens one for editing on its page (a
  double click in the page's margin does too; made if the page has none), `view.closeStory()`
  leaves it, as Escape and a press on the page do. Meanwhile the host has the class
  `foli-in-story`, is read-only and the text is dimmed; `view.focus()` focuses the story.
  `paged: false` (when the view is made) gives one flow without pages, what the open story uses.
- Footnotes sit at the foot of their references' pages, endnotes after the text. Double click a
  note or its reference's number, or press Shift+Alt+N at the reference, to edit the note where it
  is (`view.openNote(id?)`); Shift+Alt+N goes back to the reference, Escape to where the caret was.
  Ctrl+Alt+F and Ctrl+Alt+D insert a footnote and an endnote, as in Word.
- Fields show their results; a code range (a field nested in it too) is not drawn and the caret
  does not rest in it. A field the selection is in is shaded (`data-foli-field-selected`, not
  printed). F9 updates the field at the caret or those selected, Ctrl+A then F9 all of them;
  Alt+F9 shows and hides codes for the whole document, headers and footers too (results and
  paragraphs wholly inside them then take no room). `view.updateFields(options?, editor?)` does it
  from code: `updateFields` with this view's pages, then once more for what depends on the pages
  those results moved, in one undo step. `view.print()` updates every field and opens the browser's
  print dialog, which prints the pages `@folijs/pdf`'s `exportPdf` gives (the same print rules); a
  browser's own Print menu does not update them.
- Finding (11.11): `view.showMatches({ query, matchCase, wholeWord, matches, current, scroll })`
  marks
  matches (null: none) with the CSS Custom Highlight API (`::highlight(foli-find)` and
  `foli-find-current`): nothing is added to the DOM or the document, and it does not print. Only
  pages near the window carry marks. `view.reveal({ story, from, to }, { focus })` selects and
  scrolls there, opening a header, footer or note where it is and leaving it for the body;
  `view.goToPage(n, { focus })`. All three are on `editor.storyView` too. Ctrl+F, Ctrl+H, Ctrl+G,
  F3, Shift+F3 and Ctrl+Shift+F5 go to `editor.navigation` when something has set it, and are
  otherwise left to the browser.
- `view.focus()`: focuses the host, shows the editor's selection, scrolls it into view.
- `view.destroy()`: removes listeners, injected styles and the attributes it added; empties the
  host.
- Clipboard: copy writes Foli JSON (`FOLI_MIME`), HTML and plain text; paste prefers Foli JSON,
  then HTML (`htmlToDoc`, read as schema v2 `DocJSON`, never `innerHTML`: lists at any depth,
  Word and Google Docs lists, rules, safe links, colors, alignment; fitted with `fitPastedV2`),
  then text (`textToDoc`: one paragraph per line, fitted with `fitPaste`). Content with an
  opaque block at either end goes in as whole blocks at the caret (or replaces an empty
  paragraph). A copy holding custom nodes or marks also carries its Foli JSON in the HTML (a
  `data-foli-clipboard` attribute on a wrapping `div`, read back before the HTML itself), since
  some browsers (Firefox) give a paste only HTML and text; plain text gets a node's
  `text(attrs)`; the HTML has a custom node's text, not its node view.
  Plain text that is one URL (`autolinkHref`) becomes a link: over selected text inside one
  block that text is linked, otherwise the URL is inserted as linked text; not on paste as
  plain text (Ctrl/Cmd+Shift+V), nor when the clipboard holds Foli JSON.
  `view.paste(data, autolink = true)` pastes clipboard data from code.
- Links: a click places the caret (no navigation, read-only mode too); Ctrl+click (Cmd+click
  on Apple platforms) opens the link's href, read from the document, in a new tab with
  `noopener,noreferrer`.
- `keyName(event)`: the key name `handleKey` expects (`"Mod-b"`, `"Shift-Enter"`).
- `measureImageFile(file, doc)`: an image file's natural size in CSS px from a local object URL
  (null when the browser cannot show it); `textWidthEmu(state)`: the widest a picture is
  inserted, in EMU (the last section's text width: shortcut, not the caret's section);
  `EMU_PER_PX` (9525). For an app's own picture insert, as the toolbar's dialog does it.
- `renderDocument(document, container, { review?, resource?, fieldCodes? }): DocumentPages` (a read-only view, no
  editor; `RenderDocumentOptions`): lays a schema v3 document out on
  pages (`.foli-word-page`, `WORD_PAGE_CLASS`) appended to `container`, formatted as Word
  formats it. `review`: `"markup"` (default: insertions underlined, deletions struck through,
  in the author's color, titled "Inserted/Deleted by …, date"), `"simple"` or `"final"` (as if
  accepted; no change bar here: the editor's view draws it). `DocumentPages`: `pages`, `pageOf(index)` and `lineOf(index)`
  (where the top-level node at `index` starts: the page, 0-based, and the line on that page,
  1-based), `fieldLayout` (the pages as `updateFields` takes them: a position's page is the one
  its top-level block starts on), `printStyles()` (the editor's print rules for these pages, for a
  web page holding them alone), `destroy()`. Measures as it is called: render after the document's fonts have
  loaded (`document.fonts.ready`), into a container that is laid out and not scaled. See
  [architecture.md](architecture.md#word-pages-packagesviewsrcword-86b).

### View extensions

A `ViewExtension` is an `Extension` with view hooks (ADR-0008, 12.4). Give it to
`createEditor({ extensions })` (React: the `extensions` prop) like any extension; every
`EditorView` of that editor (a header, footer or note open on its page too) reads the hooks from
`editor.extensions`.

```ts
const acme: ViewExtension = {
  name: "acme",
  nodes: { "acme:mention": { inline: true, attrs: { label: {} }, text: (a) => `@${a.label}` } },
  nodeViews: {
    "acme:mention": {
      render: (node, { h }) => h("span", { class: "chip" }, `@${node.attrs.label}`),
    },
  },
  markViews: { "acme:topic": (mark) => ({ class: "topic", title: String(mark.attrs.topic) }) },
  decorations: (state) => [{ from: 1, to: 4, attrs: { class: "hit" } }],
  view: (view) => ({ update(view, previous) {}, destroy() {} }),
};
```

- `nodeViews: Record<type, NodeView>`: `NodeView` is `{ render(node, dom): Node; split?;
  destroy?(dom) }`. `render` is called whenever the node is drawn (again): a changed node, or a
  block split differently; `destroy` gets what `render` returned once the view no longer shows it
  (the node changed, was deleted or split again, or the view was destroyed). The drawing may
  change after `render` (content loaded later, a chart library drawing): the view never reads a
  node view's DOM back, so such changes are not input. The view puts what it returns in an element with `data-foli-custom="<type>"` and
  `contenteditable="false"`: one caret position, selected and deleted whole. Inline: in its line,
  with the run's formatting, and the line wraps around it as the browser sizes it. Block: on the
  pages, measured and placed by the flow; one that does not fit in what is left of a page splits
  between its root element's children (each page's part drawn by `render` again and clipped to its
  rows, the parts after the first `aria-hidden` and `inert`: their links and controls are not
  second tab stops), unless `split: false`, which keeps it whole on
  the next page (one taller than a page is then cut by the page). Without a node view a custom
  node is drawn as its `text(attrs)`.
- `NodeViewDOM` (`dom`): `document` and `h(tag, attrs?, ...children)`, which makes an element with
  attributes and children (strings become text nodes). **Never build a node view from HTML**
  (`innerHTML`, `insertAdjacentHTML`) with the node's attributes: they come from documents and
  pastes. `h` makes only content elements (an allowlist: text-level and flow elements, lists,
  tables, `details`, `figure`, `img`, `picture`, `video`, `audio`, `canvas`, `button`; no
  `script`, `style`, `base`, `meta`, `link`, `form`, frames, `template` or SVG) and refuses (a
  `TypeError`) `on*` handlers, `contenteditable`, `srcdoc`, the view's own `data-foli-*`
  attributes, URL attributes (`href`, `src`, `action`, `formaction`, `poster`, `background`, each
  URL of `srcset` and `ping`) that are not safe links (`isSafeHref`), a `style` that fetches or
  runs anything (`url(`, `image-set`, `expression`, `@import`, backslash escapes) and classes
  starting with `foli-`. What `render` returns is used as it is: a node built another way is not
  checked (extension code is trusted; the node's attributes are not). Do not put attribute values
  in `id` or `name`: an element with a document-chosen `id` or `name` can shadow globals and
  `document` properties (DOM clobbering).
- `markViews: Record<type, MarkView>`: `MarkView` is `(mark) => DecorationAttrs`, put on every run
  of the mark. Without one a run of a custom mark is still named for CSS: `data-foli-mark` holds
  its custom marks' types, space separated (`[data-foli-mark~="acme:topic"]`); a foreign mark's
  original type too.
- `decorations(state): Decoration[]`: asked after every transaction, so keep it cheap (compute in
  a plugin's state, as the playground's `/extension.html` does). `Decoration` is
  `{ from, to, node?, attrs: DecorationAttrs }` in body positions: the text and inline leaves from
  `from` to `to`, split into runs of their own, or with `node: true` the node at `from` (a
  paragraph, on each page it is on, a custom block, or an inline leaf). `DecorationAttrs`:
  `class` (added), `style` (appended) and any other attribute (set), checked as `h` checks them.
  A decoration with a refused attribute is left out and reported. Decorations never change the
  document, the clipboard or what the view reads back. Only the
  blocks whose decorations changed are drawn again (and measured, like an edited block).
- `view(editorView): PluginView`: called when a view of the editor is made, after its first
  render; `PluginView` is `{ update?(view, previous), destroy? }`: `update` after each change the
  view has drawn (`previous` is the state before), `destroy` when the view is destroyed.
- A hook that throws (`render`, a mark view, `decorations`, `view`, `update`, `destroy`) is
  reported with `console.error` and left out (a node view's node is then drawn as its text); the
  editor and the view go on. The same for an editor's `subscribe` listeners: one that throws does
  not keep the others from the change.

## `@folijs/docx`

`.docx` import and lossless export. No DOM: runs in the browser, workers and Node 20.12+. Peer
dependency: `@folijs/core` at exactly its own version (after 0.6.0).
Details (what import keeps, what export writes, limits): the
[package README](../packages/docx/README.md).

- `importDocx(bytes, options?): Promise<DocxImport>`: reads a `.docx` (`Uint8Array`) into a
  schema v5 document. `DocxImport`: `{ document, package, report, trackRevisions }`, the
  validated document, the package it was read from (keep it with the document for export),
  `ImportReport` (`opaque`, `dropped`, `unmodeled`, `unmodeledCount`, `picturesWithoutAlt`) and whether Word tracks
  changes in it (`w:trackRevisions`: the editor's `trackChanges`). `options` are `readPackage`'s.
- `importPackage(pkg): DocxImport`: the same from a package already read.
- `exportDocx(document, package?, options?): Promise<Uint8Array>`: the document as a `.docx`.
  With the package it was imported from, the parts Foli does not edit come back byte for byte
  and unchanged elements verbatim; without one, a new package is made (a document that refers
  to parts of its original package then fails). `ExportOptions`: `trackRevisions` (whether Word
  tracks changes in the file; left out, as the package has it), `resource(key, resource)` (the
  bytes of a picture's image the package does not hold and no `data:` URL gives: an app's
  upload; without them the export fails), `extensions` (the custom types: their `text(attrs)`
  is what a node's control shows). Custom nodes and marks go out as content controls tagged
  `foli:` and the type and attributes as JSON (ADR-0008): a node a plain text control, contents
  locked, showing its text (a block node one around a paragraph); each run of a mark a rich text
  control. A tag over 255 characters throws a `DocxError` naming the type. `importDocx` turns
  such controls back into the nodes and marks, with or without the extension, when nothing else
  is in them (a node's control: text runs formatted alike; a block node's: one plain paragraph
  with nothing of its own; a mark's: anything, not empty); otherwise they stay content controls.
  A node read without its extension keeps the control's text for the next export while in
  memory; one loaded from JSON writes `[type]`.
- `packageImages(pkg): PackageImages`: URLs for the pictures' images in a package
  (`url(key, resource?)`, made once each; `revoke()` frees them): `EditorView`'s `resource`
  option for a document imported from that package. Raster images (PNG, JPEG, GIF, WebP, BMP)
  get object URLs; an SVG a `data:` URL (a `blob:` SVG opened on its own would run its scripts
  as the app's origin); EMF, WMF and TIFF none (their box is shown).
- `readPackage(bytes, options?): Promise<DocxPackage>`: the zip, parts, content types and
  relationships (`ReadPackageOptions`: the zip limits `maxEntries` and `maxSize`, `ZipLimits`,
  and `maxDepth`); `DocxPackage`, `DocxPart`, `NewPart`, `Relationship`.
- `parseXml(source, options?): XmlDocument`: the XML reader that keeps every node's offsets in
  the source (`ParseXmlOptions`; `XmlNode`: `XmlElement`, `XmlText` or `XmlOther`, with `XmlName`
  and `XmlAttribute`).
- Errors: `DocxError` (not a WordprocessingML document, Strict Open XML, content export cannot
  write), `ZipError` (the container), `XmlError` (with the `offset`).

## `@folijs/pdf`

PDF from Foli's own page layout, printed by a headless Chromium page the app supplies (11.12,
ADR-0007). No browser dependency of its own. Peer dependency: `@folijs/core` at exactly its own
version (after 0.6.0). Details: the
[package README](../packages/pdf/README.md).

- `exportPdf(document, options): Promise<ExportedPdf>`: validates `document` (`parseDocument`:
  an invalid one throws before the page is used), replaces `options.page`'s content with the
  package's renderer (`dist/renderer.js`), lays the document out with `renderDocument`, updates
  its fields from those pages (`updateFields`, then again for what depends on the pages), makes
  safe links and links to bookmarks PDF links, adds the editor's print rules and calls
  `page.pdf({ preferCSSPageSize, printBackground, outline, tagged })`: each sheet its section's
  page size, headings as PDF bookmarks. `ExportedPdf`: `{ pdf, pages, fields }` (the bytes, the
  page count, the `FieldsReport`).
- `ExportPdfOptions`: `page` (a `PdfPage`), `resources(key, resource)` (a picture's image:
  `{ data, contentType }`, as a `.docx` package part is, an image `data:` URL, `null` for its
  box, `undefined` for the resource's own `data:` URL; a web URL prints the box), `review`
  (`"markup"`, the default; `"simple"`; `"final"`), `styles` (CSS added first, such as
  `@font-face` rules with `data:` URLs; every face declared is loaded before the layout).
- The page loads nothing from the network: its Content Security Policy allows `data:` images and
  fonts, inline scripts and styles only, so a document cannot make the exporting server request
  an address. An image not decoded after 10 seconds prints without it.
- `PdfPage`: `setContent(html)`, `addScriptTag({ content })`, `evaluate(fn, arg)`,
  `pdf(options)`: Playwright's `Page` (1.42+ for the outline and tags) and Puppeteer's fit it;
  run with Playwright only. With it: `PdfPrintOptions`, `PdfImage`, and `RenderInput` and
  `Rendered` (what `evaluate` gives the page's renderer and gets back).
