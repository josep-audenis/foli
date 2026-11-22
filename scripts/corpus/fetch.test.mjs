import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cache, cachePath, SOURCES } from "./fetch.mjs";

describe("the external corpus (ADR-0011)", () => {
  it("keeps every file inside the cache", () => {
    expect(cachePath({ source: "poi", path: "test-data/document/a.docx" })).toBe(
      join(cache, "poi", "test-data", "document", "a.docx"),
    );
    expect(() => cachePath({ source: "poi", path: "../../package.json" })).toThrow(/refused/);
    expect(() => cachePath({ source: "..", path: "x.docx" })).toThrow(/refused/);
    // Not another source's folder, a drive, an NTFS stream or a Windows separator.
    for (const path of [
      "a/../../libreoffice/x.docx",
      "C:x.docx",
      "a.docx:ads",
      "a\\b.docx",
      "a//b.docx",
    ])
      expect(() => cachePath({ source: "poi", path })).toThrow(/refused/);
  });

  it("has a manifest of pinned sources, each file with its hash", () => {
    const { sources, files } = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "..", "corpus", "external.json"), "utf8"),
    );
    // The commits the code pins are the manifest's: moving one shows in both.
    expect(sources).toEqual(SOURCES);
    for (const source of sources) {
      expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(source.license).toBeTruthy();
    }
    const names = new Set(sources.map((s) => s.name));
    expect(files.length).toBeGreaterThanOrEqual(1000);
    for (const file of files) {
      expect(names.has(file.source)).toBe(true);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.path.toLowerCase().endsWith(".docx")).toBe(true);
    }
  });
});
