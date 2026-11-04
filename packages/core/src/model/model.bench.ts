import { test } from "vitest";
import { createDocument, parseDocument } from "../document.js";
import { type DocJSON, schema } from "../schema.js";
import { pagesFixture } from "../testing/index.js";

// Run with `pnpm --filter @foli/core bench`; results and method go in docs/benchmarks.md.
for (const pages of [1, 10, 50, 100]) {
  const json = pagesFixture(pages);
  const doc = schema.nodeFromJSON(json);
  const stored = JSON.stringify(createDocument(json as DocJSON));
  test(`${pages} page(s): ${doc.content.size} positions, ${stored.length} bytes`, async ({
    bench,
  }) => {
    await bench.compare(
      bench("build: schema.nodeFromJSON", () => {
        schema.nodeFromJSON(json);
      }),
      bench("serialize: node.toJSON", () => {
        doc.toJSON();
      }),
      bench("load: JSON.parse + parseDocument", () => {
        parseDocument(JSON.parse(stored));
      }),
      bench("save: JSON.stringify(node.toJSON())", () => {
        JSON.stringify(doc.toJSON());
      }),
    );
  });
}
