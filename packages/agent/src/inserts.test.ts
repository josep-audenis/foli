import { createDocument, trackedChanges } from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { imageInfo, openSession, type Session } from "./index.js";
import { base64 } from "./inserts.js";

const open = (...texts: string[]) =>
  openSession(
    createDocument({
      type: "doc",
      content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    }),
    { author: "Agent" },
  );
const handles = (session: Session) =>
  (session.read() as { blocks: { handle: string }[] }).blocks.map((b) => b.handle);
const text = (session: Session) => (session.read() as { text: string }).text;

/** A PNG's signature and IHDR (a header is all `imageInfo` reads), `width` × `height` pixels. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

describe("inserting what is not text (23.6)", () => {
  it("encodes base64 as the platform does", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 1000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
      expect(base64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  it("reads an image's size and type from its first bytes", () => {
    expect(imageInfo(png(800, 400))).toEqual({ width: 800, height: 400, contentType: "image/png" });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x00, 0x10, 0x00]);
    expect(imageInfo(gif)).toEqual({ width: 32, height: 16, contentType: "image/gif" });
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30,
      0x00, 0x40, 0x03,
    ]);
    expect(imageInfo(jpeg)).toEqual({ width: 64, height: 48, contentType: "image/jpeg" });
    expect(imageInfo(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("inserts a picture after a paragraph, fitted to the page, and it survives .docx", async () => {
    const session = open("Before", "After");
    const [first] = handles(session) as [string];
    const done = session.insertItem(first, {
      kind: "picture",
      data: png(2000, 1000),
      alt: "A chart",
    });
    expect(done.ok).toBe(true);
    expect(text(session)).toMatch(
      /^\[b\d+\] Normal: Before\n\[b\d+\] Normal, changed: \[picture\]\n/,
    );
    const picture = session.document().content.content?.[1]?.content?.[0];
    expect(picture?.type).toBe("picture");
    // The default A4 page's text width (about 451 pt, 12,700 EMU a point), proportions kept.
    const width = picture?.attrs?.width as number;
    expect(width / 12_700).toBeGreaterThan(450);
    expect(width / 12_700).toBeLessThan(452);
    expect(Math.abs((picture?.attrs?.height as number) * 2 - width)).toBeLessThan(3);
    expect(picture?.attrs?.alt).toBe("A chart");
    const again = (await importDocx(await exportDocx(session.document()))).document;
    expect(JSON.stringify(again.content)).toContain('"alt":"A chart"');
  });

  it("refuses a picture without alt text, bytes it cannot read, or a bad size", () => {
    const session = open("x");
    const [x] = handles(session) as [string];
    for (const item of [
      { kind: "picture", data: png(10, 10), alt: " " },
      { kind: "picture", data: new Uint8Array([1, 2, 3]), alt: "a" },
      { kind: "picture", data: png(10, 10), alt: "a", width: 0 },
      { kind: "picture", data: "not bytes", alt: "a" },
      { kind: "sticker" },
    ])
      expect(session.insertItem(x, item as never).ok).toBe(false);
    expect(session.document().content.content).toHaveLength(1);
  });

  it("inserts page and section breaks, a horizontal line and notes, each tracked", () => {
    const session = open("One", "Two");
    const [one, two] = handles(session) as [string, string];
    expect(session.insertItem(one, { kind: "pageBreak" }).ok).toBe(true);
    expect(text(session)).toMatch(/One\[page break\]/);
    expect(session.insertItem(one, { kind: "horizontalRule" }).ok).toBe(true);
    const rule = session.document().content.content?.[1];
    expect(rule?.attrs?.borders).toEqual({
      bottom: { style: "single", size: 6, space: 1, color: "auto" },
    });
    const note = session.insertItem(two, { kind: "footnote", text: "See the annex.", on: "Two" });
    expect(note.ok).toBe(true);
    expect(text(session)).toMatch(/Two\[note\]/);
    const story = Object.values(session.document().stories ?? {}).find(
      (s) => s.kind === "footnote",
    );
    expect(JSON.stringify(story?.content)).toContain("See the annex.");
    expect(session.insertItem(two, { kind: "sectionBreak", start: "continuous" }).ok).toBe(true);
    expect(trackedChanges(session.editor.state.doc).every((c) => c.author === "Agent")).toBe(true);
    session.editor.commands.rejectAllChanges();
    expect(text(session)).not.toMatch(/\[note\]|\[page break\]/);
  });
});
