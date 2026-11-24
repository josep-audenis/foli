# @folijs/mcp

An MCP server for [Foli](https://github.com/josep-audenis/foli): the model of an MCP client
(Claude Code, Claude Desktop, an editor's assistant) reads and edits Word documents through
tools. Every edit is a tracked change, and every note a comment, for a person to accept or
reject in Word. Built on [`@folijs/agent`](../agent/README.md); its dependencies are
Foli's own packages and, for the sandbox of `--code`, QuickJS as WebAssembly (MIT).

> **Unstable (0.x).** Outside the 1.0 promise of the other packages: tools and options may
> change in any 0.x release; changes in `CHANGELOG.md`. Every tool is driven by the official
> MCP SDK's client in the tests, on Windows and Linux, and Claude Code 2.1.92 connects to it. A
> model has done whole tasks with the tools through that SDK client; **it has not yet been
> tried with a model in a client of its own (Claude Code, Claude Desktop).**

## Set up

The server is a program the client starts. It needs Node 20.19 or later.

```
foli-mcp [--root <folder>] [--author <name>] [--overwrite] [--code]
```

In Claude Code, for the project you are in:

```bash
claude mcp add foli -- npx -y @folijs/mcp --root .
```

Clients that are configured with a file take the same command, in the shape most of them share
(not tried in any client):

```json
{
  "mcpServers": {
    "foli": {
      "command": "npx",
      "args": ["-y", "@folijs/mcp", "--root", "C:/Users/me/Documents/contracts"]
    }
  }
}
```

- **`--root <folder>`**: the only folder the server reads from and writes to, subfolders
  included. Default: the folder the client starts it in, which in a desktop client may be your
  home folder: give `--root`. A whole drive is refused.
- **`--author <name>`**: whose tracked changes and comments the edits are, as Word will show
  them. Default: the name the client gives itself, or "Agent".
- **`--overwrite`**: lets `save` write over existing files, the original included. Without it
  a save writes over nothing but its own earlier saves.
- **`--code`**: adds the `run` tool, which runs a script the model writes in a sandbox
  ([code mode](#code-mode---code)). Without it the server runs no code it is given.

## What the model can do

It opens a `.docx` by its path under the root, reads it as lines, one per block, each starting
with a handle (`[b7]`), and edits by handle:

| Tool                              | What it does                                                      |
| --------------------------------- | ----------------------------------------------------------------- |
| `open`, `list_documents`, `close` | Opens a `.docx` (several at once, each with an id), lists, closes |
| `read`                            | The body, 200 blocks at a time; with `headers`, headers, footers  |
| `replace_text`                    | Replaces text in a paragraph                                      |
| `insert_paragraphs`               | New paragraphs before or after a block, in a style if named       |
| `delete_block`                    | Deletes a paragraph, or a table                                   |
| `set_style`, `list_styles`        | Puts a paragraph in a style                                       |
| `comment`                         | A comment on a paragraph, or on text in it                        |
| `list_controls`, `fill_control`   | A template's content controls: text, lists, dates, check boxes    |
| `update_fields`                   | Fills merge fields from data; updates dates and references        |
| `edit_table`                      | Inserts tables; rows in and out, cells' text, style, shading      |
| `format_text`                     | Bold, italic, font, size, color, highlight, links on text         |
| `format_paragraph`                | Alignment, spacing, indentation, bullet and numbered lists        |
| `insert`                          | Pictures (a file under the root), breaks, lines, footnotes        |
| `save`                            | Writes a `.docx`                                                  |
| `run` (with `--code` only)        | Runs a script the model writes over a document, in a sandbox      |

What the tools return, the read format and what each operation refuses are `@folijs/agent`'s:
see [its README](../agent/README.md). The server tells the model the format in its
instructions and in each tool's description; no system prompt is needed.

## What it does to your files

- It reads and writes **`.docx` files under the root only**, by names relative to it. A path
  that leaves the root, by `..`, an absolute path or a link, is refused.
- **`save` does not write over your document.** Without a path it writes a new file beside the
  original: `contract.docx` → `contract.agent.docx` (`contract.agent-2.docx` if that is
  taken). With a path, it refuses a file that exists unless the server wrote it itself in this
  run, or was started with `--overwrite`.
- A save is written whole or not at all: to a new file, then moved into place.
- Nothing is saved until the model calls `save`. A document open when the server stops is lost
  with its unsaved edits.
- No other access: it lists no folders, deletes nothing, and makes no network request.
- A document may grow about 16 million characters past what it was when opened; an edit
  past that is taken back. Save, close and open the saved file to go on.

A document's text is data to the server, but a model may act on what a document says. What
that can do here is bounded by the above: no file outside the root, none written over, and
every edit a tracked change you review. More in
[security](https://github.com/josep-audenis/foli/blob/main/docs/security.md#the-mcp-server-folijsmcp).

## Code mode (`--code`)

Since 0.2.0. Off unless asked for. A model has done whole tasks with it through the official
SDK's client; not yet in a client of its own (Claude Code, Claude Desktop).

Started with `--code`, the server has one more tool, `run`: the model writes a JavaScript
script and the server runs it over an open document, so a task that is the same step on many
blocks is one call and not one per block. The script sees one object, `doc`, with the
operations the other tools have, and nothing else: no files, no network, no modules, no
timers. It runs in QuickJS compiled to WebAssembly, in a thread of its own that the server
ends after 10 seconds; 64 MB of memory and 5,000 calls to the document at most, and a run
may insert 2,000 paragraphs and give the document a million characters. Every edit
is a tracked change. A script that throws or is stopped changes nothing: its edits are all
taken back. Why and how:
[ADR-0010](https://github.com/josep-audenis/foli/blob/main/docs/decisions/ADR-0010-code-mode.md).

It is off unless asked for because it runs code a model wrote, which may have read a
document written to mislead it. What such code can do is what the tools can: edit the open
documents, as tracked changes.

## Limits

- Files up to 64 MB, 64 MB unpacked; at most 16 documents open, and about 3 million characters
  of body among them. A tool's answer over 200,000 characters is cut at a block's end; a
  read's `(more: …)` line then names the first block cut away.
- `null` for an argument that may be left out counts as leaving it out. A save the system
  refuses (the file open in Word, a folder not writable) says so.
- Headers and footers are read with `read`'s `headers` and edited with the same tools (no
  comments, breaks or notes there); the text of notes is not read (`update_fields` updates
  their fields).
- No pages: `update_fields` leaves page numbers as they are, and a table of contents too
  unless asked (`contents`), when its page numbers come back empty until Word updates it.
- One client, over stdin and stdout. No network transport.
- What the library does not do, the server does not: no tables or pictures inserted, no
  formatting of text, no accepting or rejecting changes.
  [Limitations](https://github.com/josep-audenis/foli/blob/main/docs/limitations.md#the-mcp-server-folijsmcp).

## As a library

`serve(input, output, options)` is the protocol loop with any tools (`Tool`: a name, a
description, a JSON Schema for the arguments, a function); `foliServer({ root, author,
overwrite, version })` gives the options of this server. How it is built and why:
[ADR-0009](https://github.com/josep-audenis/foli/blob/main/docs/decisions/ADR-0009-mcp-server.md).
