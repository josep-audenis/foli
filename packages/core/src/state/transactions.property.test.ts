import fc from "fast-check";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { createDocument } from "../document.js";
import { Mapping, Selection, Transform, TransformError } from "../index.js";
import type { Node } from "../model/index.js";
import type { DocJSON } from "../schema.js";
import { docJSON, testSchema } from "../testing/index.js";
import { createEditor, type Editor } from "./index.js";

const RUNS = { numRuns: 10_000 };
const TIMEOUT = 300_000;

function ok(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// A uniform fraction. fc.double is uniform over representable doubles (mostly tiny values), and the
// default bias piles values on the edges; either collapses most positions to the document start.
const fraction = fc.noBias(fc.integer({ min: 0, max: 10_000 })).map((n) => n / 10_000);
const op = fc.record({
  kind: fc.constantFrom("delete", "text", "addMark", "removeMark", "split", "join", "setBlock"),
  a: fraction,
  b: fraction,
  mark: fc.constantFrom("bold", "italic", "link", "code"),
  text: fc.constantFrom("x", "yz", "é "),
});
type Op = typeof op extends fc.Arbitrary<infer T> ? T : never;

/** Applies one random operation; invalid ones (TransformError) are skipped. */
function applyOp(tr: Transform, o: Op): void {
  const size = tr.doc.content.size;
  const a = Math.round(o.a * size);
  const b = Math.round(o.b * size);
  const [from, to] = a <= b ? [a, b] : [b, a];
  const mark = testSchema.mark(o.mark, o.mark === "link" ? { href: "a" } : null);
  const caret = Selection.near(tr.doc.resolve(from)).from;
  try {
    if (o.kind === "delete") tr.delete(from, to);
    else if (o.kind === "text") tr.insertText(o.text, caret);
    else if (o.kind === "addMark" && from < to) tr.addMark(from, to, mark);
    else if (o.kind === "removeMark" && from < to) tr.removeMark(from, to, mark.type);
    else if (o.kind === "split") tr.split(caret);
    else if (o.kind === "join" && from > 0 && from < size) tr.join(from);
    else if (o.kind === "setBlock") {
      tr.setBlockType(
        from,
        to,
        testSchema.nodes[o.b < 0.5 ? "paragraph" : "heading"] as never,
        null,
      );
    }
  } catch (error) {
    if (!(error instanceof TransformError)) throw error;
  }
}

const richDocs = docJSON({ rich: true }).map((json) => testSchema.nodeFromJSON(json));

describe("transaction properties (10k runs each)", () => {
  it(
    "every step inverts exactly, and the whole transform undoes to the original",
    () => {
      fc.assert(
        fc.property(richDocs, fc.array(op, { maxLength: 8 }), (doc, ops) => {
          const tr = new Transform(doc);
          for (const o of ops) applyOp(tr, o);
          tr.doc.check();
          let current: Node = tr.doc;
          for (let i = tr.steps.length - 1; i >= 0; i--) {
            const before = tr.docs[i] as Node;
            const undone = tr.steps[i]?.invert(before).apply(current).doc;
            ok(undone?.eq(before), `step ${i} did not invert: ${tr.steps[i]?.constructor.name}`);
            current = undone as Node;
          }
          ok(current.eq(doc), "transform did not undo to the original");
        }),
        RUNS,
      );
    },
    TIMEOUT,
  );

  it(
    "step maps round-trip outside replaced ranges and, mirrored, inside them",
    () => {
      fc.assert(
        fc.property(richDocs, fc.array(op, { minLength: 1, maxLength: 4 }), (doc, ops) => {
          const tr = new Transform(doc);
          for (const o of ops) applyOp(tr, o);
          tr.steps.forEach((step, i) => {
            const map = step.getMap();
            const mirrored = new Mapping();
            mirrored.appendMap(map);
            mirrored.appendMap(map.invert(), 0);
            const size = (tr.docs[i] as Node).content.size;
            for (let pos = 0; pos <= size; pos++) {
              // Range edges are ambiguous; a start edge sticks left, everything else right.
              let inside = false;
              let atStart = false;
              map.forEach((start, end) => {
                if (pos > start && pos < end) inside = true;
                if (pos === start) atStart = true;
              });
              const assoc = atStart ? -1 : 1;
              if (!inside)
                ok(map.invert().map(map.map(pos, assoc), assoc) === pos, `round trip of ${pos}`);
              ok(mirrored.map(pos, assoc) === pos, `mirrored round trip of ${pos}`);
            }
          });
        }),
        RUNS,
      );
    },
    TIMEOUT,
  );

  it(
    "rejects text outside inline content and leaves the document unchanged",
    () => {
      fc.assert(
        fc.property(richDocs, fraction, (doc, f) => {
          const pos = Math.round(f * doc.content.size);
          const inline = doc.resolve(pos).parent.inlineContent;
          const tr = new Transform(doc);
          try {
            tr.insert(pos, testSchema.text("t"));
            ok(inline, "text accepted outside inline content");
          } catch (error) {
            ok(error instanceof TransformError, "unexpected error type");
            ok(!inline && tr.doc === doc && !tr.docChanged, "failed step changed the transform");
          }
        }),
        RUNS,
      );
    },
    TIMEOUT,
  );
});

const command = fc.record({
  kind: fc.constantFrom(
    "type",
    "backspace",
    "backspaceWord",
    "delete",
    "enter",
    "bold",
    "italic",
    "heading",
    "paragraph",
    "hardBreak",
    "selectAll",
  ),
  a: fraction,
  b: fraction,
  collapse: fc.boolean(),
});
type Cmd = typeof command extends fc.Arbitrary<infer T> ? T : never;

/** Places the selection a command runs on (select all is part of selecting). */
function selectFor(editor: Editor, c: Cmd): void {
  if (c.kind === "selectAll") {
    editor.commands.selectAll();
    return;
  }
  const size = editor.state.doc.content.size;
  const a = Math.round(c.a * size);
  editor.select(a, c.collapse ? a : Math.round(c.b * size));
}

function execute(editor: Editor, c: Cmd): void {
  const k = editor.commands;
  if (c.kind === "type") k.insertText("ab");
  else if (c.kind === "backspace") k.deleteBackward();
  else if (c.kind === "backspaceWord") k.deleteBackward("word");
  else if (c.kind === "delete") k.deleteForward();
  else if (c.kind === "enter") k.splitBlock();
  else if (c.kind === "bold") k.toggleMark("bold");
  else if (c.kind === "italic") k.toggleMark("italic");
  else if (c.kind === "heading") k.setBlockType("heading", { level: 1 });
  else if (c.kind === "paragraph") k.setBlockType("paragraph");
  else if (c.kind === "hardBreak") k.insertHardBreak();
  else k.insertText("all");
}

describe("editor history properties (10k runs)", () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it(
    "undo after N random edits restores the exact doc and selection; redo restores the result",
    () => {
      let commands = 0;
      let changes = 0;
      fc.assert(
        fc.property(
          docJSON({ rich: false }),
          fc.array(command, { minLength: 1, maxLength: 8 }),
          (json, cmds) => {
            const editor = createEditor({
              document: { ...createDocument(), content: json as DocJSON },
            });
            const initial = editor.state.doc;
            let firstSelection: Selection | null = null;
            for (const c of cmds) {
              vi.advanceTimersByTime(1000); // one undo event per command
              selectFor(editor, c);
              const selection = editor.state.selection;
              const doc = editor.state.doc;
              execute(editor, c);
              editor.state.doc.check();
              commands++;
              if (editor.state.doc !== doc) changes++;
              if (!firstSelection && editor.state.doc !== doc) firstSelection = selection;
            }
            const final = editor.state.doc;
            while (editor.commands.undo()) editor.state.doc.check();
            ok(editor.state.doc.eq(initial), "undo did not restore the document");
            if (firstSelection)
              ok(editor.state.selection.eq(firstSelection), "undo did not restore the selection");
            while (editor.commands.redo()) editor.state.doc.check();
            ok(editor.state.doc.eq(final), "redo did not restore the final document");
          },
        ),
        RUNS,
      );
      // Guard against generators that make most commands no-ops (which would pass trivially).
      ok(
        changes / commands > 0.5,
        `only ${changes} of ${commands} random commands changed the document`,
      );
    },
    TIMEOUT,
  );
});
