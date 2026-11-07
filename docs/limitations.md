# Known limitations

What Foli does not do yet, or does with caveats, as of 0.1.0. Read it before you ship. Details
and the reasons are in [architecture.md](architecture.md), [pagination.md](pagination.md) and
[ADR-0003](decisions/ADR-0003-rendering-and-input.md); what comes next is in the
[roadmap](roadmap.md).

## Not verified by hand

Every check below is automated in Chromium, Firefox and WebKit (Playwright on Windows), but the
manual checks have not been run yet. The project owner accepted them as open risks
([ADR-0003](decisions/ADR-0003-rendering-and-input.md#gate-g4-passed-provisionally-2026-11-07);
checklist in [testing/ime.md](testing/ime.md)):

- **IME and dead keys** (Japanese, Chinese, Korean; accented letters): tested only through
  Chromium's emulation, including next to a page break. Not on real Windows, macOS, Android or
  iOS input methods.
- **Screen readers** (NVDA, VoiceOver): not tried, including read-only mode, the placeholder,
  and a paragraph split across two pages (it may be read as two paragraphs).
- **macOS key bindings** (Cmd/Option+arrows, Cmd/Option+Backspace, Ctrl+K/H/D).
- **Spellcheck and autocorrect** replacing a word at the end or start of a page.
- **Pastes from real Word, Google Docs and LibreOffice**: the test fixtures are hand-written
  approximations.
- **Safari**: tests run on Playwright's WebKit on Windows, not Safari on macOS or iOS.

## Content

- Schema v1 only: paragraphs, headings 1–6, line breaks, page breaks; bold, italic, underline,
  strikethrough. No lists, links, alignment or colors (Phase 7), tables or images (Phase 8),
  headers, footers or page numbers (Phase 9).
- Paste keeps what the schema holds: links keep their text, lists and table cells become
  paragraphs, images and colors are dropped.
- Drag and drop of text does nothing.
- Some Android keyboards insert paragraphs without the events the editor needs; such an edit is
  discarded with a `Foli:` console warning.
- The document format (`schemaVersion: 1`) is the first one: later versions will migrate it
  without dropping content.

## Pages

- Page breaks depend on the fonts the browser has: the same document can paginate differently
  on another machine, or before a web font loads (the editor re-flows when it does).
- Line measurement assumes left-to-right text and no `vertical-align` offsets: right-to-left
  text may break across pages at the wrong line.
- A split paragraph repeats its padding and border on both pages. Negative block margins are
  not modelled.
- A CSS change that only alters block margins, or rewraps text without changing any block's
  height, is noticed only at the next height change.
- No virtualization: every page is in the DOM and measured on load. Fine up to a few hundred
  pages ([benchmarks.md](benchmarks.md): 100 pages lay out in about 40–85 ms, a keystroke
  paints within 8–19 ms at p95 in Chromium and Firefox).
- Formatting thousands of paragraphs at once is slow: bold over 4,000 paragraphs takes about
  half a second, and so does its undo.

## Print

- One `@page` size per web page: with several editors of different page sizes, the last one's
  sheet size wins.
- Print-only CSS must not change text metrics. PDF output is checked in Chromium only.
- Your page's other content prints too; hide it ([styling.md](styling.md#print)).

## React and the browser

- Server rendering gives the editor's shell, not its content: the document appears on
  hydration, so it is not indexed from the server HTML.
- `FoliEditor` is uncontrolled: `initialContent` is read once. Load another document with
  `editor.setDocument()` or a new `key`; there is no `value` prop.
- `editor.setDocument()` during an IME composition is not handled: load documents from a click
  or a file picker (which end the composition), not from a timer.
- A Content Security Policy without `'unsafe-inline'` styles hides the placeholder and breaks
  print sheets ([styling.md](styling.md#content-security-policy)).
- `Plugin`, `Transaction` metadata, steps and mapping are exported but not a stable API.
