/**
 * The tools (ADR-0009): the documents', and one per operation of `@folijs/agent`. What a tool
 * returns is the library's own text; its refusals come back for the model to act on.
 */
import type { Control, Session } from "@folijs/agent";
import { DOC_TYPES, HEAVY, runCode } from "./code.js";
import type { Documents, OpenDocument } from "./documents.js";
import type { Tool, ToolResult } from "./protocol.js";
import type { SandboxLimits } from "./sandbox.js";
import type { JsonSchema, JsonSchemaOrAny } from "./schema.js";
import { weight } from "./weight.js";

/** @internal Blocks a `read` gives when it is not told how many. */
export const READ_LIMIT = 200;

/**
 * @internal
 * Said once to the model by clients that pass a server's instructions on. Each tool's
 * description stands without it.
 */
export const INSTRUCTIONS = `These tools read and edit Word documents (.docx). Every edit is a tracked change a person will accept or reject in Word: change only what the task asks, and use comment to explain a change that is not obvious.

Start with open, then work on what read shows. read gives the document a line per block:
  [b7] Clause, 1.1, changed: text
[b7] is the block's handle: pass it to the other tools. After it come where the block is in a table (r1 c1: row and grid column; c1-2 a cell spanning two; "merged down" or "merged up" a vertical merge, its text in the top cell), its style, its list number, "changed" if it has tracked changes, its comments; after the colon, its text. ↵ is a line break. A line "table, 3 rows, 2 columns" is a table: its cells' blocks follow, indented. A line "not editable: …" is content you cannot change.
Words in brackets ([picture], [note], [empty: Offer date]) are not text: never put them in find. [empty: …] is a content control to fill with fill_control; «Name» is a merge field to fill with update_fields.
A handle stays its block's while you edit; a deleted block's is refused. A tool that changes the document returns the blocks it changed as they are now: do not read again to check (after update_fields do: it returns none). When a tool refuses, its message says what to do instead: follow it.
Only the body is read and edited: headers, footers and the text of notes ([note]) are not shown.
Nothing is written to disk until save. save writes a new file beside the original and says its name.`;

const DOCUMENT: JsonSchema = {
  type: "string",
  description:
    "The document's id, as open gave it (d1). May be left out while one document is open.",
};
const HANDLE: JsonSchema = {
  type: "string",
  description: "The block's handle, from a read line: b7.",
};
const args = (
  properties: Record<string, JsonSchemaOrAny>,
  required: readonly string[] = [],
): JsonSchema & { type: "object" } => ({
  type: "object",
  properties: { ...properties, document: DOCUMENT },
  required,
  additionalProperties: false,
});

/** A result of the library as a tool's: its text, or its refusal's message. */
const told = (
  result: { ok: true; text: string } | { ok: false; message: string },
  more = "",
): ToolResult =>
  result.ok ? { text: result.text + more } : { text: result.message, isError: true };

const control = (c: Control) =>
  [
    `${c.name} (${c.kind}${c.readOnly ? ", locked" : ""}), in [${c.block}]: `,
    c.empty ? "empty" : JSON.stringify(c.value),
    c.items ? `; one of ${c.items.map((i) => JSON.stringify(i)).join(", ")}` : "",
    c.name !== c.id ? `; id ${JSON.stringify(c.id)}` : "",
  ].join("");

/** The tool of code mode (ADR-0010): there only when the server was started with it. */
const runTool = (documents: Documents, limits: SandboxLimits): Tool => ({
  name: "run",
  description: `Runs a JavaScript script over an open document: use it when a task is the same step on many blocks (every heading, every table cell), where the other tools would take a call each. The script is a function's body: it uses doc, and what it returns is the answer. Every edit is a tracked change, as with the other tools. All or nothing: if the script throws or is stopped, none of its edits is kept, and the answer says the line.
${DOC_TYPES}
A method that cannot do what it is asked throws an Error whose message says why (replaceText when find is not in the block, or is there twice without all): test first (block.text.includes(find)) or use try and catch. Handles are the ones read shows. Plain JavaScript, no await, no imports, no timers; ${limits.ms / 1000} seconds and ${limits.calls} calls to doc at most. Nothing is saved: save is a tool.
Example: let n = 0; for (const b of doc.blocks()) if (b.kind === "paragraph" && b.text.includes("Acme Ltd")) n += doc.replaceText(b.handle, "Acme Ltd", "Acme Limited", { all: true }).replaced; return n;`,
  inputSchema: args({ code: { type: "string", description: "The script: a function's body." } }, [
    "code",
  ]),
  async run({ document: id, code }) {
    const document = documents.get(id);
    return "session" in document ? runCode(document, code as string, limits) : document;
  },
});

