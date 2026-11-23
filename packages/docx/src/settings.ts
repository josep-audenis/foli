/**
 * Word's document settings part (`settings.xml`): Foli reads and writes `w:trackRevisions`
 * (whether Word records edits as tracked changes), `w:evenAndOddHeaders` and the note properties
 * of `w:footnotePr` and `w:endnotePr`, and reads `w:doNotUseHTMLParagraphAutoSpacing`; the rest is
 * kept verbatim, and so is the part when none of them changes.
 */
import type { NotePropertiesJSON, WordSettingsJSON } from "@folijs/core";
import { child, isW, toggle, W } from "./import/ooxml.js";
import { parseXml, type XmlElement } from "./xml.js";

const elementsOf = (parent: XmlElement) =>
  parent.children.filter((c): c is XmlElement => c.kind === "element");
const valOf = (element: XmlElement | undefined, name = "val") =>
  element?.attributes.find((a) => a.ns === W && a.local === name)?.value;

/** Whether the on-off element `local` of `settings` is on. */
function isOn(settings: XmlElement | undefined, local: string): boolean {
  const element = settings && elementsOf(settings).find((c) => isW(c, local));
  if (!element) return false;
  const value = valOf(element);
  return value === undefined || !["false", "0", "off"].includes(value);
}

/**
 * Whether `settings` (the `w:settings` root) turns tracked changes on.
 * @internal
 */
export const trackRevisionsOf = (settings: XmlElement | undefined): boolean =>
  isOn(settings, "trackRevisions");

const POSITIONS = new Set(["pageBottom", "beneathText", "sectEnd", "docEnd"]);
const RESTARTS = new Set(["continuous", "eachSect", "eachPage"]);

/** A `w:footnotePr` or `w:endnotePr` of the settings (its separators stay in the file). */
function noteProperties(element: XmlElement | undefined): NotePropertiesJSON {
  const value = (local: string) => valOf(element && elementsOf(element).find((c) => isW(c, local)));
  const position = value("pos");
  const format = value("numFmt");
  const start = Number(value("numStart"));
  const restart = value("numRestart");
  return {
    ...(position && POSITIONS.has(position)
      ? { position: position as NotePropertiesJSON["position"] & string }
      : {}),
    ...(format && /^[\w-]+$/.test(format) ? { format } : {}),
    ...(Number.isInteger(start) && start >= 0 && value("numStart") ? { start } : {}),
    ...(restart && RESTARTS.has(restart)
      ? { restart: restart as NotePropertiesJSON["restart"] & string }
      : {}),
  };
}

/**
 * What the document's `settings` model holds of the part, undefined when nothing.
 * @internal
 */
