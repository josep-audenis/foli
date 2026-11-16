/**
 * Word's document settings part (`settings.xml`): Foli reads and writes only
 * `w:trackRevisions` (whether Word records edits as tracked changes); the rest is kept verbatim.
 */
import { isW, W } from "./import/ooxml.js";
import type { XmlElement } from "./xml.js";

/** Whether `settings` (the `w:settings` root) turns tracked changes on. */
export function trackRevisionsOf(settings: XmlElement | undefined): boolean {
  const element = settings?.children.find(
    (c): c is XmlElement => c.kind === "element" && isW(c, "trackRevisions"),
  );
  if (!element) return false;
  const value = element.attributes.find((a) => a.ns === W && a.local === "val")?.value;
  return value === undefined || !["false", "0", "off"].includes(value);
}

/** Elements `w:settings` has before `w:trackRevisions` (ECMA-376 CT_Settings, in order). */
const BEFORE = new Set([
  "writeProtection",
  "view",
  "zoom",
  "removePersonalInformation",
  "removeDateAndTime",
  "doNotDisplayPageBoundaries",
  "displayBackgroundShape",
  "printPostScriptOverText",
  "printFractionalCharacterWidth",
  "printFormsData",
  "embedTrueTypeFonts",
  "embedSystemFonts",
  "saveSubsetFonts",
  "saveFormsData",
  "mirrorMargins",
  "alignBordersAndEdges",
  "bordersDoNotSurroundHeader",
  "bordersDoNotSurroundFooter",
  "gutterAtTop",
  "hideSpellingErrors",
  "hideGrammaticalErrors",
  "activeWritingStyle",
  "proofState",
  "formsDesign",
  "attachedTemplate",
  "linkStyles",
  "stylePaneFormatFilter",
  "stylePaneSortMethod",
  "documentType",
  "mailMerge",
  "revisionView",
]);

/** `source` (a settings part, `root` its `w:settings`) with tracked changes `on`. */
export function withTrackRevisions(source: string, root: XmlElement, on: boolean): string {
  if (trackRevisionsOf(root) === on) return source;
  const children = root.children.filter((c): c is XmlElement => c.kind === "element");
  const existing = children.find((c) => isW(c, "trackRevisions"));
  const prefix = root.prefix ? `${root.prefix}:` : "";
  const element = `<${prefix}trackRevisions/>`;
  // Off: removed. On over an explicit "off": replaced.
  if (existing)
    return source.slice(0, existing.start) + (on ? element : "") + source.slice(existing.end);
  const after = children.filter((c) => c.ns === W && BEFORE.has(c.local)).at(-1);
  if (after) return source.slice(0, after.end) + element + source.slice(after.end);
  if (root.openEnd === root.end) {
    // `<w:settings/>`: opened and closed.
    return `${source.slice(0, root.openEnd - 2)}>${element}</${root.name}>${source.slice(root.end)}`;
  }
  return source.slice(0, root.openEnd) + element + source.slice(root.openEnd);
}

/** A new settings part with tracked changes on. */
export function newSettingsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:settings xmlns:w="${W}"><w:trackRevisions/></w:settings>`;
}
