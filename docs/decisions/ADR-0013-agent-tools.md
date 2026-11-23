# ADR-0013: Agent tools: the definitions in `@folijs/agent`, one tool per area

- **Status:** Accepted when merged, task 23.1 (2026-11-23), by an agent's review, as the owner
  asks for phases (task by task, merged after review).
- **Context:** Phase 23 gives the agent what a person does in the editor: tables, text and
  paragraph formatting, lists, pictures, breaks, notes, headers and footers, review. Until
  now the tools' words (names, descriptions, JSON Schemas, the instructions) lived in
  `@folijs/mcp` (`mcp/src/tools.ts`), tied to the server, and code mode's `doc` methods were a
  second list of the same operations (`mcp/src/code.ts`). An app running its own model loop on
  `@folijs/agent` wrote its own schemas from the README's suggested prompt.

## Decision

1. **The definitions are `@folijs/agent`'s.** `AGENT_TOOLS` lists each tool once, over any
   session: `name`, `description`, `inputSchema`, `run(session, args)` and its code-mode
   `methods` (name, the line a script is told, what a run counts of it, the call).
   `agentTools(session)` binds them to one session and checks a call's arguments against the
   schema (`invalid`, moved from the server with the `JsonSchema` types), answering the model in
   words when they do not fit. `INSTRUCTIONS` is what to say once, before the tools. An app
   gives its model these and writes no schema of its own.
2. **The server adds only what is its own.** `@folijs/mcp` serves `AGENT_TOOLS` with a
   `document` argument added to each schema, wraps each call in its checkpoint and weight check,
   and keeps the tools that are about files (`open`, `save`, `close`, `list_documents`) and
   `run`. Its instructions are the library's with where documents come from and go. Code mode's
   method list, its dispatch and the `doc` summary in `run`'s description are built from the
   definitions' `methods`: a method added to a tool is a method of `doc` with no change in the
   server.
3. **One tool per area, an `action` field.** Every tool's description costs the model context
   on every call, so Phase 23 adds few tools: `edit_table`, `format_text`, `format_paragraph`,
   `insert` and, behind an option, the review tools (23.3–23.8). Headers and footers (23.7) need
   no tool: their blocks get handles, marked with their story in a read, and the existing tools
   take them. Code mode gets a method per action, where a call costs nothing in descriptions.
4. **How a handle names part of a table.** A table is named by its own handle (the
   `table, 3 rows, 2 columns` line's). A row and a column are 1-based indexes as `read` prints
   them (`r1 c1`, the column being the grid column; a cell spanning two is named by its first).
   A cell is its table's handle with a row and a column, or the handle of a paragraph in it,
   which stands for its cell. A model reads indexes it can see; a handle per row or cell would
   double the lines of a read. The indexes are `read`'s, and the table tools resolve them by the
   same walk: rows as they are with every change accepted (a row deleted as a tracked change is
   not counted), columns of the grid. A column inside a span names the spanning cell; a cell
   merged up names the top cell of its merge, which holds the text. `read` does not count a
   row's `gridBefore` today; 23.3 makes it, so that `c` is the grid column core counts.
5. **How `on` names text for formatting.** As `comment` already does: `on` is text of the block
   exactly as `read` shows it, there once, or with `all` every place it is. Without `on` the
   whole block is formatted. Positions are never asked of a model.
6. **What stays refused says why.** Every edit is a tracked change. What core cannot record as
   one that Word reads back (23.2 decides which table commands) is refused with a message the
   tool passes on, naming what the model can do instead.

## Measured (23.1, before and after the move)

The tools a client lists, `@folijs/mcp` with this change and without it: the same bytes
(names, descriptions, schemas, instructions compared as JSON).

| Server        | Tools | Description characters | With schemas | Instructions |
| ------------- | ----: | ---------------------: | -----------: | -----------: |
| Default       |    14 |                  2,978 |        8,273 |        1,522 |
| With `--code` |    15 |                  5,658 |       11,236 |        1,522 |

Each later task records its tools' cost here or in the roadmap; the aim is to stay under 20
tools and about 15,000 characters with schemas, `run` included.

## Consequences

- `@folijs/agent` gains a public surface (`AGENT_TOOLS`, `agentTools`, `INSTRUCTIONS`,
  `READ_LIMIT`, `invalid`, the `JsonSchema` types, `AgentTool`, `ToolDefinition`,
  `ScriptMethod`, `ToolAnswer`): changing a description, or what code mode counts of a method,
  is now a change to the agent package, released with it (0.x).
- `agentTools` has no limit on how much a model adds; the app sets its own, as the server does.
- The server and code mode cannot drift from the library: a tool or a method is added once.
- Rejected: a tool per core command (about 40 tools, several times today's context cost);
  generating schemas from TypeScript types (a dependency or a build step, and descriptions are
  written for a model, not derived).
