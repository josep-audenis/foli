import { acceptAllChanges, deleteSelection, insertText } from "@folijs/core";
import { expect, it } from "vitest";
import { openSession } from "./index.js";
import { corpus } from "./testing/corpus.js";

// Found by the handles property in read.test.ts (seed 204645255): the paragraph before a table,
// deleted whole, was removed on accepting while the paragraphs before it were joining into it,
// so another paragraph took its place under a new handle.
it("accepting a delete from the start into a table keeps each block left under its handle", async () => {
  const { document } = await corpus("01-mutual-nda");
  const session = openSession(document, { author: "Agent" });
  const { editor } = session;
  const blocks = () => {
    const result = session.read();
    if (!result.ok) throw new Error(result.message);
    return result.blocks;
  };
  let first = -1;
  let inTable = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (first < 0) first = pos + 1;
    if (inTable < 0 && editor.state.doc.resolve(pos).depth > 0) inTable = pos + 1;
    return false;
  });
  expect(inTable).toBeGreaterThan(first);
  editor.select(first, inTable);
  expect(editor.run(deleteSelection)).toBe(true);
  editor.select(first);
  expect(editor.run(insertText("xy"))).toBe(true);
  const tracked = blocks();
  expect(editor.run(acceptAllChanges())).toBe(true);
  const handles = new Set(tracked.map((block) => block.handle));
  expect(blocks().filter((block) => !handles.has(block.handle))).toEqual([]);
});
