# Security

What Foli checks, where, and what stays the embedding app's job. Reviewed for 1.0 (roadmap
12.11, 2026-11-20).

## Threat model

Foli runs in the user's browser tab (the editor, the view, `exportPdf`) and in Node or a
browser (`@folijs/core`, `@folijs/docx`). The MCP server is a program of its own, with its own
section below. Untrusted input reaches the editor and the libraries as:

- **Pasted data**: HTML from any page, Foli's own clipboard JSON (which a hostile page can
  forge), plain text.
- **Documents**: Foli JSON (`parseDocument`, `setDocument`, `initialContent`) and `.docx` files
  (`importDocx`), possibly uploaded by someone other than the user who opens them.
- **Links and pictures** inside either.

What an attacker wants: script running in the app's origin (XSS), requests the user did not
mean to make (tracking, credential leaks), or a crash or hang (denial of service) of a tab or a
server that imports `.docx` or prints PDFs. Extension code (node views, plugins, decorations) is
the app's own code and is trusted; it is checked against mistakes, not against an attacker.

## What is checked where

| Input                        | Where                                                   | What                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Foli JSON                    | `parseDocument`, `parseContent` (core `v3/document.ts`) | Every node, mark and attribute validated against the schema; unknown keys refused; nesting depth limited; later-version content refused; never repaired or dropped silently (`FoliDocumentError`)                                                                                                                                                                  |
| Pasted HTML                  | view `clipboard.ts` (`readHTML`)                        | Parsed with `DOMParser` into an inert document, never inserted; only mapped tags kept; colors parsed; links kept only when `isSafeHref`                                                                                                                                                                                                                            |
| Foli clipboard JSON          | `data-foli-clipboard` in the HTML, core `wordclip.ts`   | Read with `getAttribute` only from a lone wrapper; content through `parseContent` with the editor's schema, styles and notes through `parseDocument` (`fitPaste`); unsafe links dropped when the copy names no definitions                                                                                                                                         |
| Links                        | core `isSafeHref` (`schema.ts`), the view, `exportPdf`  | `http:`, `https:`, `mailto:`, `tel:` or relative; control characters, spaces and backslashes refused (`java\tscript:`). The view keeps a link as `data-href` and opens only a safe one; copied HTML and PDF link annotations carry only safe absolute ones                                                                                                         |
| `.docx` zip                  | docx `zip.ts`                                           | At most 10 000 entries and 512 MiB uncompressed (`ZipLimits`); a declared size deflate cannot produce refused; duplicate (case-insensitive) and overlapping entries refused; encrypted, ZIP64 and other methods refused; inflating stops at the declared size; part names never touch a disk                                                                       |
| `.docx` XML                  | docx `xml.ts`, `package.ts`                             | DTDs and entities refused (no XXE, no entity expansion); nesting at most 1000 (`maxDepth`); at most 4 000 000 nodes across the parts read, each element, attribute, text, comment and instruction counted and a paragraph four times (`maxNodes`, 12.11); invalid characters and encodings refused; linear time (a long paragraph's quadratic scan fixed in 12.11) |
| `.docx` relationships        | docx import                                             | External targets are never fetched; hyperlink targets are kept as written (lossless) and filtered where opened, as above                                                                                                                                                                                                                                           |
| Pictures                     | core `checkResource`, view `blocks.ts`                  | A resource's `data` must be an image `data:` URL; `url` must be a safe web URL. Drawn only through `<img>` (an SVG's scripts do not run there), with `referrerpolicy="no-referrer"`                                                                                                                                                                                |
| `exportPdf`                  | pdf `index.ts`                                          | The document is validated with `parseDocument`; the print page has a Content Security Policy blocking every network request; pictures only from `data:` URLs                                                                                                                                                                                                       |
| Node views, decorations, `h` | view `extension.ts` (12.4)                              | Elements from an allowlist (no script, SVG, forms or frames); `on*` handlers, `srcdoc`, `contenteditable` and the view's `data-foli-*` refused; URL attributes and `srcset` through `isSafeHref`; `style` without `url(`, `expression`, `@import` or escapes                                                                                                       |
| Docs site markdown           | `apps/site/src/docs/build.ts`                           | Raw HTML shown as text; links and images other than `http`, `https`, `mailto` or relative rendered as text; search results built with `textContent`                                                                                                                                                                                                                |

