/**
 * Code mode (ADR-0010): a script over one open document. The script runs in the sandbox and
 * sees `doc`, whose methods are the functions below over the document's session: what the
 * tools do, and nothing the tools cannot. A run that fails is taken back whole.
 */
import { formatBlocks, type Result } from "@folijs/agent";
import type { OpenDocument } from "./documents.js";
import type { ToolResult } from "./protocol.js";
import { type Host, runScript, SANDBOX_LIMITS, type SandboxLimits } from "./sandbox.js";

/** The methods of `doc`, by name: what a script may call. */
const METHODS = [
  "blocks",
  "block",
  "replaceText",
  "insertAfter",
  "insertBefore",
  "deleteBlock",
  "styles",
  "setStyle",
  "comment",
  "controls",
  "fillControl",
  "updateFields",
] as const;

/**
 * The server's own code in the sandbox, run before the script: `doc` and `console.log` over
 * `__call`, which is then out of the script's sight. A refusal is thrown, so that a script
 * which does not look at it stops there, and the run is taken back.
 */
const PRELUDE = `(() => {
  const call = globalThis.__call;
  delete globalThis.__call;
  const ask = (name, args) => {
    while (args.length && args[args.length - 1] === undefined) args.pop();
    const answer = JSON.parse(call(name, JSON.stringify(args)));
    if ("error" in answer) throw new Error(answer.error);
    return answer.value;
  };
  const doc = {};
  for (const name of ${JSON.stringify(METHODS)}) doc[name] = (...args) => ask(name, args);
  const shown = (value) => {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  };
  globalThis.doc = Object.freeze(doc);
  globalThis.console = Object.freeze({ log: (...args) => { ask("log", [args.map(shown).join(" ")]); } });
})();`;

/** @internal What a script is told of `doc`: part of the tool's description. */
export const DOC_TYPES = `doc.blocks(): Block[]                      // every block of the body, in order
doc.block(handle): Block
doc.replaceText(handle, find, replacement, { all? }): { blocks, replaced, refused }
doc.insertAfter(handle, paragraphs): { blocks }   // paragraphs: "text" | { text, style? } | a list of them
doc.insertBefore(handle, paragraphs): { blocks }
doc.deleteBlock(handle): { text }
doc.styles(): string[]
doc.setStyle(handle, style): { blocks }
doc.comment(handle, text, { on? }): { blocks, comment }
doc.controls(): Control[]                   // { id, name, kind, value, empty, items?, readOnly, block }
doc.fillControl(name, value): { blocks, controls, unfilled }
doc.updateFields({ data?, contents? }): { updated, unchanged, rebuilt, text }
console.log(...values)                      // shown in the answer
type Block = { handle, kind: "paragraph" | "table" | "other", style?, number?, text, rows?, columns?,
  cell?: { table, row, column }, depth, changed, comments }`;

const LOG_CHARS = 20_000;
const VALUE_CHARS = 50_000;
const CHANGED_LINES = 40;

/** Text of the document or of the script on one line of an answer. */
const oneLine = (text: string) => text.replace(/\r\n|[\n\r\u0085\u2028\u2029]/g, "↵");

/**
 * @internal
 * Runs `code` over `document`, and answers as a tool does. Its edits are kept when it ends
 * well, and all taken back when it does not.
 */
