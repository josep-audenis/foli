# API reference

The public API of the four packages, as of 0.3.0. Not stable before 1.0: anything may change
in a minor version until then (changes are listed in each package's changelog). Exports not
listed here (model classes, steps, `Transform`, `Plugin`, `Transaction` metadata, mapping) are
public for advanced use but are not a stable API yet.

- [`@folijs/react`](#folijsreact): components and hooks
- [`@folijs/core`](#folijscore): documents, the headless editor, commands
- [`@folijs/view`](#folijsview): the editable DOM view without React
- [`@folijs/docx`](#folijsdocx): `.docx` import and export

## `@folijs/react`

Peer dependencies: `react` and `react-dom` 18.2+ or 19. Stylesheet: `@folijs/react/styles.css`
([styling.md](styling.md)).

### `<FoliEditor>`

An editable document on pages, with a toolbar. Creates its own editor and provides it to its
`children`. Uncontrolled: the editor owns the document. Since 8.7d1 it edits schema v3 (Word's
model, with Word's toolbar): a 0.1.0 or 0.2.0 document given to it is migrated
(`parseDocument`), and what it reports is v3.

| Prop             | Type                           | Default      | Notes                                                                                             |
| ---------------- | ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------- |
| `initialContent` | `EditorDocument`               | empty A4     | Read once, on mount; any version (migrated). Later: `editor.setDocument()` or a new `key`.        |
| `plugins`        | `readonly Plugin[]`            | `[]`         | Read once, on mount. Unstable API.                                                                |
| `author`         | `string`                       | `"Author"`   | Read once: who edits (tracked changes are made in this name).                                     |
| `trackChanges`   | `boolean`                      | `false`      | Read once: record edits as tracked changes (the toolbar turns it on and off).                     |
| `reviewView`     | `ReviewView`                   | `"markup"`   | Read once: how tracked changes show (the toolbar changes it).                                     |
| `onChange`       | `(change: FoliChange) => void` | —            | After every content change made through transactions. Not for selection changes or `setDocument`. |
| `toolbar`        | `boolean`                      | `true`       | Show `FoliToolbar` above the pages.                                                               |
| `comments`       | `boolean \| "auto"`            | `"auto"`     | The comments pane beside the pages: while the document has comments (`"auto"`), always, never.    |
| `readOnly`       | `boolean`                      | `false`      | Read, select, copy; no editing. Disables the toolbar.                                             |
| `placeholder`    | `string`                       | `""`         | Shown while the document is empty.                                                                |
| `label`          | `string`                       | `"Document"` | Accessible name of the editable area.                                                             |
| `className`      | `string`                       | —            | Added to the `.foli-canvas` element.                                                              |
| `children`       | `ReactNode`                    | —            | Rendered between the toolbar and the pages, inside the editor's context.                          |

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
`FoliEditorProvider`'s), `readOnly`, `placeholder`, `label`, `className`, as above.
`ref` → `FoliCanvasHandle`: `{ focus(): void }` (focuses the document, shows the editor's
selection and scrolls it into view).

### `<FoliComments>`

The comments pane: the document's threads beside the pages, each level with its text and moved
down below the one before when they would overlap; resolved threads dimmed. Reply, Edit (comments
of plain text, a line per paragraph), Resolve/Reopen, Delete; a new empty comment (the toolbar's
New comment) opens for writing (Ctrl/Cmd+Enter saves, Escape cancels; one left empty is
deleted). Focusing a thread outlines its text; a caret in commented text marks its thread. Not
printed. Props: `editor` (default: the nearest provider's), `readOnly` (no actions), `label`
(default "Comments"), `className`. Render it beside the pages (`FoliEditor` does, in
`.foli-editor-body`): it finds the commented text (`data-foli-comments` in the view) in the
nearest ancestor that holds them.

### `<FoliToolbar>`

Word's controls: paragraph style (with Word's Heading 1 to 3 when the document has not used
them yet), font and size boxes · bold, italic, underline, strikethrough, link, text color,
highlight · align left, center, align right, justify, line spacing · bulleted list, numbered
list (pressed inside one), decrease and increase indent (list levels, else half-inch stops) ·
New comment (on the selection, written in the pane), Track changes (pressed while on), Show changes as (All markup, Simple markup, No markup),
previous and next change, Accept, Reject (the change at the caret or the selected ones),
Accept all, Reject all ·
undo, redo · page break. A pointer pick in a box calls `onClickCommand`, like a button click.
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

| Prop             | Type         | Default        | Notes                                                               |
| ---------------- | ------------ | -------------- | ------------------------------------------------------------------- |
| `editor`         | `Editor`     | context        |                                                                     |
| `disabled`       | `boolean`    | `false`        | Pass it whenever the canvas is `readOnly`.                          |
| `onClickCommand` | `() => void` | —              | After a click ran a command (`FoliEditor` focuses its canvas here). |
| `label`          | `string`     | `"Formatting"` | Accessible name.                                                    |
| `className`      | `string`     | —              | Added to `.foli-toolbar`.                                           |

### Hooks and provider

- `useFoliEditor({ initialContent?, plugins? }): Editor`: creates an editor on the first render
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

Documents are schema v3, Word's model ([document-model.md](document-model.md)).

- `createDocument(content?, section?): FoliDocument`: a new document: `content` (schema v3;
  default: one empty paragraph) on A4 with 25.4 mm margins, with Normal, Heading 1–6, List
  Paragraph and Hyperlink styles, bullet and number definitions, in 11 pt Georgia with 1.5
  lines (the look a migrated 0.2.0 document has). `section` is in twips (`mmToTwips(mm)`) and
  merged over that page (`pageSize` and `margins` part by part). Not validated. (0.2.0's took
  v2 content and millimetre settings; to start from those, pass
  `{ schemaVersion: 2, settings, content }` to `parseDocument` or the editor.)
- `parseDocument(input: unknown): FoliDocument`: validates untrusted input (e.g. parsed JSON)
  and returns a copy in canonical form; a document saved by 0.1.0 or 0.2.0 is validated as
  such and migrated (`migrateToV3`). Throws `FoliDocumentError`, whose message names the place
  (`content.content[2].marks[0].type: …`) and says when a newer Foli saved the document; never
  drops content silently. `parseContent(json)` parses content alone into a `doc` node.
- `FoliDocument`: `{ schemaVersion: 3, section, defaults, styles, numbering, theme?, comments,
  content }` and its parts (`SectionJSON`, `StyleJSON`…), in Word's units (twips).
- `SCHEMA_VERSION` (3), `schema` (the content schema), `checkSection`, `RUN_PROPERTY_MARKS`,
  `HIGHLIGHT_COLORS`, `JUSTIFICATIONS`, the unit conversions (`twipsToMm`, `mmToTwips`…).
- `isSafeHref(href)` and `isColor(color)`: the rules links and colors from outside a document
  must follow.
- `PAGE_SIZES` (`A4`, `Letter`), `DEFAULT_SETTINGS` and `DocumentSettings`: page geometry in
  millimetres, what `editor.settings` gives.
- Schema v2, kept to read 0.2.0 documents and pasted HTML: `FoliDocumentV2`, `parseContentV2`,
  `migrateToV3(document)`, and its JSON types (`DocJSON`, `ParagraphJSON`, `HeadingJSON`,
  `TextJSON`…, with `MARK_TYPES`, `SIMPLE_MARK_TYPES`, `HEADING_LEVELS`, `ALIGNMENTS`).

### Formatting

- `new Resolver(document)`: a document's effective formatting, as Word computes it.
  `paragraph(attrs)` gives a paragraph's properties (`ParagraphFormat`) and the formatting of its
  text (`RunFormat`); `run(paragraphRun, marks)` a run's; `markers(paragraphs)` the list markers
  (`ListMarker`: text, suffix, formatting) of a document's paragraphs in order.
  `formatNumber(n, format)` writes a number in a Word number format.

### Editor

`createEditor({ document?, plugins?, author?, trackChanges? }): Editor`: a headless editor (state, commands, undo
history, change notifications) of a schema v3 document (Word's model). The document is
validated and, when saved by 0.1.0 or 0.2.0, migrated (`parseDocument`; default:
`createDocument()`); `setDocument` behaves the same way. `EditorDocument` is what both take:
`FoliDocument | FoliDocumentV2`. The editor keeps its styles, numbering and sections,
`getDocument()` returns a v3 document (a copy) and `settings` are its last section's page (`sectionSettings(section)`; Word's Letter page with
inch margins where the section leaves them out). The commands edit as Word does: Enter
leaves the section break and the paragraph's own attributes on the second paragraph, and at the
end of a paragraph whose style names a next style (a heading: Normal) starts that style;
`toggleMark` and `isMarkActive` for bold, italic, underline, strike, double strike, caps,
small caps and hidden act on what the text shows (turning bold off in a bold heading writes
"not bold"); Backspace and Delete step over bookmarks and comment ranges, and select a field,
content control or table before deleting it; joining paragraphs keeps the second one's section
break, and a paragraph left with nothing by a join or a deletion from its start is removed whole
(the next one keeps its properties, as in Word); typed text never takes a tracked-change mark (except its own `insertion` when tracking).

Tracked changes: `createEditor({ author?, trackChanges? })` (author default "Author"; tracking
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
or insert a block Foli does not model (a table) is not made while tracking (Phase 10). Undo and redo, transactions with
`addToHistory: false` and those with the `untracked` meta are not tracked; an edit that cannot
be recorded is not made. `editor.commands.setTrackChanges(on, author?)` (the
`setTrackChanges` command), `editor.trackingChanges`, `trackState(state)` (`{ on, author }`).

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
(its replies and anchors too), `deleteAllComments()`; the same as commands. `content` is text
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
- Clipboard (the view uses these): `copiedDefinitions(context, content)` gives the styles,
  numbering and comments copied content references, with the document's id
  (`wordContext(state).id`, which tells a copy inside the document from one from another); `fitPaste(state, content, definitions?)`
  validates pasted v3 content and definitions (none: the document's own, but unsafe links are
  dropped) and returns
  `{ doc, envelope }`, the content fitted to the document and its envelope with what it added;
  `fitPastedV2(state, content)` does the same for schema v2 content (pasted HTML). Apply the
  envelope with `withEnvelope(tr, envelope)` and its comments with
  `setComments(tr, current.comments, envelope.comments)` (`withEnvelope` ignores comments: they
  change only through `CommentStep`s, which undo and redo take back); `wordContext(state)` gives
  the current one.

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
| `subscribe(listener)`          | `(state, transactions) => void` after every change (selection included); returns unsubscribe. `transactions.some(tr => tr.docChanged)` tells content changes apart.                                                                                                                                                           |

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

## `@folijs/view`

The editable view without a framework. Needs a browser DOM.

```ts
const view = new EditorView(host, editor, { editable: true, placeholder: "" });
```

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
- `view.setOptions({ editable?, placeholder? })`: changes the given options.
- `view.focus()`: focuses the host, shows the editor's selection, scrolls it into view.
- `view.destroy()`: removes listeners, injected styles and the attributes it added; empties the
  host.
- Clipboard: copy writes Foli JSON (`FOLI_MIME`), HTML and plain text; paste prefers Foli JSON,
  then HTML (`htmlToDoc`, read as schema v2 `DocJSON`, never `innerHTML`: lists at any depth,
  Word and Google Docs lists, rules, safe links, colors, alignment; fitted with `fitPastedV2`),
  then text (`textToDoc`: one paragraph per line, fitted with `fitPaste`). Content with an
  opaque block at either end goes in as whole blocks at the caret (or replaces an empty
  paragraph).
  Plain text that is one URL (`autolinkHref`) becomes a link: over selected text inside one
  block that text is linked, otherwise the URL is inserted as linked text; not on paste as
  plain text (Ctrl/Cmd+Shift+V), nor when the clipboard holds Foli JSON.
  `view.paste(data, autolink = true)` pastes clipboard data from code.
- Links: a click places the caret (no navigation, read-only mode too); Ctrl+click (Cmd+click
  on Apple platforms) opens the link's href, read from the document, in a new tab with
  `noopener,noreferrer`.
- `keyName(event)`: the key name `handleKey` expects (`"Mod-b"`, `"Shift-Enter"`).
- `renderDocument(document, container, { review? }): DocumentPages` (a read-only view, no
  editor): lays a schema v3 document out on
  pages (`.foli-word-page`, `WORD_PAGE_CLASS`) appended to `container`, formatted as Word
  formats it. `review`: `"markup"` (default: insertions underlined, deletions struck through)
  or `"final"` (as if accepted). `DocumentPages`: `pages`, `pageOf(index)` and `lineOf(index)`
  (where the top-level node at `index` starts: the page, 0-based, and the line on that page,
  1-based), `destroy()`. Measures as it is called: render after the document's fonts have
  loaded (`document.fonts.ready`), into a container that is laid out and not scaled. See
  [architecture.md](architecture.md#word-pages-packagesviewsrcword-86b).

## `@folijs/docx`

`.docx` import and lossless export. No DOM: runs in the browser, workers and Node 20.12+.
Details (what import keeps, what export writes, limits): the
[package README](../packages/docx/README.md).

- `importDocx(bytes, options?): Promise<DocxImport>`: reads a `.docx` (`Uint8Array`) into a
  schema v3 document. `DocxImport`: `{ document, package, report, trackRevisions }`, the
  validated document, the package it was read from (keep it with the document for export),
  `ImportReport` (`opaque`, `dropped`, `unmodeled`, `unmodeledCount`) and whether Word tracks
  changes in it (`w:trackRevisions`: the editor's `trackChanges`). `options` are `readPackage`'s.
- `importPackage(pkg): DocxImport`: the same from a package already read.
- `exportDocx(document, package?, options?): Promise<Uint8Array>`: the document as a `.docx`.
  With the package it was imported from, the parts Foli does not edit come back byte for byte
  and unchanged elements verbatim; without one, a new package is made (a document that refers
  to parts of its original package then fails). `ExportOptions`: `trackRevisions` (whether Word
  tracks changes in the file; left out, as the package has it).
- `readPackage(bytes, options?): Promise<DocxPackage>`: the zip, parts, content types and
  relationships (`ReadPackageOptions`: the zip limits `maxEntries` and `maxSize`, and
  `maxDepth`).
- `parseXml(source, options?): XmlDocument`: the XML reader that keeps every node's offsets in
  the source.
- Errors: `DocxError` (not a WordprocessingML document, Strict Open XML, content export cannot
  write), `ZipError` (the container), `XmlError` (with the `offset`).