No package uses `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function`
with document or pasted data (the clipboard reads back markup it built itself).

## The app's responsibility

- **A Content Security Policy** on the page hosting the editor. Without `img-src` limits a
  document's web pictures load when shown (a tracking pixel is possible); pass the view's
  `resource` option to decide which URLs load.
- **Limits on a server.** `importDocx` and `exportPdf` run in the caller's process: give an
  uploaded `.docx` a size limit before reading it, lower `maxSize` and `maxNodes` to what your
  documents need, and run imports with a time limit in a worker or a separate process. Measured
  in Node (12.11): a 659-page document of dense tables takes about 0.8 GB at its peak; at the
  default limit the costliest crafted file found (a few tens of kilobytes of one-tab paragraphs)
  about 2.3 GB and 12-28 s depending on heap headroom, comment-only and attribute-heavy files less (0.4 and 0.8 GB). That bounds
  a crash, not what a shared server can afford.
- **Fetching resources** in a `resource` or `resources` callback is the app's code: check the
  URL there (server-side request forgery).
- **Exported `.docx` from untrusted JSON is untrusted.** Opaque XML and field codes are written
  as they are (well-formed, never re-parsed as markup); a field such as `INCLUDEPICTURE` with a
  network path can make Word fetch it when fields update, as any `.docx` can.
- **Extensions** are trusted code: what a node view's `render` returns is not checked, and `h`
  allows `id`, `name` and `position: fixed`, which can clash with the host page.

## The MCP server (`@folijs/mcp`)

Not part of 1.0: a 0.x package (Phase 14), reviewed as it was built
([ADR-0009](decisions/ADR-0009-mcp-server.md)). It is the one Foli program that reads and writes
the user's files, started by an MCP client the user configured and driven by a model.

**Who is not trusted.** The client's messages (checked as any input). The model's tool calls: a
model may be following text planted in a document it read, so every argument is treated as an
attacker's. The files under the root, which may come from someone else: hostile `.docx` files,
links, odd names.

