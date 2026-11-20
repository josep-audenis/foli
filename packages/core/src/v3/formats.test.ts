import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { createEditor } from "../state/index.js";
import { parseDocument, SCHEMA_VERSION } from "./document.js";

/**
 * One document per 0.x format (ADR-0008: every 1.x reads every earlier format), each saved by
 * the release that wrote that version: v1 by 0.1.0, v2 by 0.2.0, v3 by 0.3.0, v4 by 0.5.0, v5
 * by 0.6.0 (v3 to v5 are corpus files read by that release's `@folijs/docx`). Never regenerate
 * them with the current code: they stand for documents already saved.
 */
const dir = new URL("../../fixtures/formats/", import.meta.url);
const fixtures = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name, json: JSON.parse(readFileSync(new URL(name, dir), "utf8")) }));

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
    expect([...versions].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(SCHEMA_VERSION).toBe(5);
  });

  for (const { name, json } of fixtures) {
    it(`loads and saves ${name} without loss`, () => {
      const loaded = parseDocument(structuredClone(json));
      expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
      const saved = createEditor({ document: loaded }).getDocument();
      // Saving changes nothing, and what is saved loads back as it is.
      expect(canonical(saved)).toBe(canonical(loaded));
      expect(canonical(parseDocument(structuredClone(saved)))).toBe(canonical(saved));
      if (json.schemaVersion >= 3) {
        // v3 → v4 → v5 change the version only.
        expect(canonical({ ...saved, schemaVersion: json.schemaVersion })).toBe(canonical(json));
      } else {
        // v1 and v2 are migrated to Word's model: every character stays.
        expect(text(saved.content)).toBe(text(json.content));
        expect(text(saved.content).length).toBeGreaterThan(20);
      }
    });
  }
});