/** @internal */
export function tools(documents: Documents, code: SandboxLimits | false = false): Tool[] {
  /** A tool over an open document's session. */
  const on = (
    name: string,
    description: string,
    inputSchema: JsonSchema & { type: "object" },
    run: (session: Session, a: Record<string, unknown>, document: OpenDocument) => ToolResult,
  ): Tool => ({
    name,
    description,
    inputSchema,
    run(a) {
      const document = documents.get(a.document);
      if (!("session" in document)) return document;
      const { session } = document;
      const before = session.editor.state.doc;
      const dirty = document.dirty;
      const point = session.checkpoint();
      let result: ToolResult;
      try {
        result = run(session, a, document);
      } catch (error) {
        // A tool that throws keeps no checkpoint open; what it did stays, as it did before.
        point.release();
        throw error;
      }
      // A document is held to a weight, whatever made it heavier: what would pass it is
      // taken back.
      if (weight(session) > document.heaviest) {
        point.rollback();
        document.dirty = dirty;
        return { text: HEAVY, isError: true };
      }
      point.release();
      // Whatever the tool answered: an edit made is an edit to save.
      if (session.editor.state.doc !== before) document.dirty = true;
      return result;
    },
  });
  const firstRead = (document: OpenDocument, limit: number): string => {
    const read = document.session.read({ limit });
    if (!read.ok) return read.message;
    return read.text + (read.next ? `\n(more: read from "${read.next}")` : "");
  };

  return [
    {
      name: "open",
      description: `Opens a Word document (.docx) from the server's folder to read and edit. Returns the document's id and its first ${READ_LIMIT} blocks, a line each, starting with the block's handle in brackets: [b7] Clause, 1.1: text. Pass handles to the other tools.`,
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The .docx file, relative to the server's folder: contract.docx.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
      async run({ path }) {
        const document = await documents.open(path);
        if (!("session" in document)) return document;
        return {
          text: `Opened ${documents.name(document)} as ${document.id}.\n${firstRead(document, READ_LIMIT)}`,
        };
      },
    },
    on(
      "read",
      `Reads an open document: its body as it would be with every tracked change accepted, a line per block, each starting with its handle. Reads ${READ_LIMIT} blocks unless limit says otherwise; a long document is read in parts with from.`,
      args({
        from: { ...HANDLE, description: "Start at this block's handle. Default: the first block." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 2000,
          description: "At most this many blocks.",
        },
      }),
      (session, { from, limit }) => {
        const result = session.read({
          ...(from === undefined ? {} : { from: from as string }),
          limit: (limit as number | undefined) ?? READ_LIMIT,
        });
        return told(result, result.ok && result.next ? `\n(more: read from "${result.next}")` : "");
      },
    ),
    on(
      "replace_text",
      'Replaces text in one paragraph, as a tracked change. find is the exact text as read shows it, capitals and spaces included, long enough to be in the block once (or pass all). The replacement takes the formatting of what it replaces; "" deletes. Returns the block as it reads now.',
      args(
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
      (session, { handle, find, replacement, all }) => {
        const result = session.replaceText(
          handle as string,
          find as string,
          replacement as string,
          {
            all: all === true,
          },
        );
        return told(result);
      },
    ),
    on(
      "insert_paragraphs",
      "Inserts new paragraphs before or after a block (a paragraph, a table, any block), as a tracked change. Each is formatted like the paragraph it goes next to (after a heading: as body text) unless it names a style. Returns the new blocks with their handles.",
      args(
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
      (session, { handle, where, paragraphs }) =>
        told(
          where === "before"
            ? session.insertBefore(handle as string, paragraphs as string[])
            : session.insertAfter(handle as string, paragraphs as string[]),
        ),
    ),
    on(
      "delete_block",
      "Deletes a paragraph, or a table with all its cells, as a tracked change. A paragraph that must stay (the last of the document or of a cell, one before a table, one that ends a section) is emptied instead, and the answer says so.",
      args({ handle: HANDLE }, ["handle"]),
      (session, { handle }) => told(session.deleteBlock(handle as string)),
    ),
    on(
      "set_style",
      "Puts a paragraph in a paragraph style (Heading 2, Normal…), as a tracked formatting change. Returns the block as it reads now.",
      args(
        {
          handle: HANDLE,
          style: {
            type: "string",
            description:
              "The style's name, as read or list_styles shows it; capitals do not count.",
          },
        },
        ["handle", "style"],
      ),
      (session, { handle, style }) => told(session.setStyle(handle as string, style as string)),
    ),
    on(
      "list_styles",
      "Lists the paragraph styles of an open document, by the names set_style and insert_paragraphs take.",
      args({}),
      (session) => ({ text: session.styles().join("\n") }),
    ),
    on(
      "comment",
      "Adds a comment to a paragraph, in the margin as in Word: on the whole paragraph, or on text in it. Use it to explain a change or to ask the reader something. It does not change the text. A deleted block takes none: to explain a deletion, comment the block before or after it.",
      args(
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
      (session, { handle, text, on: anchor }) =>
        told(
          session.comment(
            handle as string,
            text as string,
            anchor === undefined ? {} : { on: anchor as string },
          ),
        ),
    ),
    on(
      "list_controls",
      "Lists the content controls of an open document: the blanks a template leaves to fill (read shows an unfilled one as [empty: Title]). Each with its name for fill_control, its kind, its value, a list's items, and the block it is in.",
      args({}),
      (session) => {
        const all = session.controls();
        return {
          text: all.length ? all.map(control).join("\n") : "The document has no content controls.",
        };
      },
    ),
    on(
      "fill_control",
      "Fills a content control, as a tracked change: text for a text control, one of its items for a list, a day as yyyy-mm-dd for a date, true or false for a check box; null empties it. name is the control's name from list_controls (controls that share a name are all filled; a control's id fills that one). Returns the blocks changed.",
      args(
        {
          name: { type: "string", description: "The control's name, title or id." },
          value: {
            anyOf: [{ type: "string" }, { type: "boolean" }, { type: "null" }],
            description: "The value: text, true or false, or null to empty the control.",
          },
        },
        ["name", "value"],
      ),
      (session, { name, value }) => {
        const result = session.fillControl(name as string, value as string | boolean | null);
        return told(result, result.ok ? `\n${result.controls.map(control).join("\n")}` : "");
      },
    ),
    on(
      "update_fields",
      "Fills the document's merge fields («Name» in a read) from data, and updates its other fields (dates, cross-references), as tracked changes. A table of contents is left as it is unless contents is true. Returns what was updated and what was left, in words; read again to see the text.",
      args({
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
      (session, { data, contents }) =>
        told(
          session.updateFields({
            ...(data === undefined ? {} : { data: data as Record<string, string> }),
            ...(contents === true ? { contents: true } : {}),
          }),
        ),
    ),
    {
      name: "save",
      description:
        "Writes an open document to disk as a .docx, with every edit a tracked change. Without a path: a new file beside the original, named <name>.agent.docx. The original is never written over unless the server was started to allow it.",
      inputSchema: args({
        path: {
          type: "string",
          description:
            "Where to write, relative to the server's folder. Default: beside the original.",
        },
      }),
      async run({ document: id, path }) {
        const document = documents.get(id);
        return "session" in document ? documents.save(document, path) : document;
      },
    },
    on(
      "close",
      "Closes an open document. Refused while it has changes that were not saved, unless discard is true.",
      args({ discard: { type: "boolean", description: "Lose the changes that were not saved." } }),
      (_session, { discard }, document) => documents.close(document, discard === true),
    ),
    {
      name: "list_documents",
      description:
        "Lists the documents open, with their ids, files, and whether they have unsaved changes.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: () => documents.list(),
    },
    ...(code ? [runTool(documents, code)] : []),
  ];
}
