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

A stdio server written by hand (`src/protocol.ts`, about 150 lines; `src/schema.ts`, the check
of a tool's arguments): JSON-RPC 2.0, one message per line, `initialize`, `ping`, `tools/list`,
`tools/call`, and one tool, `read`, that reads a `.docx` under the working directory with
`@folijs/docx` and `@folijs/agent`.

- **The official SDK's client** (`@modelcontextprotocol/sdk` 1.32.2, a devDependency) connects
  to it over two in-process streams, byte for byte what stdin and stdout carry: it initializes,
  reads the server's name, capabilities and instructions, pings, lists the tools and calls
  them, on the oldest and the newest protocol version the server answers
  (`protocol.test.ts`, 7 tests).
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
- **No batches.** The protocol dropped JSON-RPC batches in `2025-06-18`; an array is answered
  with `-32600`.
- **stdout carries protocol messages only**; what the server has to say besides goes to stderr.
- **One message at a time, in order**: a tool call is finished before the next message is read.
  Edits to a document cannot interleave.
- **Limits:** a line over 8 MB is dropped and answered with an error; the server goes on.
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

- **A root.** `--root <dir>`, default the working directory the client starts it in. Every path
  a tool takes is resolved against it; the file's real path (symlinks followed) must be inside
  the root's real path, or the tool refuses. For a file to be written, its directory's real
  path.
- **Only `.docx`**, by extension, read and written. A file over 64 MB is refused before it is
  read; what is inside is `@folijs/docx`'s to refuse (its zip limits), as a refusal, never a
  crash.
- **A save never destroys by default.** `save` without a path writes `<name>.agent.docx`
  beside the input. Writing over the input, or over a file the server did not write itself in
  this run, is refused unless the server was started with `--overwrite`.
- **No other access:** no listing of directories, no deleting, no network.

### Author

Tracked changes and comments are made in the name given by `--author`; without it, the client's
name from `initialize` (`clientInfo.name`); without that, "Agent".

### Documents and sessions

`open` reads a file and makes an `@folijs/agent` session, kept in memory under an id (`d1`,
`d2`…) until `close` or the server's end; at most 16 at once. Every other tool takes the
document's id, which may be left out while one document is open. Handles (`b7`) are a
document's own. `close` refuses a document with changes not saved unless told to discard them.
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
