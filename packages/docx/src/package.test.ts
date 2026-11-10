import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DocxError, readPackage } from "./package.js";
import { rebuild } from "./testing/rebuild.js";
import { XmlError } from "./xml.js";
import { deflateEntry, readZip, writeZip } from "./zip.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const corpus = readdirSync(CORPUS)
  .filter((name) => name.endsWith(".docx"))
  .map((name) => ({ name, bytes: new Uint8Array(readFileSync(new URL(name, CORPUS))) }));

const MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const OFFICE_DOCUMENT =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (data: Uint8Array) => new TextDecoder().decode(data);

const TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="XML" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/WORD/document.xml" ContentType="${MAIN}"/>
</Types>`;
const rels = (...items: string[]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join("")}</Relationships>`;
const ROOT_RELS = rels(
  `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT}" Target="word/document.xml"/>`,
);

async function zip(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const entries = [];
  for (const [name, data] of Object.entries(files)) {
    entries.push(await deflateEntry(name, typeof data === "string" ? encode(data) : data));
  }
  return writeZip(entries);
}

describe("readPackage on the Word corpus", () => {
  it("has the corpus", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(5);
  });

  for (const { name, bytes } of corpus) {
    it(`${name}: writes back the identical file when nothing is replaced`, async () => {
      const pkg = await readPackage(bytes);
      expect(await pkg.write()).toEqual(bytes);
    });

    it(`${name}: finds the main document, content types and relationships`, async () => {
      const pkg = await readPackage(bytes);
      expect(pkg.mainDocument).toBe("/word/document.xml");
      expect(pkg.part(pkg.mainDocument)?.contentType).toBe(MAIN);
      expect(pkg.parts.every((part) => part.contentType !== "")).toBe(true);
      const styles = pkg.relationships(pkg.mainDocument).find((r) => r.type.endsWith("/styles"));
      expect(styles?.partName).toBe("/word/styles.xml");
      // Every internal relationship of every part points to a part in the package.
      for (const part of [{ name: "/" }, ...pkg.parts]) {
        for (const r of pkg.relationships(part.name)) {
          if (!r.external)
            expect(pkg.part(r.partName as string), `${part.name} ${r.id}`).toBeDefined();
        }
      }
    });

    it(`${name}: every XML part parses with nothing missed`, async () => {
      const pkg = await readPackage(bytes);
      const xmlParts = pkg.parts.filter((p) => /xml/.test(p.contentType));
      expect(xmlParts.length).toBeGreaterThan(5);
      for (const part of xmlParts) {
        const doc = pkg.xml(part.name);
        expect(rebuild(doc), part.name).toBe(doc.source);
        expect(doc.source).toBe(pkg.text(part.name));
      }
    });

    it(`${name}: replacing a part changes it and nothing else`, async () => {
      const pkg = await readPackage(bytes);
      const replaced = encode(
        pkg.text("/word/document.xml").replace("<w:body>", "<w:body><!-- edited -->"),
      );
      const out = await readPackage(await pkg.write(new Map([["/WORD/Document.xml", replaced]])));
      expect(out.part("/word/document.xml")?.data).toEqual(replaced);
      expect(out.parts.map((p) => p.name)).toEqual(pkg.parts.map((p) => p.name));
      for (const part of pkg.parts) {
        if (part.name !== "/word/document.xml")
          expect(out.part(part.name)?.data, part.name).toEqual(part.data);
      }
      const before = readZip(bytes);
      const after = readZip(await pkg.write(new Map([["/word/document.xml", replaced]])));
      after.forEach((entry, i) => {
        if (entry.name !== "word/document.xml")
          expect(entry.stored?.local, entry.name).toEqual(before[i]?.stored?.local);
      });
    });
  }
});

