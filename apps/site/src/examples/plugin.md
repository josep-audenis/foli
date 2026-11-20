# Example: a plugin

A plugin adds a command (`editor.commands.insertTodo`), a key that runs it (Ctrl+Shift+O, or
⌘+Shift+O on a Mac) and a toolbar button for it; its extension's decorations mark every "TODO"
in the text. The decorations are computed in the plugin's state, only when the document changes,
and never change the document, the clipboard or what is saved. The API:
[Plugin commands and keymaps](../../../../docs/api.md#plugin-commands-and-keymaps),
[View extensions](../../../../docs/api.md#view-extensions), [Keyboard](../../../../docs/keyboard.md).

Click in the document and press Ctrl+Shift+O, or type "TODO" yourself.
