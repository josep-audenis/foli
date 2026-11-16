import { readFileSync } from "node:fs";
import { createDocument, createEditor } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { trackRevisionsOf, withTrackRevisions } from "./settings.js";
import { parseXml } from "./xml.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const settings = (inner: string, open = `<w:settings xmlns:w="${W_NS}">`) =>
  `${open}${inner}</w:settings>`;
const toggle = (source: string, on: boolean) =>
  withTrackRevisions(source, parseXml(source).root, on);
const read = (source: string) => trackRevisionsOf(parseXml(source).root);

describe("w:trackRevisions", () => {
  it("reads on, off and Word's false values", () => {
    expect(read(settings(""))).toBe(false);
    expect(read(settings("<w:trackRevisions/>"))).toBe(true);
    expect(read(settings('<w:trackRevisions w:val="0"/>'))).toBe(false);
    expect(read(settings('<w:trackRevisions w:val="true"/>'))).toBe(true);
  });

  it("is written in its place among the settings, and removed", () => {
    const source = settings(
      '<w:zoom w:percent="100"/><w:proofState w:spelling="clean"/><w:defaultTabStop w:val="720"/>',
    );
    const on = toggle(source, true);
    expect(on).toBe(
      settings(
        '<w:zoom w:percent="100"/><w:proofState w:spelling="clean"/><w:trackRevisions/><w:defaultTabStop w:val="720"/>',
      ),
    );
    expect(toggle(on, true)).toBe(on);
    expect(toggle(on, false)).toBe(source);
    // First when nothing comes before it; into an empty element.
    expect(toggle(settings('<w:defaultTabStop w:val="720"/>'), true)).toBe(
      settings('<w:trackRevisions/><w:defaultTabStop w:val="720"/>'),
    );
    expect(toggle(`<w:settings xmlns:w="${W_NS}"/>`, true)).toBe(settings("<w:trackRevisions/>"));
    // An explicit "off" is replaced.
    expect(read(toggle(settings('<w:trackRevisions w:val="false"/>'), true))).toBe(true);
  });

  it("comes from the file and goes back to it", async () => {
    const corpus = new URL("../../../corpus/word/", import.meta.url);
    const bytes = (name: string) => new Uint8Array(readFileSync(new URL(name, corpus)));
    const redlined = await importDocx(bytes("02-services-agreement-redlined.docx"));
    expect(redlined.trackRevisions).toBe(true);
    const plain = await importDocx(bytes("05-business-letter.docx"));
    expect(plain.trackRevisions).toBe(false);

    // Unchanged: the settings part is the original's, byte for byte.
    const kept = await exportDocx(plain.document, plain.package);
    const settingsOf = async (b: Uint8Array) => (await readPackage(b)).text("/word/settings.xml");
    expect(await settingsOf(kept)).toBe(plain.package.text("/word/settings.xml"));
    const on = await exportDocx(plain.document, plain.package, { trackRevisions: true });
    expect((await importDocx(on)).trackRevisions).toBe(true);
    const off = await exportDocx(redlined.document, redlined.package, { trackRevisions: false });
    expect((await importDocx(off)).trackRevisions).toBe(false);
  });

  it("keeps changes recorded by the editor through export and import", async () => {
    const corpus = new URL("../../../corpus/word/", import.meta.url);
    const plain = await importDocx(
      new Uint8Array(readFileSync(new URL("05-business-letter.docx", corpus))),
    );
    const editor = createEditor({
      document: plain.document,
      author: "Reviewer",
      trackChanges: true,
    });
    const first = editor.state.doc.firstChild as NonNullable<typeof editor.state.doc.firstChild>;
    editor.select(1, 1 + Math.min(3, first.content.size));
    editor.commands.insertText("New");
    const exported = await exportDocx(editor.getDocument(), plain.package, {
      trackRevisions: editor.trackingChanges,
    });
    const again = await importDocx(exported);
    expect(again.trackRevisions).toBe(true);
    const marks = JSON.stringify(again.document.content.content?.[0]);
    expect(marks).toContain('"type":"insertion"');
    expect(marks).toContain('"author":"Reviewer"');
    expect(again.document.content.content?.[0]).toEqual(editor.getDocument().content.content?.[0]);
  });

  it("reads a settings part it cannot parse as tracking off, and keeps it", async () => {
    const corpus = new URL("../../../corpus/word/", import.meta.url);
    const pkg = await readPackage(
      new Uint8Array(readFileSync(new URL("05-business-letter.docx", corpus))),
    );
    const broken = await pkg.write(
      new Map([
        ["/word/settings.xml", new TextEncoder().encode("<w:settings><oops></w:settings>")],
      ]),
      [],
    );
    const imported = await importDocx(broken);
    expect(imported.trackRevisions).toBe(false);
    const again = await readPackage(await exportDocx(imported.document, imported.package));
    expect(again.text("/word/settings.xml")).toBe("<w:settings><oops></w:settings>");
  });

  it("is written into a new package only when on", async () => {
    const document = createDocument();
    expect((await importDocx(await exportDocx(document))).trackRevisions).toBe(false);
    const on = await exportDocx(document, undefined, { trackRevisions: true });
    expect((await importDocx(on)).trackRevisions).toBe(true);
  });
});