export function readSettings(settings: XmlElement | undefined): WordSettingsJSON | undefined {
  if (!settings) return undefined;
  const notes = (local: string) => noteProperties(elementsOf(settings).find((c) => isW(c, local)));
  const footnotes = notes("footnotePr");
  const endnotes = notes("endnotePr");
  const compat = child(settings, "compat");
  const spacing = compat && child(compat, "doNotUseHTMLParagraphAutoSpacing");
  const out: WordSettingsJSON = {
    ...(spacing && toggle(spacing) ? { doNotUseHTMLParagraphAutoSpacing: true } : {}),
    ...(isOn(settings, "evenAndOddHeaders") ? { evenAndOddHeaders: true } : {}),
    ...(Object.keys(footnotes).length ? { footnotes } : {}),
    ...(Object.keys(endnotes).length ? { endnotes } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** `w:settings`' children in their order (ECMA-376 CT_Settings), as far as Foli writes them. */
const ORDER = [
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
  "trackRevisions",
  "doNotTrackMoves",
  "doNotTrackFormatting",
  "documentProtection",
  "autoFormatOverride",
  "styleLockTheme",
  "styleLockQFSet",
  "defaultTabStop",
  "autoHyphenation",
  "consecutiveHyphenLimit",
  "hyphenationZone",
  "doNotHyphenateCaps",
  "showEnvelope",
  "summaryLength",
  "clickAndTypeStyle",
  "defaultTableStyle",
  "evenAndOddHeaders",
  "bookFoldRevPrinting",
  "bookFoldPrinting",
  "bookFoldPrintingSheets",
  "drawingGridHorizontalSpacing",
  "drawingGridVerticalSpacing",
  "displayHorizontalDrawingGridEvery",
  "displayVerticalDrawingGridEvery",
  "doNotUseMarginsForDrawingGridOrigin",
  "drawingGridHorizontalOrigin",
  "drawingGridVerticalOrigin",
  "doNotShadeFormData",
  "noPunctuationKerning",
  "characterSpacingControl",
  "printTwoOnOne",
  "strictFirstAndLastChars",
  "noLineBreaksAfter",
  "noLineBreaksBefore",
  "savePreviewPicture",
  "doNotValidateAgainstSchema",
  "saveInvalidXml",
  "ignoreMixedContent",
  "alwaysShowPlaceholderText",
  "doNotDemarcateInvalidXml",
  "saveXmlDataOnly",
  "useXSLTWhenSaving",
  "saveThroughXslt",
  "showXMLTags",
  "alwaysMergeEmptyNamespace",
  "updateFields",
  "hdrShapeDefaults",
  "footnotePr",
  "endnotePr",
];

/** `source` with the child `local` of `root` being `element` ("": none), in its place. */
function placed(source: string, root: XmlElement, local: string, element: string): string {
  const children = elementsOf(root);
  const existing = children.find((c) => isW(c, local));
  if (existing) return source.slice(0, existing.start) + element + source.slice(existing.end);
  if (!element) return source;
  const before = new Set(ORDER.slice(0, ORDER.indexOf(local)));
  const after = children.filter((c) => c.ns === W && before.has(c.local)).at(-1);
  if (after) return source.slice(0, after.end) + element + source.slice(after.end);
  if (root.openEnd === root.end) {
    // `<w:settings/>`: opened and closed.
    return `${source.slice(0, root.openEnd - 2)}>${element}</${root.name}>${source.slice(root.end)}`;
  }
  return source.slice(0, root.openEnd) + element + source.slice(root.openEnd);
}

const prefixOf = (root: XmlElement) => (root.prefix ? `${root.prefix}:` : "");

/**
 * `source` (a settings part, `root` its `w:settings`) with tracked changes `on`.
 * @internal
 */
export function withTrackRevisions(source: string, root: XmlElement, on: boolean): string {
  if (trackRevisionsOf(root) === on) return source;
  return placed(source, root, "trackRevisions", on ? `<${prefixOf(root)}trackRevisions/>` : "");
}

/** A note properties element: `kept` (its separators, verbatim) after the properties. */
function notesXml(prefix: string, local: string, v: NotePropertiesJSON, kept = ""): string {
  const value = (name: string, x: string | number | undefined) =>
    x === undefined ? "" : `<${prefix}${name} ${prefix}val="${x}"/>`;
  const children =
    value("pos", v.position) +
    value("numFmt", v.format) +
    value("numStart", v.start) +
    value("numRestart", v.restart) +
    kept;
  return children ? `<${prefix}${local}>${children}</${prefix}${local}>` : "";
}

const NOTES = [
  ["footnotes", "footnotePr", "footnote"],
  ["endnotes", "endnotePr", "endnote"],
] as const;

/** The same properties, whatever their order. */
const sameNotes = (a: NotePropertiesJSON, b: NotePropertiesJSON) =>
  a.position === b.position &&
  a.format === b.format &&
  a.start === b.start &&
  a.restart === b.restart;

/**
 * `source` saying what `settings` says. What they leave out stays as the file has it, and a part
 * that already says it is returned as it is.
 * @internal
 */
export function withSettings(source: string, root: XmlElement, settings: WordSettingsJSON): string {
  let text = source;
  let current = root;
  const put = (local: string, element: string) => {
    text = placed(text, current, local, element);
    current = parseXml(text).root;
  };
  const prefix = prefixOf(root);
  const even = settings.evenAndOddHeaders;
  if (even !== undefined && even !== isOn(current, "evenAndOddHeaders"))
    put("evenAndOddHeaders", even ? `<${prefix}evenAndOddHeaders/>` : "");
  for (const [key, local, separator] of NOTES) {
    const wanted = settings[key];
    if (!wanted) continue;
    const element = elementsOf(current).find((c) => isW(c, local));
    if (sameNotes(wanted, noteProperties(element))) continue;
    const kept = (element ? elementsOf(element) : [])
      .filter((c) => isW(c, separator))
      .map((c) => text.slice(c.start, c.end))
      .join("");
    put(local, notesXml(prefix, local, wanted, kept));
  }
  if (settings.doNotUseHTMLParagraphAutoSpacing) {
    const compat = elementsOf(current).find((c) => isW(c, "compat"));
    const flag = compat && elementsOf(compat).find((c) => isW(c, SPACING));
    const element = `<${prefix}${SPACING}/>`;
    if (!compat) put("compat", `<${prefix}compat>${element}</${prefix}compat>`);
    else if (!flag || !toggle(flag)) {
      // In CT_Compat's order: after the options before it, before the rest and compatSetting.
      const after = elementsOf(compat)
        .filter((c) => c.ns === W && SPACING_AFTER.has(c.local))
        .at(-1);
      const at = flag ? flag.start : after ? after.end : compat.openEnd;
      const end = flag ? flag.end : at;
      text =
        compat.openEnd === compat.end
          ? `${text.slice(0, compat.openEnd - 2)}>${element}</${compat.name}>${text.slice(compat.end)}`
          : text.slice(0, at) + element + text.slice(end);
      current = parseXml(text).root;
    }
  }
  return text;
}

const SPACING = "doNotUseHTMLParagraphAutoSpacing";
/** The `w:compat` options CT_Compat puts before `doNotUseHTMLParagraphAutoSpacing`. */
const SPACING_AFTER = new Set(
  (
    "useSingleBorderforContiguousCells wpJustification noTabHangInd noLeading spaceForUL " +
    "noColumnBalance balanceSingleByteDoubleByteWidth noExtraLineSpacing doNotLeaveBackslashAlone " +
    "ulTrailSpace doNotExpandShiftReturn spacingInWholePoints lineWrapLikeWord6 " +
    "printBodyTextBeforeHeader printColBlack wpSpaceWidth showBreaksInFrames subFontBySize " +
    "suppressBottomSpacing suppressTopSpacing suppressSpacingAtTopOfPage suppressTopSpacingWP " +
    "suppressSpBfAfterPgBrk swapBordersFacingPages convMailMergeEsc truncateFontHeightsLikeWP6 " +
    "mwSmallCaps usePrinterMetrics doNotSuppressParagraphBorders wrapTrailSpaces " +
    "footnoteLayoutLikeWW8 shapeLayoutLikeWW8 alignTablesRowByRow forgetLastTabAlignment " +
    "adjustLineHeightInTable autoSpaceLikeWord95 noSpaceRaiseLower"
  ).split(" "),
);

/**
 * A new settings part. `fresh`: a package Foli made, which says it is Word 2013's
 * (`compatibilityMode` 15): without it Word opens it in compatibility mode.
 * @internal
 */
export function newSettingsXml(
  trackRevisions: boolean,
  settings: WordSettingsJSON = {},
  fresh = false,
): string {
  const compat =
    (settings.doNotUseHTMLParagraphAutoSpacing ? `<w:${SPACING}/>` : "") +
    (fresh
      ? '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>'
      : "");
  const children =
    (trackRevisions ? "<w:trackRevisions/>" : "") +
    (settings.evenAndOddHeaders ? "<w:evenAndOddHeaders/>" : "") +
    NOTES.map(([key, local]) => notesXml("w:", local, settings[key] ?? {})).join("") +
    (compat ? `<w:compat>${compat}</w:compat>` : "");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:settings xmlns:w="${W}">${children}</w:settings>`;
}
