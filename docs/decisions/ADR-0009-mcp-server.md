# ADR-0009: The MCP server

- **Status:** Accepted when merged, task 14.1 (2026-11-21), by an agent's review, as the owner
  asked for Phase 14 ("merge and build", each task merged after review). The owner chose on
  2026-11-21 to start from the proposals of the phase's plan, which this record keeps.
- **Context:** `@folijs/agent` (Phase 13, 0.1.0) lets a model read and edit a document by block
  handles, every edit a tracked change. It is a library: an agent that can run code uses it
  directly. An agent that cannot (a chat client, an editor's assistant) speaks the Model
  Context Protocol to programs it starts. Foli has no such program, no runtime dependency
  besides React and its own packages ([architecture](../architecture.md#dependency-policy)),
  and nothing that reads or writes the user's files.

## Question

How does `@folijs/mcp` speak the protocol, what may it read and write, and what tools does it
give a model?

## Spike (`packages/mcp`, kept: it is the start of 14.2)

A stdio server written by hand (`src/protocol.ts`, about 200 lines; `src/schema.ts`, the check
of a tool's arguments): JSON-RPC 2.0, one message per line, `initialize`, `ping`, `tools/list`,
`tools/call`, and one tool, `read`, that reads a `.docx` under the working directory with
`@folijs/docx` and `@folijs/agent`.

- **The official SDK's client** (`@modelcontextprotocol/sdk` 1.32.2, a devDependency) connects
  to it over two in-process streams, byte for byte what stdin and stdout carry: it initializes,
  reads the server's name, capabilities and instructions, pings, lists the tools and calls
  them, on the oldest and the newest protocol version the server answers
  (`protocol.test.ts`). Every line the server writes goes through the SDK's own message schema
  first, as its transports do, so a reply that is not a valid message fails the test.
- **Claude Code 2.1.92**, with the built `bin` registered in a project (`claude mcp add`),
  reports it `✓ Connected` (`claude mcp get foli`). A model calling the tool through Claude
  Code was not tried: the CLI on the machine is not logged in. It is task 14.6's check.
- **By hand over stdio** (five lines piped to `node dist/bin.js`): the read of the corpus NDA
  comes back as a tool result; a line that is not JSON and an unknown method as JSON-RPC errors.

The SDK, were it a runtime dependency: MIT, `zod` as a peer, 17 dependencies (express, hono,
jose, ajv, cors, eventsource…), 4.5 MB unpacked (npm, 2026-11-21), most of it the HTTP
transports and their authentication.

## Decision

### The protocol is written here, and checked by the SDK's client

`@folijs/mcp` has no runtime dependency but Foli's own packages. It speaks what a server with
tools needs: `initialize`, `ping`, `tools/list`, `tools/call`, notifications ignored, anything
else `-32601`. The SDK's client is the conformance check in the tests; a real client is tried by
hand at the phase's end. **Reverse this** (take the SDK) when a client that matters does not
work with the server and the cause is the protocol, or when the server needs a part of the
protocol that is not small (a network transport, authentication).

- **Versions** answered: `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. A client asking
  for one of them gets it; any other gets the newest, as the protocol says, and decides.
  A new version of the protocol is added here when the SDK's client in the tests asks for it.
- **No batches**, a known deviation: `2025-03-26` says a server must take a JSON-RPC batch
  (an array of messages), and `2025-06-18` removed them. The server answers an array with
  `-32600` on every version. No client found sends one; the SDK's client does not.
- **An error for nothing that had an id has no `id`** (bad JSON, a line over the limit): MCP's
  messages do not allow `"id": null`, which JSON-RPC 2.0 itself would use there.
- **Ids** are strings or whole numbers; another id is answered as an invalid request.
- **stdout carries protocol messages only**; what the server has to say besides goes to stderr.
- **One message at a time, in order**: a tool call is finished, and its answer taken by the
  client, before the next message is read. Edits to a document cannot interleave, and a client
  that does not read cannot make the server hold its answers in memory. The cost: while a tool
  runs nothing else is answered, a `ping` included. So a tool must be bounded: the files' size
  limits (below) are what bounds them.
- **Limits:** a line over 8 MB is dropped, however it arrives, and answered with an error; the
  server goes on.
- **A tool's arguments** are checked against its schema before it runs, and the schema is
  published as it is checked: an object takes no property it does not name.
- **Not spoken:** resources, prompts, sampling, logging, progress, cancellation (a call is
  short), tasks, any transport but stdio.

### What a tool returns

Text, the library's own: the blocks in the read format, or a sentence. A refusal of the
library, and arguments that do not fit the tool's schema, are a result with `isError: true` and
the message, which the model reads and acts on; not a JSON-RPC error, which clients may keep
from the model. An unknown tool is a JSON-RPC error (`-32602`). A tool that throws is logged on
stderr and answered with `isError` and no detail.

The server's `instructions` (in `initialize`) are the system prompt of `@folijs/agent`'s README,
adapted to the tools' names; each tool's description stands without it, since not every client
passes instructions on.

### Files

The server is the first Foli program on the user's files, started by a client the user
configured, driven by a model whose input may come from a document (a prompt injection). So:

- **A root.** `--root <dir>`, default the working directory the client starts it in. A file
  system's own root (`/`, `C:\`) is refused as the root: a client that starts the server there
  has not chosen a folder.
- **A path is a relative name going down**: no absolute path, no `..` (it would say what the
  folders above the root are called), no `:` (on Windows `a.docx:b.docx` is a stream of the
  file `a.docx`), no control character. It is resolved against the root; the file's real path
  (links followed) must be inside the root's real path, and for a file to be written its
  folder's real path, checked at the time of the write. What lies outside is answered as what
  is not there. The paths a tool gives back are relative to the root.
- **Only `.docx`**, by extension (capitals not counting), read and written.
- **A save never destroys by default.** `save` without a path writes `<name>.agent.docx`
  beside the input, or `<name>.agent-2.docx`… when that is taken. Writing over the input, or
  over any file the server did not write itself in this run, is refused unless the server was
  started with `--overwrite`. "Its own" is the path and the file as it left it (its size and
  time): a file someone put there since is theirs.
- **A save never writes through a link or leaves half a file.** The bytes go to a new file in
  the same folder, created exclusively, then renamed over the target. A target that is not a
  plain file (a link, even one that points nowhere; a folder) is refused, with `--overwrite`
  too. So a link planted in the root cannot send a save outside it, and a server stopped while
  saving leaves the old file whole. shortcut: between the last look at the target and the
  rename a file that appears there is replaced; upgrade to a hard link and unlink, which
  cannot replace, if that window ever matters.
- **A file is open once**: a second `open` of it is refused, since two sessions would each save
  over the other's edits.
- **No other access:** no listing of directories, no deleting, no network.

### Size

A hostile file is small on disk and large in memory, and a tool call is answered whole, so each
of these is bounded:

- A file over 64 MB is not read. `@folijs/docx` is held to 64 MB unpacked and 400,000 XML nodes
  a file (its own limits are 512 MB and 4 million).
- The documents open hold at most 3 million positions of body together (a character or a
  block's edge each; a long report is some hundred thousand); an `open` that would pass it is
  refused. At most 16 documents.
- A tool's result is cut at 200,000 characters, and says so; a refusal quotes at most 2,000
  characters of a block.
- A line read from the client is at most 8 MB (above).

Measured by the review of #153 before these limits: a 23 KB file of empty paragraphs held 300 MB
of heap, the fourteenth open of it ended the process; a 266 KB file returned 251 MB as a result.

### What a document says is data

A read is text from a file, and may say anything, to a model that may believe it. What bounds
the damage is above: no tool reaches outside the root, none overwrites by default, and every
edit is a tracked change a person reviews. Besides, a document cannot forge the tools' own
lines: everything a document names that is put in an answer (a block's text, a style, a list
number, a control's tag, title and items, the reader's error) is shown on one line, every
character that ends a line as ↵ (in `@folijs/agent`). **Logs** (stderr) get the server's own
errors by kind and place, never a message, which may quote a document.

### Author

Tracked changes and comments are made in the name given by `--author`; without it, the client's
name from `initialize` (`clientInfo.name`); without that, "Agent". A name is made fit to be
written first: one line, no control characters, whole characters only, 60 at most. An
`--author` with nothing left is refused at start.

### Documents and sessions

`open` reads a file and makes an `@folijs/agent` session, kept in memory under an id (`d1`,
`d2`…) until `close` or the server's end, within the limits above. Every other tool takes the
document's id, which may be left out while one document is open. Handles (`b7`) are a
document's own. `close` refuses a document with changes not saved unless told to discard them; "changes" is
whether the document differs, whatever the tools answered.
Nothing is saved on its own.

### Tools

One per operation of the library, named for the model, plus the documents':

| Tool                                      | Library                                  |
| ----------------------------------------- | ---------------------------------------- |
| `open`, `save`, `close`, `list_documents` | `importDocx`, `exportDocx`, the sessions |
| `read`                                    | `read` (`from`, `limit`)                 |
| `replace_text`                            | `replaceText`                            |
| `insert_paragraphs`                       | `insertAfter`, `insertBefore`            |
| `delete_block`                            | `deleteBlock`                            |
| `set_style`, `list_styles`                | `setStyle`, `styles`                     |
| `comment`                                 | `comment`                                |
| `list_controls`, `fill_control`           | `controls`, `fillControl`                |
| `update_fields`                           | `updateFields`                           |

Not `block` (a `read` of one). Not `session.editor`: no tool takes positions.

### Package

`packages/mcp`, `@folijs/mcp`, 0.x, outside the fixed group, `private` until its release. Its
dependencies (`@folijs/agent`, `@folijs/docx`, `@folijs/core`) are exact, not peers: it is a
program, not a library an app composes. Node ≥ 20.19, as the repository. A `bin`, `foli-mcp`.
It exports `serve` and the `Tool` type, for a server with other tools; that API is in the API
report. No bundle size budget: nothing ships it to a browser.

## Consequences

- The protocol is Foli's to follow. It has had four versions in a year (2024-11 to 2025-11);
  the four methods are in all of them, and the SDK's client finds them on the oldest and the
  newest.
- A client that needs what is not spoken (a remote server, OAuth) cannot use it.
- The file rules make a model unable to overwrite the user's document by a tool call alone:
  the user decides that when configuring the server.
- `@folijs/agent` may change where a tool shows it lacking; it is 0.x.

## Alternatives considered

- **The SDK as a runtime dependency.** Less code here, the protocol followed by its authors. 17
  dependencies and `zod` for a stdio loop; the repository's first third-party runtime code.
  Kept as the way back (above).
- **The server inside `@folijs/agent`** (an entry point `@folijs/agent/mcp`). One package less;
  the library would carry a Node program and follow the protocol's releases. Decided against
  with the owner on 2026-11-21 (roadmap, Phase 13).
- **Fewer, wider tools** (one `edit` with an `operation` argument). Fewer names for the client
  to list; a schema the model fills worse, and refusals that are harder to word. One tool per
  operation, as the library's methods.
- **Saving over the input by default**, as an editor does. One step less for the user; a model
  misled by a document's text could then destroy the document.
