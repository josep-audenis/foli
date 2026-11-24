import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLocalFonts, localFontFamilies, resetLocalFonts } from "./localFonts.js";

const permission = (state: PermissionState) =>
  vi.stubGlobal("navigator", { permissions: { query: async () => ({ state }) } });

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocalFonts();
});

describe("the machine's fonts", () => {
  it("are read without a gesture only when already allowed", async () => {
    const query = vi.fn(async () => [{ family: "Inter" }]);
    vi.stubGlobal("queryLocalFonts", query);
    permission("prompt");
    await loadLocalFonts(false);
    expect(query).not.toHaveBeenCalled();
    permission("granted");
    await loadLocalFonts(false);
    expect(localFontFamilies()).toEqual(["Inter"]);
  });

  it("stay empty when refused or not supported", async () => {
    await loadLocalFonts(true);
    expect(localFontFamilies()).toEqual([]);
    vi.stubGlobal("queryLocalFonts", async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    await loadLocalFonts(true);
    expect(localFontFamilies()).toEqual([]);
  });
});
