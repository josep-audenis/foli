/**
 * The tools (ADR-0013): what a model is given to edit a session's document, with the words it
 * reads (names, descriptions, JSON Schemas, the instructions). An app running its own model
 * loop gives it `agentTools(session)`; `@folijs/mcp` serves the same definitions, and its code
 * mode (`run`) gets its methods from them.
 */
import type { Ok, Result } from "./result.js";
import { invalid, type JsonSchema, type JsonSchemaOrAny } from "./schema.js";
import type { Session } from "./session.js";
import { UNTRACKED_TABLE_EDIT } from "./tables.js";
import type { Control } from "./templates.js";

/** Blocks the `read` tool gives when it is not told how many. */
export const READ_LIMIT = 200;

/**
 * What to say to the model once, before the tools (a system prompt's part). Each tool's
 * description stands without it.
 */
export const INSTRUCTIONS = `These tools read and edit Word documents (.docx). Every edit is a tracked change a person will accept or reject in Word: change only what the task asks, and use comment to explain a change that is not obvious.

Work on what read shows. read gives the document a line per block:
  [b7] Clause, 1.1, changed: text
[b7] is the block's handle: pass it to the other tools. After it come where the block is in a table (r1 c1: row and grid column; c1-2 a cell spanning two; "merged down" or "merged up" a vertical merge, its text in the top cell), its style, its list number, "changed" if it has tracked changes, its comments; after the colon, its text. ↵ is a line break. A line "table, 3 rows, 2 columns" is a table: its cells' blocks follow, indented. A line "not editable: …" is content you cannot change.
Words in brackets ([picture], [note], [empty: Offer date]) are not text: never put them in find. [empty: …] is a content control to fill with fill_control; «Name» is a merge field to fill with update_fields.
A handle stays its block's while you edit; a deleted block's is refused. A tool that changes the document returns the blocks it changed as they are now: do not read again to check (after update_fields do: it returns none). When a tool refuses, its message says what to do instead: follow it.
read shows the body; read with headers also shows the headers and footers after it, their handles h1, f1…, which the same tools edit (comments go in the body only). The text of notes ([note]) is not shown.`;

/** What a tool answers the model: text, and whether it is a refusal. */
export interface ToolAnswer {
  text: string;
  isError?: boolean;
}

/** A tool bound to a session: give the model its name, description and schema; call `run`. */
export interface AgentTool {
  name: string;
  /** For the model: what it does, when to use it, what it returns. */
  description: string;
  /** Its arguments, as a JSON Schema object. */
  inputSchema: JsonSchema & { type: "object" };
  /** Does what the model asked; arguments that do not fit the schema are refused in words. */
  run(args?: Record<string, unknown>): ToolAnswer;
}

/**
 * A method of code mode's `doc` (ADR-0010): what a script calls instead of a tool. A refusal
 * is thrown as an `Error` with its message.
 */
export interface ScriptMethod {
  name: string;
  /** Its line in the summary of `doc` a model is given. */
  signature: string;
  /**
   * What a run counts of it: `edit`, the blocks its value's `blocks` are; `insert`, those and
   * how many; `delete`, a block deleted or emptied; `fields`, fields updated.
   */
  effect?: "edit" | "insert" | "delete" | "fields";
  call(session: Session, args: readonly unknown[], host?: ToolHost): unknown;
}

/**
 * What the app gives the tools that the document does not hold (23.6): a picture's bytes for a
 * path the model names. Without it, pictures are refused.
 */
export interface ToolHost {
  picture?(path: string): Result<{ data: Uint8Array; contentType?: string }>;
}

/** A tool over any session: what `agentTools` binds, and what a server serves. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  /**
   * Arguments are taken as checked against `inputSchema` (`invalid` first: `agentTools` does);
   * others may be there.
   */
  run(session: Session, args: Record<string, unknown>, host?: ToolHost): ToolAnswer;
  /** Its methods in code mode, in the order they are listed. */
  methods: readonly ScriptMethod[];
  /** Only for a session that reviews changes (`SessionOptions.review`, 23.8). */
  review?: true;
}

