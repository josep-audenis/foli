# Keyboard

Every key the editor handles, the command behind it, and whether an app's keymap can take it
(ADR-0008, task 12.5). Keys typed into the browser's own editing (letters, the arrows the view
leaves alone, the clipboard keys) are the browser's and are not listed.

## Key names

A keymap (`PluginSpec.keymap`, `editor.handleKey`) names a key as `keyName(event)` does
(`@folijs/view`): modifiers in the order `Mod-Ctrl-Meta-Alt-Shift-`, then the key; a single
character lower-cased (`Mod-b`, `Mod-Shift-z`), other keys by `KeyboardEvent.key` (`Enter`,
`ArrowDown`, `F9`). With Mod or Alt, when the character is not a–z or 0–9, the key is named by
its physical key instead: `Mod-Shift-7` whatever Ctrl+Shift+7 types on the layout, `Mod-b` for
Ctrl+B on a Cyrillic layout, `Alt-Shift-n` for Option+Shift+N on macOS (which types a character).
A layout's own letters keep their name (Ctrl+A on AZERTY is `Mod-a`). On Windows and Linux, AltGr
(Ctrl+Alt on Windows) typing a character is named by that character (`Mod-Alt-[` for AltGr+F on a
Hungarian layout), so it types.

Option on macOS and AltGr (Ctrl+Alt) on Windows type characters on many layouts (`@`, `[`, `€`,
accented letters): an app should not bind `Alt-` plus a letter or digit, nor `Mod-Alt-` plus one,
or those users cannot type the character. The built-in `Mod-Alt-f`, `Mod-Alt-d` and `Alt-Shift-n`
are Word's; AltGr characters pass them by.

| Name          | Windows and Linux         | macOS                                                       |
| ------------- | ------------------------- | ----------------------------------------------------------- |
| `Mod-`        | Ctrl                      | Cmd                                                         |
| `Alt-`        | Alt                       | Option                                                      |
| `Shift-`      | Shift                     | Shift                                                       |
| `Ctrl-`       | (not used: Ctrl is `Mod`) | Ctrl                                                        |
| `Meta-`       | Windows / Super           | (not used: Cmd is `Mod`)                                    |
| `Home`, `End` | Home, End                 | Fn+Left, Fn+Right                                           |
| `F9` …        | F9 …                      | Fn+F9, or F9 when the keyboard sends standard function keys |

## Overriding a key

User plugins (`createEditor({ plugins })`, `FoliEditor`'s `plugins`, an extension's `plugins`)
run before every built-in plugin, and the view runs its own keys where the built-ins start, so a
plugin binding a key's name takes it. A command that returns false passes the key on.

```ts
import { createEditor, Plugin } from "@folijs/core";

const editor = createEditor({
  plugins: [new Plugin({ keymap: { "Mod-f": () => openMySearch(), F9: () => true } })],
});
```

`F9: () => true` swallows the key; returning false leaves it to the built-in. The reserved keys
below are not keymap keys: a binding of them may run but cannot stop what the view does.

## Built-in keys

**Overridable** means a plugin's keymap takes the key first. All of them are.

### Editing (core keymaps)

In order: content controls, tables, lists, then the base keymap (`baseKeymap()`), the first
command that applies wins.

| Windows and Linux          | macOS                    | Name                         | Command                                                                   |
| -------------------------- | ------------------------ | ---------------------------- | ------------------------------------------------------------------------- |
| Backspace, Delete          | Delete, Fn+Delete        | `Backspace`, `Delete`        | in a control: its edge selects its content (controls plugin)              |
| Enter                      | Return                   | `Enter`                      | in a control: a line break (multi-line text) or nothing (controls plugin) |
| Space                      | Space                    | `" "`                        | on a check box control: checks or unchecks it (`setControlValue`)         |
| Tab, Shift+Tab             | the same                 | `Tab`, `Shift-Tab`           | in a table: the next or previous cell (`goToCell(1)`, `goToCell(-1)`)     |
| Enter                      | Return                   | `Enter`                      | in a list: `splitListItem` (an empty item ends the list)                  |
| Backspace                  | Delete                   | `Backspace`                  | at a numbered paragraph's start: `liftListItemAtStart`                    |
| Tab, Shift+Tab             | the same                 | `Tab`, `Shift-Tab`           | in a list: `sinkListItem`, `liftListItem`                                 |
| Ctrl+Shift+7, Ctrl+Shift+8 | Cmd+Shift+7, Cmd+Shift+8 | `Mod-Shift-7`, `Mod-Shift-8` | `toggleList("orderedList")`, `toggleList("bulletList")`                   |
| Enter                      | Return                   | `Enter`                      | `splitBlock`                                                              |
| Shift+Enter                | Shift+Return             | `Shift-Enter`                | `insertHardBreak`                                                         |
| Ctrl+Enter                 | Cmd+Return               | `Mod-Enter`                  | `insertPageBreak`                                                         |
| Tab                        | Tab                      | `Tab`                        | `insertTab` (Escape, then Tab, leaves the editor: reserved, below)        |
| Backspace, Delete          | Delete, Fn+Delete        | `Backspace`, `Delete`        | `deleteBackward()`, `deleteForward()`                                     |
| Ctrl+B, Ctrl+I, Ctrl+U     | Cmd+B, Cmd+I, Cmd+U      | `Mod-b`, `Mod-i`, `Mod-u`    | `toggleMark("bold")`, `toggleMark("italic")`, `toggleMark("underline")`   |
| Ctrl+K                     | Cmd+K                    | `Mod-k`                      | `openLinkEditor` (the app's link dialog: `FoliToolbar` answers it)        |
| Ctrl+A                     | Cmd+A                    | `Mod-a`                      | `selectAll`                                                               |
| Left, Right                | the same                 | `ArrowLeft`, `ArrowRight`    | `arrowAcrossLeaf(±1, "char")`: over a picture or an opaque leaf           |
| Up, Down                   | the same                 | `ArrowUp`, `ArrowDown`       | `arrowAcrossLeaf(±1, "none")`                                             |
| Ctrl+Z                     | Cmd+Z                    | `Mod-z`                      | `undo`                                                                    |
| Ctrl+Y, Ctrl+Shift+Z       | Cmd+Y, Cmd+Shift+Z       | `Mod-y`, `Mod-Shift-z`       | `redo`                                                                    |

Word and line deletion (Ctrl+Backspace, Option+Backspace, Cmd+Backspace…) differ per platform and
are not keymap keys: the view takes them from the browser's `beforeinput` (`deleteWordBackward`
and the like), as it takes the browser's undo, redo and bold, italic, underline commands
(`historyUndo`, `formatBold`…). A keymap binding such a key by name (`Mod-Backspace`) runs first.

