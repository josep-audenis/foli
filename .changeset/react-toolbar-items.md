---
"@folijs/react": minor
---

Toolbar items and command hooks (ADR-0008):

- `FoliToolbar` takes `items`, groups of items (a separator between groups), and `FoliEditor`'s
  `toolbar` takes the same groups in place of `true`. The built-in items are exported by name in
  `toolbarItems` (`toolbarItems.bold`, `toolbarItems.table`…) and the default toolbar as
  `defaultToolbarItems`, so an app adds, removes, reorders and regroups them. Without `items`
  the toolbar is as before.
- An app's item (`ToolbarItem`) runs a command and is enabled by its dry run (`editor.can`), or by
  its own `enabled`; `pressed` makes it a toggle; `icon` stands for its text. With `actions`
  (`ToolbarAction`s) it is a menu button like the built-in menus, which take more entries the
  same way. App items keep the toolbar's one tab stop, arrow keys, `aria-pressed`,
  `aria-disabled` and the document's focus and selection on click.
- `useCommand(command)` gives `{ enabled, run }` for a button of the app's own: a dry run after
  every transaction, and a way to run it. `useCommand(name, ...args)` does the same for a
  plugin's command by name, typed by `FoliCommands`.
- `plugins` and `extensions` stay read once: changing them after mount now logs one warning
  outside production (a new array of the same plugins is no change). Give the component a new
  `key` to create an editor with them.

New names: `toolbarItems`, `defaultToolbarItems`, `ToolbarItem`, `ToolbarAction`,
`ToolbarItemName`, `useCommand`, `UseCommandOptions`, `CommandState`.