const HANDLE: JsonSchema = {
  type: "string",
  description: "The block's handle, from a read line: b7.",
};
const args = (
  properties: Record<string, JsonSchemaOrAny>,
  required: readonly string[] = [],
): JsonSchema & { type: "object" } => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/** A result of the library as a tool's: its text, or its refusal's message. */
const told = (
  result: { ok: true; text: string } | { ok: false; message: string },
  more = "",
): ToolAnswer =>
  result.ok ? { text: result.text + more } : { text: result.message, isError: true };

/** A result for a script: its refusal thrown. */
const given = <T>(result: Result<T>): Ok<T> => {
  if (!result.ok) throw new Error(result.message);
  return result;
};

const control = (c: Control) =>
  [
    `${c.name} (${c.kind}${c.readOnly ? ", locked" : ""}), in [${c.block}]: `,
    c.empty ? "empty" : JSON.stringify(c.value),
    c.items ? `; one of ${c.items.map((i) => JSON.stringify(i)).join(", ")}` : "",
    c.name !== c.id ? `; id ${JSON.stringify(c.id)}` : "",
  ].join("");

// A script's arguments are JSON of any shape: the library refuses what does not fit, as it does
// for a tool, so they are passed as they come.
type Args = readonly [never, never, never, never];

/** The tools, in the order a model is given them. */
export const AGENT_TOOLS: readonly ToolDefinition[] = [
  {
    name: "read",
    description: `Reads an open document: its body as it would be with every tracked change accepted, a line per block, each starting with its handle. Reads ${READ_LIMIT} blocks unless limit says otherwise; a long document is read in parts with from.`,
    inputSchema: args({
      from: { ...HANDLE, description: "Start at this block's handle. Default: the first block." },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 2000,
        description: "At most this many blocks.",
      },
      formatting: {
        type: "boolean",
        description:
          "Also show each paragraph's text formatting of its own (bold, font, size, color, links), on a line under it.",
      },
      headers: {
        type: "boolean",
        description:
          "Also read the headers and footers, after the body, each under a line saying where it is used. Their handles are h1, f1…; the other tools edit them as the body's.",
      },
    }),
    run(session, { from, limit, formatting, headers }) {
      const result = session.read({
        ...(from === undefined ? {} : { from: from as string }),
        limit: (limit as number | undefined) ?? READ_LIMIT,
        ...(formatting === true ? { formatting: true } : {}),
        ...(headers === true ? { headers: true } : {}),
      });
      return told(result, result.ok && result.next ? `\n(more: read from "${result.next}")` : "");
    },
    methods: [
      {
        name: "blocks",
        signature:
          "doc.blocks({ formatting?, headers? }): Block[]   // every block of the body (headers: then headers' and footers', each with story), in order, as it reads now (a copy: call again after edits)",
        call: (session, [a]: Args) => {
          const options = (a ?? {}) as { formatting?: unknown; headers?: unknown };
          return given(
            session.read({
              formatting: options.formatting === true,
              headers: options.headers === true,
            }),
          ).blocks;
        },
      },
      {
        name: "block",
        signature: "doc.block(handle): Block",
        call: (session, [a]: Args) => given(session.block(a)).block,
      },
    ],
  },
  {
    name: "replace_text",
    description:
      'Replaces text in one paragraph, as a tracked change. find is the exact text as read shows it, capitals and spaces included, long enough to be in the block once (or pass all). The replacement takes the formatting of what it replaces; "" deletes. Returns the block as it reads now.',
    inputSchema: args(
      {
        handle: HANDLE,
        find: { type: "string", description: "The text to replace, exactly as read shows it." },
        replacement: {
          type: "string",
          description: 'The new text. ↵ is a line break. "" deletes.',
        },
        all: { type: "boolean", description: "Replace every place find is in the block." },
      },
      ["handle", "find", "replacement"],
    ),
    run: (session, { handle, find, replacement, all }) =>
      told(
        session.replaceText(handle as string, find as string, replacement as string, {
          all: all === true,
        }),
      ),
    methods: [
      {
        name: "replaceText",
        signature:
          "doc.replaceText(handle, find, replacement, { all? }): { blocks, replaced, refused }   // replaced: places changed; refused: places that could not be (locked)",
        effect: "edit",
        call(session, [a, b, c, d]: Args) {
          const { blocks, replaced, refused } = given(session.replaceText(a, b, c, d));
          return { blocks, replaced, refused };
        },
      },
    ],
  },
  {
    name: "insert_paragraphs",
    description:
      "Inserts new paragraphs before or after a block (a paragraph, a table, any block), as a tracked change. Each is formatted like the paragraph it goes next to, its style, indents and numbering included (after a heading: as body text), unless it names a style. Returns the new blocks with their handles.",
    inputSchema: args(
      {
        handle: HANDLE,
        where: { type: "string", enum: ["after", "before"], description: "Default: after." },
        paragraphs: {
          type: "array",
          description: "The paragraphs, in order: each its text, or its text and a style.",
          items: {
            anyOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  text: { type: "string" },
                  style: {
                    type: "string",
                    description: "A paragraph style's name, as read or list_styles shows it.",
                  },
                },
                required: ["text"],
                additionalProperties: false,
              },
            ],
          },
        },
      },
      ["handle", "paragraphs"],
    ),
    run: (session, { handle, where, paragraphs }) =>
      told(
        where === "before"
          ? session.insertBefore(handle as string, paragraphs as string[])
          : session.insertAfter(handle as string, paragraphs as string[]),
      ),
    methods: [
      {
        name: "insertAfter",
        signature:
          'doc.insertAfter(handle, paragraphs): { blocks }    // paragraphs: "text" | { text, style? } | a list of them; blocks: the new ones',
        effect: "insert",
        call: (session, [a, b]: Args) => ({ blocks: given(session.insertAfter(a, b)).blocks }),
      },
      {
        name: "insertBefore",
        signature: "doc.insertBefore(handle, paragraphs): { blocks }",
        effect: "insert",
        call: (session, [a, b]: Args) => ({ blocks: given(session.insertBefore(a, b)).blocks }),
      },
    ],
  },
  {
    name: "delete_block",
    description:
      "Deletes a paragraph, or a table with all its cells, as a tracked change. A paragraph that must stay (the last of the document or of a cell, one before a table, one that ends a section) is emptied instead, and the answer says so.",
    inputSchema: args({ handle: HANDLE }, ["handle"]),
    run: (session, { handle }) => told(session.deleteBlock(handle as string)),
    methods: [
      {
        name: "deleteBlock",
        signature:
          "doc.deleteBlock(handle): { text }                  // text: a sentence saying what was done",
        effect: "delete",
        call: (session, [a]: Args) => ({ text: given(session.deleteBlock(a)).text }),
      },
    ],
  },
  {
    name: "set_style",
    description:
      "Puts a paragraph in a paragraph style (Heading 2, Normal…), as a tracked formatting change. Returns the block as it reads now.",
    inputSchema: args(
      {
        handle: HANDLE,
        style: {
          type: "string",
          description: "The style's name, as read or list_styles shows it; capitals do not count.",
        },
      },
      ["handle", "style"],
    ),
    run: (session, { handle, style }) => told(session.setStyle(handle as string, style as string)),
    methods: [
      { name: "styles", signature: "doc.styles(): string[]", call: (session) => session.styles() },
      {
        name: "setStyle",
        signature: "doc.setStyle(handle, style): { blocks }",
        effect: "edit",
        call: (session, [a, b]: Args) => ({ blocks: given(session.setStyle(a, b)).blocks }),
      },
    ],
  },
  {
    name: "list_styles",
    description:
      "Lists the paragraph styles of an open document, by the names set_style and insert_paragraphs take.",
    inputSchema: args({}),
    run: (session) => ({ text: session.styles().join("\n") }),
    methods: [],
  },
  {
    name: "comment",
    description:
      "Adds a comment to a paragraph, in the margin as in Word: on the whole paragraph, or on text in it. Use it to explain a change or to ask the reader something. It does not change the text. A deleted block takes none: to explain a deletion, comment the block before or after it.",
    inputSchema: args(
      {
        handle: HANDLE,
        text: {
          type: "string",
          description: "The comment. A line break starts a new paragraph.",
        },
        on: {
          type: "string",
          description:
            "Text of the block to anchor the comment to, exactly as read shows it, there once.",
        },
      },
      ["handle", "text"],
    ),
    run: (session, { handle, text, on }) =>
      told(
        session.comment(
          handle as string,
          text as string,
          on === undefined ? {} : { on: on as string },
        ),
      ),
    methods: [
      {
        name: "comment",
        signature:
          "doc.comment(handle, text, { on? }): { blocks, comment }   // comment: the new comment's id",
        effect: "edit",
        call(session, [a, b, c]: Args) {
          const { blocks, comment } = given(session.comment(a, b, c));
          return { blocks, comment };
        },
      },
    ],
  },
  {
    name: "list_controls",
    description:
      "Lists the content controls of an open document: the blanks a template leaves to fill (read shows an unfilled one as [empty: Title]). Each with its name for fill_control, its kind, its value, a list's items, and the block it is in.",
    inputSchema: args({}),
    run(session) {
      const all = session.controls();
      return {
        text: all.length ? all.map(control).join("\n") : "The document has no content controls.",
      };
    },
    methods: [
      {
        name: "controls",
        signature:
          "doc.controls(): Control[]                          // { id, name, kind, value, empty, items?, readOnly, block }",
        call: (session) => session.controls(),
      },
    ],
  },
  {
    name: "fill_control",
    description:
      "Fills a content control, as a tracked change: text for a text control, one of its items for a list, a day as yyyy-mm-dd for a date, true or false for a check box; null empties it. name is the control's name from list_controls (controls that share a name are all filled; a control's id fills that one). Returns the blocks changed.",
    inputSchema: args(
      {
        name: { type: "string", description: "The control's name, title or id." },
        value: {
          anyOf: [{ type: "string" }, { type: "boolean" }, { type: "null" }],
          description: "The value: text, true or false, or null to empty the control.",
        },
      },
      ["name", "value"],
    ),
    run(session, { name, value }) {
      const result = session.fillControl(name as string, value as string | boolean | null);
      return told(result, result.ok ? `\n${result.controls.map(control).join("\n")}` : "");
    },
    methods: [
      {
        name: "fillControl",
        signature:
          "doc.fillControl(name, value): { blocks, controls, unfilled }   // unfilled: controls of that name that did not take the value, each with why",
        effect: "edit",
        call(session, [a, b]: Args) {
          const { blocks, controls, unfilled } = given(session.fillControl(a, b));
          return { blocks, controls, unfilled };
        },
      },
    ],
  },
  {
    name: "update_fields",
    description:
      "Fills the document's merge fields («Name» in a read) from data, and updates its other fields (dates, cross-references), as tracked changes. A table of contents is left as it is unless contents is true. Returns what was updated and what was left, in words; read again to see the text.",
    inputSchema: args({
      data: {
        type: "object",
        description: 'Merge field names with their values: { "FirstName": "Ada" }.',
        additionalProperties: true,
      },
      contents: {
        type: "boolean",
        description:
          "Build the tables of contents again from the headings as they are now. Their entries become new blocks with new handles, and their page numbers stay empty until Word updates the field: say so to the reader. Default: false.",
      },
    }),
    run: (session, { data, contents }) =>
      told(
        session.updateFields({
          ...(data === undefined ? {} : { data: data as Record<string, string> }),
          ...(contents === true ? { contents: true } : {}),
        }),
      ),
    methods: [
      {
        name: "updateFields",
        signature:
          "doc.updateFields({ data?, contents? }): { updated, unchanged, rebuilt, text }   // counts, and a sentence",
        effect: "fields",
        call(session, [a]: Args) {
          const { updated, unchanged, rebuilt, text } = given(session.updateFields(a));
          return { updated, unchanged, rebuilt, text };
        },
      },
    ],
  },
  {
    name: "edit_table",
    description:
      "Tables, as tracked changes. handle names a table: its \"table\" line's, or a paragraph's in one of its cells; row and column are numbered as read prints them (r2 c1). Actions: insert_table, a new table after (or before) the block handle names, cells its rows of texts; insert_rows after (or before) row, made like it, cells their texts; delete_rows, rows their numbers; set_cells, values [{ row, column, text }], each cell's whole text; set_style, style a table style's name (null: none); shade, fill RRGGBB (null: none) on the table, a row, a column or one cell; header_rows, count rows from the top repeated on each page (0: none). Columns, merging, splitting and widths cannot be tracked: the answer says what to do instead. Returns the table as it reads now.",
    inputSchema: args(
      {
        handle: {
          ...HANDLE,
          description:
            "A table's handle, or a paragraph's in one of its cells (insert_table: the block to put it next to).",
        },
        action: {
          type: "string",
          enum: [
            "insert_table",
            "insert_rows",
            "delete_rows",
            "set_cells",
            "set_style",
            "shade",
            "header_rows",
            "insert_columns",
            "delete_columns",
            "merge_cells",
            "split_cell",
            "column_width",
          ],
          description: "What to do; the description says which arguments each takes.",
        },
        where: { type: "string", enum: ["after", "before"], description: "Default: after." },
        cells: {
          type: "array",
          description:
            'Rows of cell texts: [["Item", "Price"], ["Tea", "3.50"]]. ↵ is a line break.',
          items: { type: "array", items: { type: "string" } },
        },
        row: { type: "integer", minimum: 1, description: "A row, as read numbers it: r2 is 2." },
        column: {
          type: "integer",
          minimum: 1,
          description: "A grid column, as read numbers it: c1 is 1.",
        },
        rows: {
          type: "array",
          description: "delete_rows: the rows, as read numbers them.",
          items: { type: "integer", minimum: 1 },
        },
        values: {
          type: "array",
          description: "set_cells: each cell's row, column and whole new text.",
          items: {
            type: "object",
            properties: {
              row: { type: "integer", minimum: 1 },
              column: { type: "integer", minimum: 1 },
              text: { type: "string" },
            },
            required: ["row", "column", "text"],
            additionalProperties: false,
          },
        },
        header: {
          type: "boolean",
          description:
            "insert_table: the first row is a header row, repeated on each page (as header_rows 1).",
        },
        style: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "A table style's name (insert_table, set_style).",
        },
        fill: { anyOf: [{ type: "string" }, { type: "null" }], description: "RRGGBB: D9E2F3." },
        count: {
          type: "integer",
          minimum: 0,
          description: "header_rows: how many rows from the top.",
        },
      },
      ["handle", "action"],
    ),
    run(session, a) {
      const handle = a.handle as string;
      const need = (...keys: string[]) => {
        const missing = keys.filter((k) => a[k] === undefined);
        return missing.length
          ? { text: `${a.action as string} needs ${missing.join(" and ")}.`, isError: true }
          : null;
      };
      switch (a.action) {
        case "insert_table":
          return (
            need("cells") ??
            told(
              session.insertTable(handle, a.cells as string[][], {
                ...(a.where === undefined ? {} : { where: a.where as "after" | "before" }),
                ...(a.header === true ? { header: true } : {}),
                ...(typeof a.style === "string" ? { style: a.style } : {}),
              }),
            )
          );
        case "insert_rows":
          return (
            need("row", "cells") ??
            told(
              session.insertRows(
                handle,
                a.row as number,
                a.cells as string[][],
                a.where === "before" ? "before" : "after",
              ),
            )
          );
        case "delete_rows":
          return need("rows") ?? told(session.deleteRows(handle, a.rows as number[]));
        case "set_cells":
          return need("values") ?? told(session.setCells(handle, a.values as never));
        case "set_style":
          return need("style") ?? told(session.setTableStyle(handle, a.style as string | null));
        case "shade":
          return (
            need("fill") ??
            told(
              session.shadeCells(handle, a.fill as string | null, {
                ...(a.row === undefined ? {} : { row: a.row as number }),
                ...(a.column === undefined ? {} : { column: a.column as number }),
              }),
            )
          );
        case "header_rows":
          return need("count") ?? told(session.setHeaderRows(handle, a.count as number));
        default:
          return { text: UNTRACKED_TABLE_EDIT, isError: true };
      }
    },
    methods: [
      {
        name: "insertTable",
        signature:
          'doc.insertTable(handle, cells, { where?, header?, style? }): { blocks }   // cells: [["Item", "Price"], ["Tea", "3.50"]]; blocks: the table and its cells',
        effect: "insert",
        call: (session, [a, b, c]: Args) => ({
          blocks: given(session.insertTable(a, b, c)).blocks,
        }),
      },
      {
        name: "insertRows",
        signature:
          'doc.insertRows(table, row, cells, where?): { blocks }   // where: "after" | "before"',
        effect: "insert",
        call: (session, [a, b, c, d]: Args) => ({
          blocks: given(session.insertRows(a, b, c, d)).blocks,
        }),
      },
      {
        name: "deleteRows",
        signature: "doc.deleteRows(table, rows): { text, rows }",
        effect: "delete",
        call(session, [a, b]: Args) {
          const { text, rows } = given(session.deleteRows(a, b));
          return { text, rows };
        },
      },
      {
        name: "setCells",
        signature: "doc.setCells(table, [{ row, column, text }]): { blocks }",
        effect: "edit",
        call: (session, [a, b]: Args) => ({ blocks: given(session.setCells(a, b)).blocks }),
      },
      {
        name: "tableStyles",
        signature: "doc.tableStyles(): string[]",
        call: (session) => session.tableStyles(),
      },
      {
        name: "setTableStyle",
        signature: "doc.setTableStyle(table, style | null): { blocks }",
        effect: "edit",
        call: (session, [a, b]: Args) => ({ blocks: given(session.setTableStyle(a, b)).blocks }),
      },
      {
        name: "shadeCells",
        signature: "doc.shadeCells(table, fill | null, { row?, column? }): { blocks }",
        effect: "edit",
        call: (session, [a, b, c]: Args) => ({ blocks: given(session.shadeCells(a, b, c)).blocks }),
      },
      {
        name: "setHeaderRows",
        signature: "doc.setHeaderRows(table, count): { blocks }",
        effect: "edit",
        call: (session, [a, b]: Args) => ({ blocks: given(session.setHeaderRows(a, b)).blocks }),
      },
    ],
  },
  {
    name: "format_text",
    description:
      "Formats a paragraph's text, as a tracked formatting change: all of it, or on text in it (exactly as read shows it, there once, or every place with all). format says what to change, the rest stays: bold, italic, underline, strike (true or false), font (a name), size (points), color (RRGGBB), highlight (a Word highlight color by name: yellow, green…), link (an address; null takes a link off); null gives font, size or color back to the style. read with formatting shows what text has now. Returns the block as it reads now.",
    inputSchema: args(
      {
        handle: HANDLE,
        format: {
          type: "object",
          description: 'What to change: { "bold": true, "color": "1F3864" }.',
          properties: {
            bold: { type: "boolean" },
            italic: { type: "boolean" },
            underline: { type: "boolean" },
            strike: { type: "boolean" },
            font: { anyOf: [{ type: "string" }, { type: "null" }] },
            size: { anyOf: [{ type: "number" }, { type: "null" }] },
            color: { anyOf: [{ type: "string" }, { type: "null" }] },
            highlight: { anyOf: [{ type: "string" }, { type: "null" }] },
            link: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          additionalProperties: false,
        },
        on: {
          type: "string",
          description: "Text of the block to format, exactly as read shows it. Default: all of it.",
        },
        all: { type: "boolean", description: "Every place on is in the block." },
      },
      ["handle", "format"],
    ),
    run: (session, { handle, format, on, all }) =>
      told(
        session.formatText(handle as string, format as never, {
          ...(on === undefined ? {} : { on: on as string }),
          ...(all === true ? { all: true } : {}),
        }),
      ),
    methods: [
      {
        name: "formatText",
        signature: "doc.formatText(handle, format, { on?, all? }): { blocks }",
        effect: "edit",
        call: (session, [a, b, c]: Args) => ({ blocks: given(session.formatText(a, b, c)).blocks }),
      },
    ],
  },
  {
    name: "format_paragraph",
    description:
      "Formats paragraphs, as tracked formatting changes: handles, one or several (paragraphs next to each other become one list). format says what to change, the rest stays: align (left, center, right, justify), lineSpacing (a multiple: 1, 1.15, 1.5, 2), spaceBefore and spaceAfter (points), indent (more or less: half an inch, or a list level), list (bullet, numbered; null takes the numbering off); null gives spacing back to the style. read with formatting shows a paragraph's own. Returns the blocks as they read now.",
    inputSchema: args(
      {
        handles: {
          type: "array",
          description: 'The paragraphs\' handles, from read: ["b4", "b5"].',
          items: { type: "string" },
        },
        format: {
          type: "object",
          description: 'What to change: { "align": "center", "spaceAfter": 6 }.',
          properties: {
            align: { type: "string", enum: ["left", "center", "right", "justify"] },
            lineSpacing: { anyOf: [{ type: "number" }, { type: "null" }] },
            spaceBefore: { anyOf: [{ type: "number" }, { type: "null" }] },
            spaceAfter: { anyOf: [{ type: "number" }, { type: "null" }] },
            indent: { type: "string", enum: ["more", "less"] },
            list: {
              anyOf: [{ type: "string", enum: ["bullet", "numbered"] }, { type: "null" }],
            },
          },
          additionalProperties: false,
        },
      },
      ["handles", "format"],
    ),
    run: (session, { handles, format }) =>
      told(session.formatParagraphs(handles as string[], format as never)),
    methods: [
      {
        name: "formatParagraphs",
        signature: "doc.formatParagraphs(handles, format): { blocks }",
        effect: "edit",
        call: (session, [a, b]: Args) => ({ blocks: given(session.formatParagraphs(a, b)).blocks }),
      },
    ],
  },
  {
    name: "insert",
    description:
      "Inserts what is not text, as a tracked insertion, next to or in a paragraph (handle): a picture (path to an image file, and alt: what it shows; width or height in points, else its own size fitted to the page) or a horizontal line, as a paragraph of its own after (or before) it; a page break or a section break (start: nextPage, continuous, evenPage, oddPage) at its end (or start); a footnote or endnote, its text, at the paragraph's end or after on text in it. Returns the blocks made or changed.",
    inputSchema: args(
      {
        handle: HANDLE,
        what: {
          type: "string",
          enum: [
            "picture",
            "page_break",
            "section_break",
            "horizontal_rule",
            "footnote",
            "endnote",
          ],
          description: "What to insert.",
        },
        where: { type: "string", enum: ["after", "before"], description: "Default: after." },
        path: { type: "string", description: "picture: the image file (.png, .jpg, .gif)." },
        alt: {
          type: "string",
          description: "picture: what it shows, for a reader who cannot see it.",
        },
        width: { type: "number", description: "picture: in points." },
        height: { type: "number", description: "picture: in points." },
        start: {
          type: "string",
          enum: ["nextPage", "continuous", "evenPage", "oddPage"],
          description: "section_break: where the next section starts. Default: nextPage.",
        },
        text: { type: "string", description: "footnote, endnote: the note's text." },
        on: {
          type: "string",
          description: "footnote, endnote: text of the paragraph the note follows.",
        },
      },
      ["handle", "what"],
    ),
    run(session, a, host) {
      const handle = a.handle as string;
      const where = a.where === "before" ? { where: "before" as const } : {};
      switch (a.what) {
        case "picture": {
          if (!host?.picture)
            return {
              text: "Pictures cannot be inserted here: the app gives no files.",
              isError: true,
            };
          if (typeof a.path !== "string" || typeof a.alt !== "string")
            return { text: "picture needs path and alt.", isError: true };
          const file = host.picture(a.path);
          if (!file.ok) return { text: file.message, isError: true };
          return told(
            session.insertItem(
              handle,
              {
                kind: "picture",
                data: file.data,
                ...(file.contentType ? { contentType: file.contentType } : {}),
                alt: a.alt,
                ...(typeof a.width === "number" ? { width: a.width } : {}),
                ...(typeof a.height === "number" ? { height: a.height } : {}),
              },
              where,
            ),
          );
        }
        case "page_break":
          return told(session.insertItem(handle, { kind: "pageBreak" }, where));
        case "section_break":
          return told(
            session.insertItem(
              handle,
              { kind: "sectionBreak", ...(a.start ? { start: a.start as never } : {}) },
              where,
            ),
          );
        case "horizontal_rule":
          return told(session.insertItem(handle, { kind: "horizontalRule" }, where));
        default:
          if (typeof a.text !== "string")
            return { text: `${a.what as string} needs text.`, isError: true };
          return told(
            session.insertItem(handle, {
              kind: a.what === "endnote" ? "endnote" : "footnote",
              text: a.text,
              ...(typeof a.on === "string" ? { on: a.on } : {}),
            }),
          );
      }
    },
    methods: [
      {
        name: "insert",
        signature:
          'doc.insert(handle, { kind, ... }, { where? }): { blocks }   // kind: "picture" (path, alt, width?, height?) | "pageBreak" | "sectionBreak" (start?) | "horizontalRule" | "footnote" | "endnote" (text, on?)',
        effect: "edit",
        call(session, [a, b, c]: Args, host) {
          const item = b as Record<string, unknown> | undefined;
          if (item?.kind === "picture") {
            if (!host?.picture)
              throw new Error("Pictures cannot be inserted here: the app gives no files.");
            const file = given(host.picture(String(item.path)));
            const { path: _, contentType: __, ...rest } = item;
            return {
              blocks: given(
                session.insertItem(
                  a,
                  {
                    ...rest,
                    data: file.data,
                    ...(file.contentType ? { contentType: file.contentType } : {}),
                  } as never,
                  c,
                ),
              ).blocks,
            };
          }
          return { blocks: given(session.insertItem(a, b, c)).blocks };
        },
      },
    ],
  },
  {
    name: "review",
    review: true,
    description:
      'Lists the document\'s tracked changes, a line each ([c12] inserted, Bob (2026-11-20), in [b7]: "text"), and accepts or rejects them as Word does: by their numbers (ids: [12] for c12), or all of them (ids: "all", every header and footer too; author: only that person\'s). Accepted insertions stay, accepted deletions go; rejecting does the opposite. The list shows deleted text that read leaves out.',
    inputSchema: args(
      {
        action: { type: "string", enum: ["list", "accept", "reject"], description: "What to do." },
        ids: {
          anyOf: [
            { type: "array", items: { type: "integer" } },
            { type: "string", enum: ["all"] },
          ],
          description: 'accept, reject: the changes\' numbers ([12] for c12), or "all".',
        },
        author: { type: "string", description: 'With ids "all": only this person\'s changes.' },
      },
      ["action"],
    ),
    run(session, { action, ids, author }) {
      if (action === "list") return told(session.changes());
      if (ids === undefined) return { text: `${action as string} needs ids.`, isError: true };
      const options = typeof author === "string" ? { author } : {};
      return told(
        action === "accept"
          ? session.acceptChanges(ids as number[] | "all", options)
          : session.rejectChanges(ids as number[] | "all", options),
      );
    },
    methods: [
      {
        name: "changes",
        signature:
          "doc.changes(): { changes, text }   // changes: { id, kind, author, date, block, text }[], in order",
        call(session) {
          const { changes, text } = given(session.changes());
          return { changes, text };
        },
      },
      {
        name: "acceptChanges",
        signature: 'doc.acceptChanges(ids | "all", { author? }): { text }',
        call: (session, [a, b]: Args) => ({ text: given(session.acceptChanges(a, b)).text }),
      },
      {
        name: "rejectChanges",
        signature: 'doc.rejectChanges(ids | "all", { author? }): { text }',
        call: (session, [a, b]: Args) => ({ text: given(session.rejectChanges(a, b)).text }),
      },
    ],
  },
];

/**
 * The tools over one session, for an app that runs its own model loop: give the model
 * `INSTRUCTIONS` and each tool's name, description and schema, and pass its calls to `run`.
 * A call whose arguments do not fit the schema is answered with why, as a refusal.
 */
/** The tools a session is given: the review tool only to one that reviews changes. */
export const toolsFor = (session: { reviewing: boolean }): readonly ToolDefinition[] =>
  AGENT_TOOLS.filter((tool) => !tool.review || session.reviewing);

export function agentTools(session: Session, host: ToolHost = {}): AgentTool[] {
  return toolsFor(session).map(({ name, description, inputSchema, run }) => ({
    name,
    description,
    inputSchema,
    run(a = {}) {
      const wrong = invalid(a, inputSchema);
      return wrong
        ? { text: `Wrong arguments for ${name}: ${wrong}.`, isError: true }
        : run(session, a, host);
    },
  }));
}
