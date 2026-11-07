# @folijs/react

## 0.1.0

### Minor Changes

- First release: a document editor for the web with its own editing engine, on real pages.
  - **Documents** (`@folijs/core`): a versioned JSON format (`schemaVersion: 1`) with page size and margins in millimetres; `parseDocument` validates untrusted input and never drops content silently. Schema v1: paragraphs, headings 1–6, line breaks, page breaks; bold, italic, underline, strikethrough.
  - **Engine** (`@folijs/core`): immutable state, steps and transactions, undo/redo history, commands, key bindings, a headless `createEditor`. No DOM.
  - **View** (`@folijs/view`): `EditorView` renders the document on A4 or Letter pages in one `contenteditable` host. Paragraphs split across pages at a line, with widow/orphan and keep-with-next rules, explicit page breaks, incremental reflow, and print with one sheet per page. Typing, IME composition, copy, cut and paste (Foli JSON, HTML mapped to the schema, plain text), read-only mode, placeholder.
  - **React** (`@folijs/react`, React 18.2+ and 19): `FoliEditor` with a formatting toolbar and `onChange`; `useFoliEditor`, `FoliEditorProvider`, `FoliCanvas`, `FoliToolbar`, `useCurrentEditor`, `useEditorState`. Server rendering gives the editor's shell; the document appears on hydration. Default theme in `@folijs/react/styles.css` (CSS variables).

  Known risks: the manual checks are not run yet. Real IME and dead keys (Windows, macOS, Android, iOS input methods), NVDA and VoiceOver, macOS key bindings, spellcheck at a page break, and pastes from real Word, Google Docs and LibreOffice are covered only by automated tests (IME through Chromium's emulation) in Chromium, Firefox and WebKit on Windows. See [Known limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md).

### Patch Changes

- Updated dependencies
  - @folijs/core@0.1.0
  - @folijs/view@0.1.0
