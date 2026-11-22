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
import type { NodeJSON } from "../model/index.js";
import { createEditor } from "../state/index.js";
import { parseDocument, SCHEMA_VERSION } from "./document.js";

/**
 * One document per 0.x format (ADR-0008: every 1.x reads every earlier format), each saved by
 * the release that wrote that version: v1 by 0.1.0, v2 by 0.2.0, v3 by 0.3.0, v4 by 0.5.0, v5
 * by 0.6.0 (v3 to v5 are corpus files read by that release's `@folijs/docx`). Never regenerate
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
    expect([...versions].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(SCHEMA_VERSION).toBe(6);
  });

  for (const { name, json } of fixtures) {
    it(`loads and saves ${name} without loss`, async () => {
      const loaded = parseDocument(structuredClone(json));
      // Kept at the lowest version its content needs (ADR-0008): 5 unless it holds v6 content.
      expect(loaded.schemaVersion).toBe(json.schemaVersion === 6 ? 6 : 5);
      const saved = createEditor({ document: loaded }).getDocument();
      // Saving changes nothing, and what is saved loads back as it is.
      expect(canonical(saved)).toBe(canonical(loaded));
      expect(canonical(parseDocument(structuredClone(saved)))).toBe(canonical(saved));
      if (json.schemaVersion >= 3) {
        // v3 → v4 → v5 → v6 change the version only.
        expect(canonical({ ...saved, schemaVersion: json.schemaVersion })).toBe(canonical(json));
        expect(saved.schemaVersion).toBe(json.schemaVersion >= 6 ? 6 : 5);
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
