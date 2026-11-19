---
"@folijs/core": minor
"@folijs/view": minor
---

Commands and keymaps (ADR-0008):

- Plugins add named commands: `PluginSpec.commands` maps names to command factories
  (`(...args) => Command`), run by `editor.commands.<name>(...args)` on the editor (and on a
  story's editor); `editor.run` and `editor.can` take the factory's command as before. Apps type
  them by augmenting the new `FoliCommands` interface (the type of `editor.commands`). A name
  taken twice, or by a built-in command, makes `createEditor` throw a `RangeError`.
- A user keymap now overrides the keys the view handled before every keymap: Ctrl+Home and
  Ctrl+End (with Shift), F9, Alt+F9, Alt+Down, Ctrl+Alt+F, Ctrl+Alt+D, Shift+Alt+N, Ctrl+F,
  Ctrl+H, Ctrl+G, F3, Shift+F3 and Ctrl+Shift+F5 run after the user's plugins and before the
  built-in keymaps. A binding that returns true takes the key. The reserved keys (caret fixes at
  page splits, Escape out of a story, Tab after Escape, Ctrl+Shift+V, keys of a drag or a pop-up,
  keys while composing) stay the view's.
- `keyName` names a letter or digit pressed with Alt (Option) by its physical key, as it already
  did with Mod: Option+Shift+N on macOS is `Alt-Shift-n`, not the character it types. A character
  typed with AltGr (Ctrl+Alt on Windows) is named by itself: AltGr+F types `[` on a Hungarian
  layout instead of inserting a footnote as Ctrl+Alt+F (a fix).
- `docs/keyboard.md` lists every built-in key per platform (Windows and Linux, macOS), its
  command and whether a keymap can take it.

New names: `FoliCommands`, `BuiltInCommands` (`@folijs/core`).
