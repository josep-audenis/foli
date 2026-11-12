import { type FoliDocumentV3, parseDocumentV3 } from "@folijs/core";
import {
  DocxError,
  type DocxPackage,
  type ReadPackageOptions,
  type Relationship,
  readPackage,
} from "../package.js";
import type { XmlElement } from "../xml.js";
import { blocks, type ContentContext, Moves } from "./content.js";
import { child, isW, REL, W_STRICT } from "./ooxml.js";
import { comments, numbering, styles, theme } from "./parts.js";
import { section } from "./properties.js";
import { type ImportReport, Recorder } from "./report.js";

export interface DocxImport {
  /** The document in schema v3, validated. */
  readonly document: FoliDocumentV3;
  /**
   * The package it was read from. Export (8.5) writes the parts Foli does not edit back from
   * it, unchanged; keep it with the document.
   */
  readonly package: DocxPackage;
  readonly report: ImportReport;
}

/** Reads a `.docx` into schema v3, keeping its package for export. */
export async function importDocx(
  bytes: Uint8Array,
  options: ReadPackageOptions = {},
): Promise<DocxImport> {
  return importPackage(await readPackage(bytes, options));
}

/**
 * The document of a package in schema v3: paragraphs with their properties, runs as text with
 * marks, tracked changes, comments, styles, numbering, the theme and sections. Every element
 * Foli does not model is kept verbatim (opaque nodes, `ext`, attribute bags) and counted in the
 * report; a value the model cannot hold stays in its verbatim element and is reported
 * (`unmodeled`); not imported is only what Word recomputes or shows nothing (`dropped`).
 * Every failure is a `DocxError` (or the package's `ZipError`).
 */
export function importPackage(pkg: DocxPackage): DocxImport {
  const report = new Recorder();
  const main = pkg.xml(pkg.mainDocument);
  if (main.root.ns === W_STRICT)
    throw new DocxError("Strict Open XML documents are not supported yet");
  if (!isW(main.root, "document"))
    throw new DocxError(`${pkg.mainDocument}: not a WordprocessingML document`);
  const body = child(main.root, "body");
  if (!body) throw new DocxError(`${pkg.mainDocument}: no w:body`);

  const contextFor = (part: string, source: string): ContentContext => {
    report.part = part;
    // One lookup table per part: hyperlinks resolve in constant time.
    let byId: Map<string, Relationship> | undefined;
    const relationship = (id: string) => {
      byId ??= new Map(pkg.relationships(part).map((r) => [r.id, r]));
      return byId.get(id);
    };
    return { source, report, pkg, part, moves: new Moves(), relationship };
  };
  const related = (
    type: string,
  ): { name: string; root: XmlElement; source: string } | undefined => {
    const relationship = pkg
      .relationships(pkg.mainDocument)
      .find((r) => r.type === type && !r.external);
    const part = relationship?.partName ? pkg.part(relationship.partName) : undefined;
    if (!part) return undefined;
    const xml = pkg.xml(part.name);
    return { name: part.name, root: xml.root, source: xml.source };
  };

  const mainContext = contextFor(pkg.mainDocument, main.source);
  // The body's section: its last `w:sectPr`, whatever follows it (a bookmark end…).
  const sectPr = body.children
    .filter((c): c is XmlElement => c.kind === "element" && isW(c, "sectPr"))
    .at(-1);
  let content = blocks(body.children, mainContext, sectPr);
  if (content.length === 0) content = [{ type: "paragraph" }];
  const lastSection = sectPr ? section(sectPr, mainContext) : {};

  const stylesPart = related(REL.styles);
  const styled = stylesPart
    ? styles(stylesPart.root, contextFor(stylesPart.name, stylesPart.source))
    : { defaults: {}, styles: [] };
  const numberingPart = related(REL.numbering);
  const numbered = numberingPart
    ? numbering(numberingPart.root, contextFor(numberingPart.name, numberingPart.source))
    : { abstracts: [], instances: [] };
  const themePart = related(REL.theme);
  const themed = themePart
    ? theme(themePart.root, contextFor(themePart.name, themePart.source))
    : undefined;
  const commentsPart = related(REL.comments);
  const extended = related(REL.commentsExtended);
  const commented = commentsPart
    ? comments(
        commentsPart.root,
        extended?.root,
        contextFor(commentsPart.name, commentsPart.source),
      )
    : [];

  let document: FoliDocumentV3;
  try {
    document = parseDocumentV3({
      schemaVersion: 3,
      section: lastSection,
      defaults: styled.defaults,
      styles: styled.styles,
      numbering: numbered,
      ...(themed ? { theme: themed } : {}),
      comments: commented,
      content: { type: "doc", content },
    });
  } catch (error) {
    // Each value was checked as it was read; what is left is beyond the model's limits (an
    // element over 16 MiB kept verbatim…). A DocxError like every other import failure.
    throw new DocxError(`Cannot import: ${(error as Error).message}`, { cause: error });
  }
  return { document, package: pkg, report: report.report() };
}

export type { ImportReport } from "./report.js";