export async function runCode(
  document: OpenDocument,
  code: string,
  limits: SandboxLimits = SANDBOX_LIMITS,
): Promise<ToolResult> {
  const { session } = document;
  const before = session.editor.state.doc;
  const point = session.checkpoint();
  const touched = new Set<string>();
  let deleted = 0;
  let fields = false;
  const log: string[] = [];
  let logged = 0;

  /** A result of the library for the script: its refusal thrown. */
  const given = <T>(result: Result<T>) => {
    if (!result.ok) throw new Error(result.message);
    return result;
  };
  /** An edit's result: the blocks it returns are the blocks the run changed. */
  const edited = <T extends { blocks: readonly { handle: string }[] }>(result: Result<T>) => {
    const made = given(result);
    for (const block of made.blocks) touched.add(block.handle);
    return made;
  };
  // A script's arguments are JSON of any shape: the library refuses what does not fit, as it
  // does for a tool, so they are passed as they come.
  const host: Host = (name, args) => {
    const [a, b, c, d] = (Array.isArray(args) ? args : []) as [never, never, never, never];
    switch (name) {
      case "log": {
        const line = oneLine(String(a ?? ""));
        if (logged < LOG_CHARS) log.push(line.slice(0, LOG_CHARS - logged));
        logged += line.length;
        return null;
      }
      case "blocks":
        return given(session.read()).blocks;
      case "block":
        return given(session.block(a)).block;
      case "replaceText": {
        const { blocks, replaced, refused } = edited(session.replaceText(a, b, c, d));
        return { blocks, replaced, refused };
      }
      case "insertAfter":
        return { blocks: edited(session.insertAfter(a, b)).blocks };
      case "insertBefore":
        return { blocks: edited(session.insertBefore(a, b)).blocks };
      case "deleteBlock": {
        const { text } = given(session.deleteBlock(a));
        deleted++;
        return { text };
      }
      case "styles":
        return session.styles();
      case "setStyle":
        return { blocks: edited(session.setStyle(a, b)).blocks };
      case "comment": {
        const { blocks, comment } = edited(session.comment(a, b, c));
        return { blocks, comment };
      }
      case "controls":
        return session.controls();
      case "fillControl": {
        const { blocks, controls, unfilled } = edited(session.fillControl(a, b));
        return { blocks, controls, unfilled };
      }
      case "updateFields": {
        const { updated, unchanged, rebuilt, text } = given(session.updateFields(a));
        fields = true;
        return { updated, unchanged, rebuilt, text };
      }
      default:
        throw new Error(`doc has no ${oneLine(String(name)).slice(0, 40)}.`);
    }
  };

  const ran = await runScript(code, PRELUDE, host, limits);
  const said = log.length
    ? `\nLogged:\n${log.map((line) => `  ${line}`).join("\n")}${logged > LOG_CHARS ? "\n  (the log was cut)" : ""}`
    : "";

  if (!ran.ok) {
    let back = "Nothing was changed: the document is as it was before the run.";
    try {
      point.rollback();
    } catch {
      // Not seen to happen; a document half edited must not pass for one untouched.
      document.dirty = true;
      back =
        "Its edits could not be taken back: the document may hold some of them. Read it again, or close it without saving and open it again.";
    }
    const where = ran.line === null ? "" : ` at line ${ran.line}`;
    const what =
      ran.reason === "error"
        ? `The script failed${where}: ${oneLine(ran.message).slice(0, 2000)}`
        : `The script was stopped${where}. ${ran.message}`;
    return { text: `${what}\n${back}${said}`, isError: true };
  }

  point.release();
  if (session.editor.state.doc !== before) document.dirty = true;
  const value =
    ran.value === ""
      ? "The script returned nothing."
      : `Returned: ${ran.value.length > VALUE_CHARS ? `${ran.value.slice(0, VALUE_CHARS)}… (cut: ${ran.value.length} characters)` : ran.value}`;
  // The blocks its operations returned, as they read now; those it deleted since are not read.
  const read = touched.size ? session.read() : null;
  const blocks = read?.ok ? read.blocks.filter((block) => touched.has(block.handle)) : [];
  const shown = blocks.slice(0, CHANGED_LINES);
  const changed = [
    ...(shown.length
      ? [
          `Changed ${blocks.length === 1 ? "1 block" : `${blocks.length} blocks`}, as tracked changes:`,
          formatBlocks(shown),
          ...(blocks.length > shown.length
            ? [`(and ${blocks.length - shown.length} more: read to see them)`]
            : []),
        ]
      : []),
    ...(deleted ? [`Deleted or emptied ${deleted === 1 ? "1 block" : `${deleted} blocks`}.`] : []),
    ...(fields ? ["Fields were updated: read again to see the text."] : []),
  ];
  return {
    text:
      [
        value,
        ...(changed.length || session.editor.state.doc !== before
          ? changed
          : ["The document was not changed."]),
      ].join("\n") + said,
  };
}