### The view's keys

They need the pages, the stories or the app's UI, so they are the view's (`@folijs/view`), not
core commands; they run after the user's plugins and before the core keymaps above.

| Windows and Linux                   | macOS                      | Name                                                     | What it does                                                                                                   |
| ----------------------------------- | -------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Ctrl+Home, Ctrl+End (Shift extends) | Cmd+Fn+Left, Cmd+Fn+Right  | `Mod-Home`, `Mod-End`, `Mod-Shift-Home`, `Mod-Shift-End` | to the document's start or end on pages with headers or footers (elsewhere the browser's move)                 |
| F9                                  | Fn+F9                      | `F9`                                                     | `view.updateFields()`: the selection's fields (all with Ctrl+A first)                                          |
| Alt+F9                              | Option+Fn+F9               | `Alt-F9`                                                 | `toggleFieldCodes`                                                                                             |
| Alt+Down                            | Option+Down                | `Alt-ArrowDown`                                          | opens the list or date picker of the content control at the caret                                              |
| Ctrl+Alt+F, Ctrl+Alt+D              | Cmd+Option+F, Cmd+Option+D | `Mod-Alt-f`, `Mod-Alt-d`                                 | `insertNote("footnote")`, `insertNote("endnote")`, then opens the note                                         |
| Shift+Alt+N                         | Shift+Option+N             | `Alt-Shift-n`                                            | from a note reference to its note (`storyView.editNote()`), and back (`storyView.toReference()`)               |
| Ctrl+F, Ctrl+H, Ctrl+G              | Cmd+F, Cmd+H, Cmd+G        | `Mod-f`, `Mod-h`, `Mod-g`                                | `editor.navigation("find" \| "replace" \| "goTo")`: what the app shows (`FoliNavigation`); none, the browser's |
| F3, Shift+F3                        | Fn+F3, Shift+Fn+F3         | `F3`, `Shift-F3`                                         | `editor.navigation("next" \| "previous")`                                                                      |
| Ctrl+Shift+F5                       | Cmd+Shift+Fn+F5            | `Mod-Shift-F5`                                           | `editor.navigation("bookmarks")`                                                                               |

After every keymap (core's included) has passed a key on, the view also moves the caret where
the browser cannot: Up and Down beside a rule or across a table cell's edge (`ArrowUp`,
`ArrowDown`: selects the rule, or the cell above or below with `goToCellVertically`), and
Shift+arrows in a table (`Shift-ArrowUp` …: grows a cell selection, `extendCellSelection`). A
keymap binding those names runs first, so they are overridable too.

Shift+Alt+N is Foli's (Word has none). On macOS some of these are the system's or the browser's
before the page sees them (Cmd+H hides the browser, Cmd+Option+D the Dock, F3 is often Mission
Control): bind other keys there with a keymap. Not checked on a Mac
([ADR-0003](decisions/ADR-0003-rendering-and-input.md), [limitations](limitations.md)).

### Reserved

These stay the view's whatever a keymap binds (ADR-0008):

| Keys                                                                                                    | Why                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Left, Right (and with Shift) at page splits, list numbers, field parts, a control's edge or placeholder | Caret fixes for the pages' DOM, acting only where the browser would move wrong; a keymap's binding of a plain arrow runs wherever they do not act. |
| Escape in a header, footer or note                                                                      | The way out of a nested editing host: no keyboard trap.                                                                                            |
| Tab, Shift+Tab after Escape, or when read-only                                                          | The way out of the document: no keyboard trap.                                                                                                     |
| Ctrl+Shift+V (Cmd+Shift+V)                                                                              | Only marks the next paste as plain text; it does not take the key.                                                                                 |
| Escape while dragging a column border or resizing a picture                                             | The keys of a gesture, not of the document.                                                                                                        |
| Keys inside a control's list or date pop-up                                                             | The keys of a pop-up widget, not of the document.                                                                                                  |
| Any key while composing (IME)                                                                           | An input method owns the keys until it commits.                                                                                                    |

The React components' own keys (the toolbar's arrows, the find panel, the outline, the comments
pane) are the keys of those widgets, not of the document.
