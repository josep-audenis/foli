import { test } from "vitest";
import { createDocumentV2, parseDocumentV2 } from "../document.js";
import { type DocJSON, schemaV2 } from "../schema.js";
import { pagesFixture } from "../testing/index.js";

// Run with `pnpm --filter @folijs/core bench`; results and method go in docs/benchmarks.md.
for (const pages of [1, 10, 50, 100]) {
  const json = pagesFixture(pages);
  const doc = schemaV2.nodeFromJSON(json);
  const stored = JSON.stringify(createDocumentV2(json as DocJSON));
  test(`${pages} page(s): ${doc.content.size} positions, ${stored.length} bytes`, async ({
    bench,
  }) => {
    await bench.compare(
      bench("build: schemaV2.nodeFromJSON", () => {
        schemaV2.nodeFromJSON(json);
      }),
      bench("serialize: node.toJSON", () => {
        doc.toJSON();
      }),
      bench("load: JSON.parse + parseDocumentV2", () => {
        parseDocumentV2(JSON.parse(stored));
      }),
      bench("save: JSON.stringify(node.toJSON())", () => {
        JSON.stringify(doc.toJSON());
      }),
    );
  });
}
