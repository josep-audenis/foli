# IME, dead keys, clipboard and screen readers: manual checklist

Gate G3 needs these checks run by hand on real platforms: automation can only emulate IME in
Chromium (`apps/playground/e2e/ime.spec.ts`). Copy the results into
[ADR-0003](../decisions/ADR-0003-rendering-and-input.md) ("Manual results") with date, OS and
browser versions.

Page-break variants (composition at a fragment edge, a split paragraph read aloud) need
pagination and belong to gate G4.

## Setup

```bash
pnpm install
pnpm dev                     # playground at http://localhost:5173
pnpm dev --host              # also reachable from phones on the LAN
```

Press **Reset** in the playground bar before each row. "Pass" means:

- the text is right, with nothing duplicated or lost;
- the caret ends after the committed text;
- one Ctrl/Cmd+Z removes the whole composition, never only part of it (typing within half a
  second before or after it, or back-to-back compositions such as Korean syllables, may be
  undone together: history groups adjacent edits);
- reloading the page shows the same document;
- the DevTools console shows no `Foli:` warning.

## IME and dead keys

| Platform / browser | Input method                     | Case                                              | Result | Notes |
| ------------------ | -------------------------------- | ------------------------------------------------- | ------ | ----- |
| Windows / Chrome   | Microsoft Japanese IME           | compose + commit at the end of a paragraph        |        |       |
| Windows / Chrome   | Microsoft Japanese IME           | compose + commit in the middle of bold text       |        |       |
| Windows / Chrome   | Microsoft Japanese IME           | compose over a selection across two paragraphs    |        |       |
| Windows / Chrome   | Microsoft Japanese IME           | cancel a composition with Esc                     |        |       |
| Windows / Firefox  | Microsoft Japanese IME           | the first three rows above                        |        |       |
| Windows / Chrome   | Microsoft Pinyin (Chinese)       | compose + commit, pick a candidate with a number  |        |       |
| Windows / Firefox  | Microsoft Pinyin (Chinese)       | same                                              |        |       |
| Windows / Chrome   | Microsoft Korean IME             | type 한국어 then a space (syllable by syllable)   |        |       |
| Windows / Firefox  | Microsoft Korean IME             | same                                              |        |       |
| Windows / Chrome   | Spanish or US-International      | dead keys: `é ñ ü à`, then ´ + space for a lone ´ |        |       |
| Windows / Firefox  | Spanish or US-International      | same                                              |        |       |
| macOS / Safari     | Japanese – Romaji                | compose + commit; compose over a selection        |        |       |
| macOS / Safari     | Option+e e (dead key)            | type `é` in plain and in bold text                |        |       |
| macOS / Chrome     | Pinyin – Simplified              | compose + commit                                  |        |       |
| Android / Chrome   | Gboard (English, autocorrect on) | type, accept a suggestion, backspace a word       |        |       |
| Android / Chrome   | Gboard Japanese                  | compose + commit                                  |        |       |
| iOS / Safari       | Default keyboard                 | type, accept autocorrect, delete                  |        |       |

Known gap: a composition that inserts a line break or a new paragraph (some Android keyboards)
is discarded with a `Foli:` console warning. Record it if you see one.

## Clipboard

Automation covers copy/cut/paste inside the editor (Chromium, Firefox) and pastes of
hand-written fixture HTML. Playwright's WebKit on Windows gives paste events empty clipboard
data, so Safari needs these rows by hand. When pasting from another app, also save the HTML it
put on the clipboard as a fixture (see `packages/view/fixtures/clipboard/README.md`).

| Platform / browser | Case                                                                 | Result | Notes |
| ------------------ | -------------------------------------------------------------------- | ------ | ----- |
| macOS / Safari     | copy and paste inside the editor (blocks and bold kept), cut + undo  |        |       |
| Any / Chrome       | paste from Word: heading, bold/italic/underline, empty line, list    |        |       |
| Any / Chrome       | paste from Google Docs: same                                         |        |       |
| Any / Chrome       | paste from LibreOffice Writer: same                                  |        |       |
| Any / Firefox      | paste from a web page with links and images (text only, no images)   |        |       |
| Any                | copy from the editor, paste into Word / Google Docs: formatting kept |        |       |

## Keyboard (macOS)

Automation runs on Windows key bindings. Check these on a Mac in Safari and Chrome; each should
behave as in TextEdit, and typing afterwards must land at the new caret.

| Platform / browser | Case                                                                | Result | Notes |
| ------------------ | ------------------------------------------------------------------- | ------ | ----- |
| macOS / Safari     | Cmd+Left/Right (line edges), Option+Left/Right (words), Cmd+Up/Down |        |       |
| macOS / Safari     | Cmd+Backspace deletes to the line start; Option+Backspace a word    |        |       |
| macOS / Safari     | Ctrl+K deletes to the line end; Ctrl+H, Ctrl+D delete a character   |        |       |
| macOS / Chrome     | the rows above                                                      |        |       |

## Screen readers

| Screen reader / browser | Case                                                                | Result | Notes |
| ----------------------- | ------------------------------------------------------------------- | ------ | ----- |
| NVDA / Firefox          | focus the editor: announced as an editable multi-line "Document"    |        |       |
| NVDA / Firefox          | read paragraph by paragraph and line by line; arrow through a word  |        |       |
| NVDA / Chrome           | same two rows                                                       |        |       |
| NVDA / Firefox          | type, Backspace, Ctrl+B: typed and deleted characters are announced |        |       |
| NVDA / Firefox          | read-only (playground checkbox): announced as read-only; reads text |        |       |
| NVDA / Firefox          | empty document: placeholder announced once, not read as content     |        |       |
| VoiceOver / Safari      | the rows above                                                      |        |       |
