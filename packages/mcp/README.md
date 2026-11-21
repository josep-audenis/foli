# @folijs/mcp

An MCP server for [Foli](https://github.com/josep-audenis/foli): the model of an MCP client
reads and edits `.docx` files through tools, every edit a tracked change in Word's sense, for a
person to accept or reject. Built on `@folijs/agent`; it has no dependency but Foli's own
packages.

> **In development (roadmap, Phase 14), not released.** The server and its tools are built;
> they have not been tried with a model in a real client yet. How it works and why:
> [ADR-0009](../../docs/decisions/ADR-0009-mcp-server.md).

```
foli-mcp [--root <folder>] [--author <name>] [--overwrite]
```

- It reads and writes `.docx` files under `--root` only (default: the folder it is started in),
  by paths relative to it.
- `save` writes a new file beside the original (`contract.agent.docx`). It writes over a file
  only if it wrote that file itself, or was started with `--overwrite`.
- Changes and comments are in the name given by `--author`, else the client's name.

Tools: `open`, `read`, `replace_text`, `insert_paragraphs`, `delete_block`, `set_style`,
`list_styles`, `comment`, `list_controls`, `fill_control`, `update_fields`, `save`, `close`,
`list_documents`.
