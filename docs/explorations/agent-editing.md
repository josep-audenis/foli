# Exploration: agents editing documents

Status: **exploration, nothing built.** Written 2026-11-21 after 1.0.0. Collaboration is left out
on purpose (a later exploration); this note is about an AI agent editing a document without
touching OOXML.

## What exists today

Everything an agent needs already runs headless, in Node, workers and the browser:

- `importDocx(bytes)` → `{ document, package }`, `exportDocx(document, package)` (lossless for
  what Foli does not edit).
- `createEditor({ document, author, trackChanges })`: commands, undo, `findAll`, `replaceAll`,
  `fieldsIn`/`updateFields`, tables, comments, content controls.
- With `author: "Agent", trackChanges: true` every edit comes out as a Word tracked change that a
  person accepts or rejects in Foli or in Word. That is the main selling point: the agent proposes
  and a person decides.

What is missing is an API an LLM can use well. Commands take integer positions (`from`, `to`),
and models are bad at computing positions.

## Proposed layers

1. **`@folijs/agent`, a library.** A facade over the headless editor, with no sandbox, no file
   system and no DOM:
   - Reading: an outline or Markdown-like text of the document where each block has a handle.
     Paragraphs imported from Word keep `w14:paraId` in their attributes; whether paragraphs
     Foli creates get one is not checked yet, so handles may have to be issued per read.
   - Writing, a few coarse operations: `replaceText(block, find, with)`,
     `insertAfter(block, content)`, `setStyle(block, style)`, `comment(block, text)`,
     `insertTable`, `fillField`, `acceptChange`/`rejectChange`.
   - Tracking on, author set by the caller, by default.
2. **`@folijs/mcp`, an MCP server** with plain tools over the facade: `open`, `read_outline`,
   `read_block`, `edit` (the operations above), `export_docx`. Works in any MCP client.
3. **Later, only if asked for:** a `run(code)` tool in the MCP server (code mode). See below.

## Where code mode's sandbox runs

