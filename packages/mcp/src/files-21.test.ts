// 21.11: a save the system refuses (a file open in Word on Windows) says so.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    renameSync: () => {
      throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
    },
  };
});

const { write } = await import("./files.js");
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("says the system refused a save, and what to do", () => {
  const dir = mkdtempSync(join(tmpdir(), "foli-mcp-"));
  made.push(dir);
  const result = write(join(dir, "out.docx"), new Uint8Array([1]), true);
  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.message).toContain("the system refused (EBUSY)");
  expect(result.ok ? "" : result.message).toContain("open in another program");
});