describe("readPackage", () => {
  it("resolves relationship targets against their source part", async () => {
    const pkg = await readPackage(
      await zip({
        "[Content_Types].xml": TYPES,
        "_rels/.rels": ROOT_RELS,
        "word/document.xml": "<document/>",
        "word/_rels/document.xml.rels": rels(
          '<Relationship Id="a" Type="t" Target="media/image 1.png"/>',
          '<Relationship Id="b" Type="t" Target="../customXml/item1.xml"/>',
          '<Relationship Id="c" Type="t" Target="/word/./other.xml#x"/>',
          '<Relationship Id="d" Type="t" Target="https://example.com/a?b" TargetMode="External"/>',
          '<Relationship Id="e" Type="t" Target="media/image%201.png"/>',
        ),
        "word/media/image 1.png": new Uint8Array([137, 80, 78, 71]),
        "customXml/item1.xml": "<item/>",
        "word/other.xml": "<other/>",
        "word/folder/": new Uint8Array(),
      }),
    );
    expect(pkg.relationships("/word/document.xml")).toEqual([
      {
        id: "a",
        type: "t",
        target: "media/image 1.png",
        external: false,
        partName: "/word/media/image 1.png",
      },
      {
        id: "b",
        type: "t",
        target: "../customXml/item1.xml",
        external: false,
        partName: "/customXml/item1.xml",
      },
      {
        id: "c",
        type: "t",
        target: "/word/./other.xml#x",
        external: false,
        partName: "/word/other.xml",
      },
      { id: "d", type: "t", target: "https://example.com/a?b", external: true },
      {
        id: "e",
        type: "t",
        target: "media/image%201.png",
        external: false,
        partName: "/word/media/image%201.png",
      },
    ]);
    // Percent-encoded names find the part; names compare case-insensitively.
    expect(pkg.part("/word/media/image%201.png")?.contentType).toBe("image/png");
    expect(pkg.part("/Word/Document.XML")?.name).toBe("/word/document.xml");
    // Override by part name (any case), else the default by extension (any case).
    expect(pkg.part("/word/document.xml")?.contentType).toBe(MAIN);
    expect(pkg.part("/word/other.xml")?.contentType).toBe("application/xml");
    // Folders are entries, not parts; [Content_Types].xml is not a part either.
    expect(pkg.parts.map((p) => p.name)).not.toContain("/word/folder/");
    expect(pkg.part("/[Content_Types].xml")).toBeUndefined();
    expect(pkg.relationships("/word/other.xml")).toEqual([]);
    expect(pkg.relationships("/word/document.xml")).toBe(pkg.relationships("/word/document.xml"));
  });

  it("reads text in UTF-8 and UTF-16, and rejects invalid bytes", async () => {
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...[..."<o>é</o>"].flatMap((c) => [c.charCodeAt(0), 0]),
    ]);
    const pkg = await readPackage(
      await zip({
        "[Content_Types].xml": TYPES,
        "_rels/.rels": ROOT_RELS,
        "word/document.xml": new Uint8Array([0xef, 0xbb, 0xbf, ...encode("<d>ü</d>")]),
        "word/utf16.xml": utf16,
        "word/bad.xml": new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0x3c, 0x2f, 0x61, 0x3e]),
        "word/broken.xml": "<a><b></a>",
      }),
    );
    expect(pkg.text("/word/document.xml")).toBe("<d>ü</d>");
    expect(pkg.xml("/word/utf16.xml").root.local).toBe("o");
    expect(() => pkg.text("/word/bad.xml")).toThrow(/\/word\/bad\.xml: not valid UTF-8/);
    expect(() => pkg.xml("/word/broken.xml")).toThrow(
      /\/word\/broken\.xml: End tag <\/a> does not match <b>/,
    );
    expect(() => pkg.text("/word/missing.xml")).toThrow(/No part \/word\/missing\.xml/);
    expect(() => pkg.xml("/word/missing.xml")).toThrow(DocxError);
  });

  it("rejects packages that are not a .docx", async () => {
    await expect(readPackage(await zip({ "_rels/.rels": ROOT_RELS }))).rejects.toThrow(
      /no \[Content_Types\]\.xml/,
    );
    await expect(readPackage(await zip({ "[Content_Types].xml": "<Other/>" }))).rejects.toThrow(
      /has no Types/,
    );
    await expect(
      readPackage(await zip({ "[Content_Types].xml": TYPES, "word/document.xml": "<d/>" })),
    ).rejects.toThrow(/no main document part/);
    await expect(
      readPackage(await zip({ "[Content_Types].xml": TYPES, "_rels/.rels": ROOT_RELS })),
    ).rejects.toThrow(/no main document part/);
    await expect(
      readPackage(
        await zip({
          "[Content_Types].xml": TYPES,
          "_rels/.rels": "<NotRels/>",
          "word/document.xml": "<d/>",
        }),
      ),
    ).rejects.toThrow(/\/_rels\/\.rels has no Relationships/);
    await expect(
      readPackage(
        await zip({
          "[Content_Types].xml": TYPES,
          "_rels/.rels": rels('<Relationship Id="rId1" Target="word/document.xml"/>'),
          "word/document.xml": "<d/>",
        }),
      ),
    ).rejects.toThrow(/a relationship without Id, Type or Target/);
    await expect(readPackage(encode("not a zip"))).rejects.toThrow(/Not a zip archive/);
  });

  it("passes its limits to the zip reader", async () => {
    const bytes = (corpus[0] as { bytes: Uint8Array }).bytes;
    await expect(readPackage(bytes, { maxEntries: 3 })).rejects.toThrow(/Too many entries/);
    await expect(readPackage(bytes, { maxSize: 1000 })).rejects.toThrow(/Too large/);
  });

  it("compares part names percent-decoded on both sides, never decoding a slash", async () => {
    const pkg = await readPackage(
      await zip({
        "[Content_Types].xml": TYPES,
        "_rels/.rels": ROOT_RELS,
        "word/document.xml": "<document/>",
        "word/_rels/document.xml.rels": rels(
          '<Relationship Id="a" Type="t" Target="a b.xml"/>',
          '<Relationship Id="b" Type="t" Target="http://evil.example/x"/>',
          '<Relationship Id="c" Type="t" Target="file:///C:/x.xml"/>',
        ),
        "word/a%20b.xml": "<ab/>",
      }),
    );
    const [a, b, c] = pkg.relationships("/word/document.xml");
    expect(pkg.part(a?.partName as string)?.name).toBe("/word/a%20b.xml");
    expect(pkg.part("/word/A B.xml")?.name).toBe("/word/a%20b.xml");
    // Internal in mode, but a full URI is not a part.
    expect(b).toEqual({ id: "b", type: "t", target: "http://evil.example/x", external: false });
    expect(c?.partName).toBeUndefined();
    // %2F is a character of the name, not a new segment.
    expect(pkg.part("/word%2Fdocument.xml")).toBeUndefined();
  });

  it("requires the main part to be WordprocessingML", async () => {
    const types = (main: string) => TYPES.replace(MAIN, main);
    const files = (main: string) => ({
      "[Content_Types].xml": types(main),
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": "<d/>",
    });
    await expect(readPackage(await zip(files("application/xml")))).rejects.toThrow(
      /the main part is application\/xml/,
    );
    for (const ok of [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
      "application/vnd.ms-word.document.macroEnabled.main+xml",
      "application/vnd.ms-word.template.macroEnabledTemplate.main+xml",
    ]) {
      expect((await readPackage(await zip(files(ok)))).mainDocument).toBe("/word/document.xml");
    }
  });

  it("parses each XML part once, keeping the XmlError as the cause", async () => {
    const pkg = await readPackage(
      await zip({
        "[Content_Types].xml": TYPES,
        "_rels/.rels": ROOT_RELS,
        "word/document.xml": "<document/>",
        "word/broken.xml": "<a>\n<b></a>",
      }),
    );
    expect(pkg.xml("/word/document.xml")).toBe(pkg.xml("/WORD/document.xml"));
    const error = (() => {
      try {
        pkg.xml("/word/broken.xml");
      } catch (caught) {
        return caught as DocxError;
      }
    })();
    expect(error?.cause).toBeInstanceOf(XmlError);
    expect(error?.cause instanceof XmlError && error.cause.offset).toBe(7);
  });

  it("passes the nesting limit to the XML parser", async () => {
    const bytes = (corpus[0] as { bytes: Uint8Array }).bytes;
    const pkg = await readPackage(bytes, { maxDepth: 3 });
    expect(() => pkg.xml(pkg.mainDocument)).toThrow(/nested deeper than 3/);
  });

  it("replaces only parts it has", async () => {
    const pkg = await readPackage((corpus[0] as { bytes: Uint8Array }).bytes);
    await expect(pkg.write(new Map([["/word/new.xml", encode("<n/>")]]))).rejects.toThrow(
      /No part \/word\/new\.xml to replace/,
    );
    const out = await readPackage(
      await pkg.write(new Map([["/word/styles.xml", encode("<styles/>")]])),
    );
    expect(decode(out.part("/word/styles.xml")?.data as Uint8Array)).toBe("<styles/>");
  });
});