| What                             | Where                                                                        | Rule                                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A line from the client           | `mcp/src/protocol.ts`                                                        | JSON-RPC 2.0, at most 8 MB; what is not a message is answered with an error or ignored; one message at a time                                                                                                                              |
| A tool's arguments               | `mcp/src/schema.ts`                                                          | Checked against the tool's schema before it runs; no property that is not named (`update_fields`' `data` takes any name: its values are the library's to check)                                                                            |
| A path                           | `mcp/src/files.ts`                                                           | A relative `.docx` name (or, for `insert`, a `.png`, `.jpg`, `.jpeg` or `.gif`), no `..`, `:` or control character; its real path under the root's; outside is "not there"                                                                 |
| A file read                      | `mcp/src/files.ts`, `documents.ts`                                           | 64 MB; 64 MB unpacked and 400,000 XML nodes; the open documents 3 million positions together, 16 at most; open once; a picture 16 MB, its bytes in the session's weight                                                                    |
| A file written                   | `mcp/src/files.ts`                                                           | A new file made exclusively, renamed into place; never over what is not a plain file; over a file only its own or with `--overwrite`                                                                                                       |
| What a document names            | `agent/src/read.ts`, `operations.ts`, `templates.ts`; `mcp/src/documents.ts` | Shown on one line: a text, a style, a list number, a control's name, items and value, a field's instruction, a merge field's name and the reader's error cannot start a line of an answer                                                  |
| What an edit makes of a document | `mcp/src/weight.ts`, `tools.ts`, `code.ts`                                   | Its weight as it would be saved (body, stories, comments; formatting and attributes included) may grow 16 million characters past what it weighed when opened, over a whole session; a tool call or a run that would pass it is taken back |
| An answer                        | `mcp/src/protocol.ts`                                                        | Cut at 200,000 characters                                                                                                                                                                                                                  |
| The author's name                | `mcp/src/server.ts`                                                          | One line, no control characters, whole characters, 60 at most                                                                                                                                                                              |
| The log (stderr)                 | `mcp/src/protocol.ts`                                                        | A tool's or a method's error by kind and place, never its message (a failure to start says its own, which holds no document's text)                                                                                                        |

**Code mode (`--code`, off by default; [ADR-0010](decisions/ADR-0010-code-mode.md)).** The
`run` tool takes a script the model wrote. The script is as little trusted as a tool's
arguments, and can do more work with them, so it is held by more:

| What                         | Where                                                    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where a script runs          | `mcp/src/sandbox.ts`, `sandbox-worker.mjs`               | QuickJS compiled to WebAssembly, in a worker thread made for the run and ended after it: the language, and no object of Node, no file, network, module or timer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| What a script reaches        | `mcp/src/code.ts`                                        | `doc`: the operations of the tools over the one open document, checked as the tools' are. No `open`, no `save`, no path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| What crosses                 | `mcp/src/sandbox.ts`                                     | JSON text, both ways; a call's arguments 200,000 characters at most, refused in the sandbox and again before `JSON.parse`; the result made text inside the sandbox, a million characters at most                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Time                         | `mcp/src/sandbox.ts`                                     | 10 s for the script, from when its thread is ready, and 30 s for the thread to get ready (QuickJS loaded, the prelude run; it says so before any of the script runs, so no script can stretch it): the server ends the thread, whatever it is doing. The server's own work for a run is held by counts: 500 paragraphs an insert, 500 places a replace, 300,000 characters written by one operation (a replace's places, a fill's controls, the results of a field update, together); 2,000 paragraphs inserted, 300,000 characters added to the body, or a million characters given by its calls, a run; taking a run back is one step whatever it did |
| Memory, stack, calls         | `mcp/src/sandbox.ts`                                     | 64 MB for the script (the WebAssembly memory is refused growth past it: QuickJS's own limit does not count bytes); the server's own memory for a run is what the document and its edits take (under 700 MB seen for the worst scripts of four reviews), a 192 kB stack under the thread's 4 MB, 5,000 calls to the document; the thread's own heap 80 MB                                                                                                                                                                                                                                                                                                |
| A run that does not end well | `agent/src/session.ts` (`checkpoint`), `mcp/src/code.ts` | Every edit it made is taken back: the document and its handles as before the run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| What a script says           | `mcp/src/code.ts`                                        | Its value as JSON on one line, its log a line per call, an error's message on one line; each held to a size                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| What the thread prints       | `mcp/src/sandbox.ts`                                     | Taken: it never reaches stdout, which carries the protocol                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

A script cannot turn tracking off, change the author, or reach a document that is not open: it
has no editor, only `doc`. What it can do is what a patient series of tool calls can: edit
every block of the open documents, as tracked changes. Known and accepted: while a script
runs the server answers nothing else: the thread's start (under 0.1 s on an idle machine, 30 s at most), 10 seconds, then the call under way and the
taking back (10.0 to 10.2 s after the start for the worst scripts four reviews found; measured, not proved); QuickJS and the WebAssembly
engine are trusted to hold the script (a flaw in either is a flaw here); fuzzed with scripts
made of the operations and of the ways a run can end, not with scripts written to break
QuickJS itself.

**What stays the user's.** Choosing the root: everything under it can be read by the model and
so reach the model's provider. `--overwrite`. `--code`. Reviewing the tracked changes: the server cannot
tell a good edit from one a document talked the model into. What the client lets the model do
with what it read (other tools, the network) is the client's.

**Known and accepted:** a file that appears at a save's target between the last check and the
rename is replaced; a hard link inside the root to a file outside it is read as the file it is;
a server stopped while saving leaves a `.name.pid.time.tmp` file beside the target; the
protocol is not authenticated (stdio: whoever started the process speaks to it). Not checked on
macOS or with a model in a real client.

## Residual risks (known, accepted for 1.0)

- Pasted data has no size limit: a huge paste slows only the user's own tab. A copied picture
  carries its image as a `data:` URL in the clipboard, so a large one makes a large copy.
- A Foli copy carrying definitions keeps its links as written (as a `.docx` import does); every
  place that opens a link filters it.
- Web pictures are fetched when shown unless the app says otherwise (above).

## Reporting a vulnerability

Please do not open a public issue. Report it privately with GitHub's private vulnerability
reporting: on the [repository](https://github.com/josep-audenis/foli), the **Security** tab, then
**Report a vulnerability**
([direct link](https://github.com/josep-audenis/foli/security/advisories/new)), with the input
that triggers it and the package versions. Fixes are released as patches of the affected packages and listed in their
changelogs.
