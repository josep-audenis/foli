import { deflateEntry, writeZip } from "../zip.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A minimal package around `body` (the inside of `w:body`), with optional extra parts. */
export async function docx(
  body: string,
  options: { rels?: string; parts?: Record<string, string>; root?: string } = {},
): Promise<Uint8Array> {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml":
      options.root ??
      `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:x="urn:x"><w:body>${body}</w:body></w:document>`,
    "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${options.rels ?? ""}</Relationships>`,
    ...options.parts,
  };
  const entries = [];
  for (const [name, text] of Object.entries(files))
    entries.push(await deflateEntry(name, new TextEncoder().encode(text)));
  return writeZip(entries);
}