Code mode (Cloudflare's name; Anthropic calls it code execution with MCP) gives the model a typed
API and lets it write a script instead of making one tool call per operation. That suits
documents: "number every heading 2", "replace X in every table cell" is one loop, not dozens of
calls. Foli already ships typed `.d.ts` files, which is what code mode feeds the model.

The sandbox does **not** belong in `@folijs/agent`. It depends on the agent:

| Agent                                                                                           | Where the code runs                        | What Foli ships                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Can already run code (Claude Code, Codex, Claude's code-execution tool, any agent with a shell) | The agent's own sandbox                    | Nothing extra: `npm i @folijs/core @folijs/docx @folijs/agent` and a script |
| Talks MCP only (chat apps, Cursor chat, agents without code execution)                          | The MCP server                             | A sandbox inside `@folijs/mcp`                                              |
| Anthropic API with programmatic tool calling                                                    | Anthropic's sandbox, calling the MCP tools | A plain MCP server                                                          |

So the first two layers cover most agents with no sandbox at all.

## Sandboxes for `run(code)`

The model's code is untrusted input. The sandbox needs time and memory limits, no network or file
system, and nothing exposed but the document.

|                  | `isolated-vm`                                                                                                                                                           | `quickjs-emscripten`                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| What             | A V8 isolate in Node (native addon)                                                                                                                                     | QuickJS compiled to WASM                                                           |
| Version, license | 7.0.2, ISC                                                                                                                                                              | 0.32.0, MIT                                                                        |
| Maintenance      | README: "currently in _maintenance mode_"                                                                                                                               | Active (last release 2026-02)                                                      |
| Runs in          | Node ≥ 24 only; prebuilt binaries for Node 24 and 26 (ABI 137, 147) on Windows x64, Linux x64/arm64 (glibc, musl), macOS arm64                                          | Node, browsers, Deno, Bun, Cloudflare Workers                                      |
| Size             | 21 MB unpacked (the prebuilt binaries)                                                                                                                                  | ~2.4 MB with all four variants; one variant ~650 kB                                |
| Limits           | `memoryLimit`, `timeout`                                                                                                                                                | `setMemoryLimit`, `setMaxStackSize`, interrupt handler (deadline)                  |
| JS               | V8: everything, `Intl` included                                                                                                                                         | Most of ES2023; **no `Intl`, no `structuredClone`**                                |
| Speed            | V8 with its JIT                                                                                                                                                         | An interpreter                                                                     |
| Security notes   | Its README warns that leaking any `Reference`/`ExternalCopy` to the guest gives "complete control over a process"; run it in its own process and keep Node's V8 patched | The guest is WASM memory: no path back into the host but the functions you pass in |

Others, not tried: Node's own `vm` (not a security boundary, ruled out), a Deno subprocess with
all permissions off, Cloudflare Worker isolates (only if we host the server).

### Spike (2026-11-21, not kept in the repo)

Method: `@folijs/core`'s `dist` bundled into one IIFE with esbuild (578 kB, unminified), plus an
entry `runAgent(docJson, code)` that makes a tracking editor (author "Agent"), runs the code
with `Foli` and `editor` in scope and returns the document as JSON. The host imports the .docx,
passes the JSON in, validates what comes back with `parseDocument` and exports it. Agent code:
`findAll(editor, "the")` then `replaceAll(editor, "the", "Contract")`. Windows 11, Node 25.3.0,
one run each (timings indicative only).

|                                            | 01 mutual NDA (68 kB JSON) | 04 board report (76 kB JSON) |
| ------------------------------------------ | -------------------------- | ---------------------------- |
| Node, load bundle / run edit               | 31 ms / 59 ms              | 27 ms / 50 ms                |
| QuickJS, WASM init                         | 26 ms                      | 22 ms                        |
| QuickJS, load bundle                       | 191 ms                     | 178 ms                       |
| QuickJS, run edit (37 and 24 replacements) | 123 ms                     | 131 ms                       |
| Host, validate and export                  | 62 ms                      | 68 ms                        |

Findings:

- **Foli core runs in QuickJS**, and the edits come back as tracked insertions by "Agent". The
  edit is about 2–2.5× slower than in Node; loading the bundle costs ~180 ms per fresh runtime,
  so keep one runtime per open document rather than one per call.
- **Core needs `Intl` and `structuredClone`, and QuickJS has neither.** Core uses
  `Intl.Segmenter` (graphemes and words, `state/commands.ts`, built when the module loads),
  `Intl.DateTimeFormat` (date controls, `state/controls.ts`) and `structuredClone` (`v3/document.ts`,
  `state/word.ts`, `state/comments.ts`, `v3/migrate.ts`). The spike used crude shims: segmenting
  by code point, which is wrong for emoji and combining marks, and cloning through JSON. A real
  `run(code)` needs proper ones, or core made to load without `Intl`.
- **`isolated-vm` did not install here.** Node 25 is an odd release with no prebuilt binary, and
  building it needs Visual Studio's C++ tools (`gyp ERR! find VS`). The MCP server would have to
  pin Node 24 or 26 and still fails for users on other versions.

### Trust boundary

Let only JSON cross: the document in, the document (or later serialized steps) out, and nothing
else exposed to the guest. The host validates the result with `parseDocument` like any
untrusted document. Tracking cannot be enforced from inside the guest (the code could call
`setDocument` with anything). One check to try: `rejectAllChanges("Agent")` on the result should
give back the input; anything left is an untracked edit, and the result is refused. Not tried.

## Open questions

- Block handles: is `w14:paraId` kept on every paragraph, and given to new ones?
- The facade's operation list: start from real agent tasks (fill a template, redline a contract,
  restyle headings) rather than mirroring every command.
- Should the facade return serialized steps instead of whole documents? It would need
  `toJSON`/`fromJSON` on every `Step` (none today), which collaboration needs too.

## Suggested order

1. `@folijs/agent` as a library, with tests that drive it the way a model would.
2. `@folijs/mcp` with plain tools, no sandbox.
3. `run(code)` in the MCP server, QuickJS first (portable, no native build), once there is demand.
