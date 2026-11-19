import { readFile } from "node:fs/promises";
import { createDocument, type FoliDocument } from "@folijs/core";
import { describe, expect, it, vi } from "vitest";
import { exportPdf, type PdfPage, type Rendered, type RenderInput } from "./index.js";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => "/* the renderer */") }));

const PDF = new Uint8Array([37, 80, 68, 70]);
const FIELDS = { updated: 2, unchanged: 1, rebuilt: 0, skipped: [] };

/** A page that records what `exportPdf` asks of it, as Playwright's and Puppeteer's would do it. */
function fakePage() {
  const calls: { method: string; arg: unknown }[] = [];
  const page: PdfPage = {
    setContent: async (html) => calls.push({ method: "setContent", arg: html }),
    addScriptTag: async (options) => calls.push({ method: "addScriptTag", arg: options }),
    evaluate: async (_fn, arg) => {
      calls.push({ method: "evaluate", arg });
      return { pages: 3, fields: FIELDS } satisfies Rendered;
    },
    pdf: async (options) => {
      calls.push({ method: "pdf", arg: options });
      return PDF;
    },
  };
  return { page, calls };
}

const pictured = (): FoliDocument => ({
  ...createDocument(),
  resources: {
    png: { contentType: "image/png", part: "word/media/image1.png" },
    emf: { contentType: "image/x-emf", part: "word/media/image2.emf" },
    web: { contentType: "image/jpeg", url: "https://example.com/a.jpg" },
    own: { contentType: "image/gif", data: "data:image/gif;base64,R0lGOD" },
  },
});

describe("exportPdf", () => {
  it("prints the document on the page: content, renderer, layout, then Chromium's PDF", async () => {
    const { page, calls } = fakePage();
    const result = await exportPdf(createDocument(), { page });
    expect(calls.map((c) => c.method)).toEqual(["setContent", "addScriptTag", "evaluate", "pdf"]);
    expect(calls[1]?.arg).toEqual({ content: "/* the renderer */" });
    const input = calls[2]?.arg as RenderInput;
    expect(input.review).toBe("markup");
    expect(input.styles).toBe("");
    expect(input.document.schemaVersion).toBe(5);
    expect(calls[3]?.arg).toEqual({
      preferCSSPageSize: true,
      printBackground: true,
      outline: true,
      tagged: true,
    });
    expect(result).toEqual({ pdf: PDF, pages: 3, fields: FIELDS });
  });

  it("keeps the page off the network: its policy, and no web URL for a picture", async () => {
    const { page, calls } = fakePage();
    await exportPdf(pictured(), { page });
    expect(calls[0]?.arg).toContain(
      `content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"`,
    );
    // Without `resources`: a resource's own data URL, else the picture's box; never its web URL.
    const images = (recorded: typeof calls) =>
      (recorded[2]?.arg as RenderInput | undefined)?.images;
    expect(images(calls)).toEqual({
      png: null,
      emf: null,
      web: null,
      own: "data:image/gif;base64,R0lGOD",
    });
    const given = fakePage();
    await exportPdf(pictured(), {
      page: given.page,
      resources: (key) =>
        key === "png" ? "http://127.0.0.1:9/a.png" : key === "web" ? "data:text/html,x" : undefined,
    });
    expect(images(given.calls)).toEqual({
      png: null,
      emf: null,
      web: null,
      own: "data:image/gif;base64,R0lGOD",
    });
  });

  it("gives the page the pictures' images: bytes and data URLs", async () => {
    const { page, calls } = fakePage();
    const parts: Record<string, { data: Uint8Array; contentType: string }> = {
      "word/media/image1.png": { data: new Uint8Array([1, 2, 3]), contentType: "image/png" },
      "word/media/image2.emf": { data: new Uint8Array([4]), contentType: "image/x-emf" },
    };
    await exportPdf(pictured(), {
      page,
      review: "final",
      styles: "@font-face{}",
      resources: (key, resource) =>
        key === "web" ? null : resource.part ? parts[resource.part] : undefined,
    });
    const input = calls[2]?.arg as RenderInput;
    // An EMF is not an image Chromium shows: the picture's box. `own` keeps its own data URL.
    expect(input.images).toEqual({
      png: "data:image/png;base64,AQID",
      emf: null,
      web: null,
      own: "data:image/gif;base64,R0lGOD",
    });
    expect(input.review).toBe("final");
    expect(input.styles).toBe("@font-face{}");
  });

  it("refuses an invalid document before touching the page", async () => {
    const { page, calls } = fakePage();
    const broken = { ...createDocument(), content: { type: "nope" } } as unknown as FoliDocument;
    await expect(exportPdf(broken, { page })).rejects.toThrow();
    await expect(exportPdf(null as unknown as FoliDocument, { page })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("refuses something that is not a page", async () => {
    await expect(exportPdf(createDocument(), { page: {} as unknown as PdfPage })).rejects.toThrow(
      TypeError,
    );
  });

  it("says when the renderer is not built, and reads it again next time", async () => {
    // A fresh module: the renderer read by the tests above is kept.
    vi.resetModules();
    const fresh = (await import("./index.js")).exportPdf;
    vi.mocked(readFile).mockRejectedValueOnce(new Error("ENOENT"));
    const { page, calls } = fakePage();
    await expect(fresh(createDocument(), { page })).rejects.toThrow(/build the package/);
    expect(calls).toEqual([]);
    await expect(fresh(createDocument(), { page })).resolves.toMatchObject({ pages: 3 });
  });
});
