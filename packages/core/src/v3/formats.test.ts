import { describe, expect, it } from "vitest";
import v1 from "../../fixtures/formats/v1.json" with { type: "json" };
import v2 from "../../fixtures/formats/v2.json" with { type: "json" };
import v3 from "../../fixtures/formats/v3-02-services-agreement-redlined.json" with {
  type: "json",
};
import v4 from "../../fixtures/formats/v4-04-board-report.json" with { type: "json" };
import v5Offer from "../../fixtures/formats/v5-03-offer-letter-template.json" with { type: "json" };
import v5Memo from "../../fixtures/formats/v5-09-pump-test-memo.json" with { type: "json" };
import v6 from "../../fixtures/formats/v6.json" with { type: "json" };
import v7 from "../../fixtures/formats/v7.json" with { type: "json" };
import v8 from "../../fixtures/formats/v8.json" with { type: "json" };
import v9 from "../../fixtures/formats/v9.json" with { type: "json" };
import v10 from "../../fixtures/formats/v10-11-text-box-flyer.json" with { type: "json" };
import v11 from "../../fixtures/formats/v11-12-shapes-poster.json" with { type: "json" };
import type { NodeJSON } from "../model/index.js";
import { createEditor } from "../state/index.js";
import { parseDocument, SCHEMA_VERSION } from "./document.js";

/**
 * One document per 0.x format (ADR-0008: every 1.x reads every earlier format), each saved by
 * the release that wrote that version: v1 by 0.1.0, v2 by 0.2.0, v3 by 0.3.0, v4 by 0.5.0, v5
 * by 0.6.0 (v3 to v5 are corpus files read by that release's `@folijs/docx`), v6 by 1.4.0, v7
 * (v6's with the tracking switch) for 1.6.0, v8 (a table's tracked formatting, 23.2) for 1.7.0,
 * v9 (v7's with a page color, page borders and line numbers, Phase 32) for the minor after 1.9,
 * v10 (the corpus's 11 with text boxes, Phase 33) for the minor after that, v11 (the corpus's
 * 12 with shapes, Phase 34) for the one after.
 * Never regenerate
 * them with the current code: they stand for documents already saved. A new format adds one.
 */
const fixtures: { name: string; json: { schemaVersion: number; content: unknown } }[] = [
  { name: "v1", json: v1 },
  { name: "v2", json: v2 },
  { name: "v3 (02)", json: v3 },
  { name: "v4 (04)", json: v4 },
  { name: "v5 (03)", json: v5Offer },
  { name: "v5 (09)", json: v5Memo },
  { name: "v6 (picture)", json: v6 },
  { name: "v7 (tracking switch)", json: v7 },
  { name: "v8 (table formatting change)", json: v8 },
  { name: "v9 (page color, page borders, line numbers)", json: v9 },
  { name: "v10 (text boxes)", json: v10 },
  { name: "v11 (shapes)", json: v11 },
];

/** JSON with sorted keys, so key order does not count. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

/** Every character of the content, in order (v1 and v2 change shape when migrated). */
const text = (node: NodeJSON): string =>
  node.text ?? (node.content ?? []).map((child) => text(child)).join("");

describe("0.x formats", () => {
  it("has a fixture for every version", () => {
    const versions = new Set(fixtures.map((f) => f.json.schemaVersion));
    expect([...versions].sort()).toEqual([1, 10, 11, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(SCHEMA_VERSION).toBe(11);
  });

  for (const { name, json } of fixtures) {
    it(`loads and saves ${name} without loss`, async () => {
      const loaded = parseDocument(structuredClone(json));
      // Kept at the lowest version its content needs (ADR-0008): 5 unless it holds later content.
      expect(loaded.schemaVersion).toBe(Math.max(json.schemaVersion, 5));
      const saved = createEditor({ document: loaded }).getDocument();
      // Saving changes nothing, and what is saved loads back as it is.
      expect(canonical(saved)).toBe(canonical(loaded));
      expect(canonical(parseDocument(structuredClone(saved)))).toBe(canonical(saved));
      if (json.schemaVersion >= 3) {
        // v3 → v4 → … → v11 change the version only.
        expect(canonical({ ...saved, schemaVersion: json.schemaVersion })).toBe(canonical(json));
        expect(saved.schemaVersion).toBe(Math.max(json.schemaVersion, 5));
      } else {
        // v1 and v2 are migrated to Word's model: every character stays, and the whole result
        // (styles, lists, marks per run) is the one reviewed when 12.11 recorded it.
        expect(text(saved.content)).toBe(text(json.content as NodeJSON));
        expect(text(saved.content).length).toBeGreaterThan(20);
        await expect(`${JSON.stringify(saved, null, 2)}
`).toMatchFileSnapshot(`../../fixtures/formats/migrated/${name}.json`);
      }
    });
  }
});
