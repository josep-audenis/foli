import { test } from "vitest";
import { createDocument } from "../document.js";
import type { NodeType } from "../model/index.js";
import { type BlockJSON, schema } from "../schema.js";
import { createEditor } from "../state/index.js";
import { Transform } from "./transform.js";

// Run with `pnpm --filter @folijs/core bench`; results and method go in docs/benchmarks.md.
const blocks: BlockJSON[] = Array.from({ length: 4000 }, (_, i) => ({
  type: "paragraph",
  content: [{ type: "text", text: `paragraph ${i} lorem ipsum dolor sit amet` }],
}));
const document = createDocument({ type: "doc", content: blocks });
const doc = schema.nodeFromJSON(document.content);
const heading = schema.nodes.heading as NodeType;

test("setBlockType over 4,000 paragraphs", async ({ bench }) => {
  const editor = createEditor({ document });
  editor.commands.selectAll();
  let h1 = false;
  const tr = new Transform(doc).setBlockType(0, doc.content.size, heading, { level: 1 });
  await bench.compare(
    bench("Transform.setBlockType (all blocks to H1)", () => {
      new Transform(doc).setBlockType(0, doc.content.size, heading, { level: 1 });
    }),
    bench("invert + apply (undo of the above)", () => {
      tr.steps[0]?.invert(doc).apply(tr.doc);
    }),
    bench("editor: select all, setBlockType H1 ↔ paragraph", () => {
      h1 = !h1;
      editor.commands.setBlockType(h1 ? "heading" : "paragraph", h1 ? { level: 1 } : null);
    }),
  );
});
