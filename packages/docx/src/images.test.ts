import { afterEach, describe, expect, it, vi } from "vitest";
import { packageImages, readPackage } from "./index.js";
import { deflateEntry, writeZip } from "./zip.js";

/** Object URLs for a package's pictures (10.8b). */

async function packageOf(parts: Record<string, [string, Uint8Array]>) {
  const types = Object.entries(parts)
    .map(([name, [type]]) => `<Override PartName="/${name}" ContentType="${type}"/>`)
    .join("");
  const files: [string, Uint8Array][] = [
    [
      "[Content_Types].xml",
      new TextEncoder().encode(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${types}</Types>`,
      ),
    ],
    [
      "_rels/.rels",
      new TextEncoder().encode(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
    ],
    [
      "word/document.xml",
      new TextEncoder().encode(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`,
      ),
    ],
    ...Object.entries(parts).map(([name, [, data]]): [string, Uint8Array] => [name, data]),
  ];
  const entries = [];
  for (const [name, data] of files) entries.push(await deflateEntry(name, data));
  return readPackage(await writeZip(entries));
}

describe("packageImages", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives raster images object URLs once each, and revokes them", async () => {
    let n = 0;
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++n}`);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const pkg = await packageOf({ "word/media/a.png": ["image/png", new Uint8Array([1])] });
    const images = packageImages(pkg);
    const resource = { contentType: "image/png", part: "word/media/a.png" };
    expect(images.url("a", resource)).toBe("blob:1");
    expect(images.url("a", resource)).toBe("blob:1");
    expect(create).toHaveBeenCalledTimes(1);
    images.revoke();
    expect(revoke).toHaveBeenCalledWith("blob:1");
  });

  it("gives an SVG a data: URL, never a blob: one; none for what browsers cannot show", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:x");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const pkg = await packageOf({
      "word/media/a.svg": ["image/svg+xml", svg],
      "word/media/b.emf": ["image/x-emf", new Uint8Array([1])],
    });
    const images = packageImages(pkg);
    const url = images.url("a", { contentType: "image/svg+xml", part: "word/media/a.svg" });
    expect(url?.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(atob((url as string).split(",")[1] as string)).toBe(new TextDecoder().decode(svg));
    expect(
      images.url("b", { contentType: "image/x-emf", part: "word/media/b.emf" }),
    ).toBeUndefined();
    // A resource that names no part is not looked up by its key.
    expect(images.url("word/media/a.svg", { contentType: "image/svg+xml" })).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});
