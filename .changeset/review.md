---
"@folijs/core": minor
"@folijs/view": minor
"@folijs/react": minor
"@folijs/docx": minor
---

Review as in Word: tracked changes recorded, shown, accepted and rejected; comments written, answered and resolved; both round-trip with Word.

- **Tracked changes** (`@folijs/core`): with tracking on (`createEditor({ author, trackChanges })`, `editor.commands.setTrackChanges`), every edit is recorded as Word records it: what is removed stays marked deleted, what is added is marked inserted, paragraph marks removed or added are recorded on the paragraph, formatting changes keep the properties from before the first change (`formatChange`), and deleting your own insertion removes it. Commands need no tracking code: the editor rebuilds each transaction it dispatches (`trackTransaction`). Accept and reject (`acceptChange`, `rejectChange` at the caret or in the selection, `acceptAllChanges(author?)`, `rejectAllChanges(author?)`, `nextChange`, `previousChange`, `trackedChanges(doc)`), each its own undo step; both ends of a move together. A property test checks that accepting everything gives the same document as the edits made untracked and rejecting everything gives the original.
- **Comments** (`@folijs/core`): `addComment`, `replyToComment`, `editComment`, `resolveComment`, `deleteComment`, `deleteAllComments`, with Word's anchors; comment changes are part of undo history (`CommentStep`); a comment whose text is deleted with its reference goes with it.
- **View** (`@folijs/view`): tracked changes shown as all markup (author colors, a bar beside changed paragraphs), simple markup or no markup while editing (`setReviewView`, `createEditor({ reviewView })`); while tracking, or where it is hidden, Backspace and Delete step over deleted text.
- **React** (`@folijs/react`): a review group in `FoliToolbar` (New comment, Track changes, Show changes as, previous and next change, Accept, Reject, Accept all, Reject all); `FoliComments`, a comments pane beside the pages (threads level with their text; reply, edit, resolve, delete), shown by `FoliEditor` while the document has comments (`comments` prop); `FoliEditor` props `author`, `trackChanges`, `reviewView`.
- **DOCX** (`@folijs/docx`): `DocxImport.trackRevisions` and `exportDocx(document, package?, { trackRevisions })` read and write Word's tracking setting. Checked with Word on the corpus: files with changes and comments made in Foli open without a repair prompt with those changes, authors and threads; Word's accepted and rejected text equals Foli's; Foli reads Word's own changes and replies back.

No document format change (schema 3): 0.3.0 and 0.4.0 read each other's documents. Known limits are in [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md) (tables are not tracked yet; dates are written in UTC).

Changed behaviour (pre-1.0 minor):

- A paragraph left with nothing by a join or by a deletion from its start is removed whole: the next paragraph keeps its own properties (before, the merged paragraph took the first one's).
- `closeHistory` makes a transaction an undo step of its own on both sides: typing right after a paste, cut or drop is now its own step.
- `withEnvelope` ignores comments: change them with `setComments` (or the comment commands).
- `FoliEditor` puts the canvas inside a `.foli-editor-body` element (beside the comments pane): CSS that relied on `.foli-canvas` being a direct child of the editor's parent needs updating.
- Imported `w:rPrChange` properties are in canonical form (default attributes left out); inserted and deleted text in `renderDocument` and the editor is titled "Inserted by …" / "Deleted by …".
