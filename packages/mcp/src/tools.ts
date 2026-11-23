/**
 * The tools (ADR-0009, ADR-0013): the documents', and `@folijs/agent`'s over an open
 * document's session. What a tool returns is the library's own text; its refusals come back
 * for the model to act on.
 */
import {
  INSTRUCTIONS as AGENT_INSTRUCTIONS,
  AGENT_TOOLS,
  READ_LIMIT,
  type Session,
} from "@folijs/agent";
import { DOC_TYPES, HEAVY, runCode } from "./code.js";
import type { Documents, OpenDocument } from "./documents.js";
import type { Tool, ToolResult } from "./protocol.js";
import type { SandboxLimits } from "./sandbox.js";
import type { JsonSchema, JsonSchemaOrAny } from "./schema.js";
import { weight } from "./weight.js";

/**
 * @internal
 * Said once to the model by clients that pass a server's instructions on: the library's, with
 * where a document comes from and where it goes.
 */
export const INSTRUCTIONS = `${AGENT_INSTRUCTIONS.replace(
  "Work on what read shows.",
  "Start with open, then work on what read shows.",
)}
Nothing is written to disk until save. save writes a new file beside the original and says its name.`;

const DOCUMENT: JsonSchema = {
  type: "string",
  description:
    "The document's id, as open gave it (d1). May be left out while one document is open.",
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
    ...AGENT_TOOLS.map((tool) =>
      on(
        tool.name,
        tool.description,
        { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, document: DOCUMENT } },
        (session, a) => tool.run(session, a),
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
