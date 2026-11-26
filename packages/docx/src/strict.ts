/**
 * Strict Open XML (ECMA-376 Part 1) to Transitional (Part 4) and back, on a part's text
 * (ADR-0014). Each direction parses the part and replaces only the spans the tables below name:
 * namespace URIs, relationship types, `w:conformance`, values Strict writes otherwise (twips as
 * points, percentages with `%`, `start`/`end`), and the names Strict changes. Every other
 * character stays as it was, so kept XML sliced from the result is the original's text.
 */

import { escapeAttribute } from "./export/xmlout.js";
import {
  type ParseXmlOptions,
  parseXml,
  type XmlAttribute,
  type XmlDocument,
  type XmlElement,
  type XmlText,
} from "./xml.js";

const S = "http://purl.oclc.org/ooxml/";
const T = "http://schemas.openxmlformats.org/";

/** Strict namespace (under `purl.oclc.org/ooxml/`) → Transitional (under `schemas.openxmlformats.org/`). */
const NAMESPACES: Record<string, string> = {
  "wordprocessingml/main": "wordprocessingml/2006/main",
  "officeDocument/relationships": "officeDocument/2006/relationships",
  "officeDocument/math": "officeDocument/2006/math",
  "officeDocument/extendedProperties": "officeDocument/2006/extended-properties",
  "officeDocument/customProperties": "officeDocument/2006/custom-properties",
  "officeDocument/docPropsVTypes": "officeDocument/2006/docPropsVTypes",
  "officeDocument/customXml": "officeDocument/2006/customXml",
  "officeDocument/bibliography": "officeDocument/2006/bibliography",
  "officeDocument/sharedTypes": "officeDocument/2006/sharedTypes",
  "schemaLibrary/main": "schemaLibrary/2006/main",
  "drawingml/main": "drawingml/2006/main",
  "drawingml/wordprocessingDrawing": "drawingml/2006/wordprocessingDrawing",
  "drawingml/picture": "drawingml/2006/picture",
  "drawingml/chart": "drawingml/2006/chart",
  "drawingml/chartDrawing": "drawingml/2006/chartDrawing",
  "drawingml/diagram": "drawingml/2006/diagram",
  "drawingml/lockedCanvas": "drawingml/2006/lockedCanvas",
  "drawingml/compatibility": "drawingml/2006/compatibility",
  "spreadsheetml/main": "spreadsheetml/2006/main",
};
const TO_T = new Map(Object.entries(NAMESPACES).map(([s, t]) => [S + s, T + t]));
// Word writes `schemaLibrary` in Transitional's name even in a Strict package: read only.
const TO_S = new Map(
  [...TO_T].filter(([s]) => !s.endsWith("schemaLibrary/main")).map(([s, t]) => [t, s]),
);

const S_REL = `${S}officeDocument/relationships/`;
const T_REL = `${T}officeDocument/2006/relationships/`;
/** Relationship types whose name differs, Strict's → Transitional's (full URIs). */
const REL_NAMES = new Map([
  [`${S_REL}extendedProperties`, `${T_REL}extended-properties`],
  [`${S_REL}customProperties`, `${T_REL}custom-properties`],
  [`${S_REL}metadata/thumbnail`, `${T}package/2006/relationships/metadata/thumbnail`],
]);
const REL_NAMES_BACK = new Map([...REL_NAMES].map(([s, t]) => [t, s]));
const PACKAGE_RELS = `${T}package/2006/relationships`;

const W_S = `${S}wordprocessingml/main`;
const W_T = `${T}wordprocessingml/2006/main`;
const A_S = `${S}drawingml/main`;
const A_T = `${T}drawingml/2006/main`;

/** Attributes in twips (ST_TwipsMeasure and its kin), by WordprocessingML element. */
const TWIPS: Record<string, readonly string[]> = {
  ind: ["start", "end", "left", "right", "hanging", "firstLine"],
  spacing: ["before", "after", "line", "val"],
  tab: ["pos"],
  pgSz: ["w", "h"],
  pgMar: ["top", "right", "bottom", "left", "header", "footer", "gutter"],
  cols: ["space"],
  col: ["w", "space"],
  gridCol: ["w"],
  trHeight: ["val"],
  framePr: ["w", "h", "hSpace", "vSpace", "x", "y"],
  tblpPr: ["leftFromText", "rightFromText", "topFromText", "bottomFromText", "tblpX", "tblpY"],
  lnNumType: ["distance"],
  defaultTabStop: ["val"],
  hyphenationZone: ["val"],
  drawingGridHorizontalSpacing: ["val"],
  drawingGridVerticalSpacing: ["val"],
  drawingGridHorizontalOrigin: ["val"],
  drawingGridVerticalOrigin: ["val"],
  object: ["dxaOrig", "dyaOrig"],
  fitText: ["val"],
  marLeft: ["val"],
  marRight: ["val"],
  marTop: ["val"],
  marBottom: ["val"],
  legacy: ["legacySpace", "legacyIndent"],
};
/** Twips Word writes as numbers in Strict too: read in either form, written as numbers. */
const TWIPS_AS_NUMBERS = new Set([
  "gridCol@w",
  "spacing@val",
  "trHeight@val",
  ...["w", "h", "hSpace", "vSpace", "x", "y"].map((a) => `framePr@${a}`),
  ...["leftFromText", "rightFromText", "topFromText", "bottomFromText", "tblpX", "tblpY"].map(
    (a) => `tblpPr@${a}`,
  ),
  "lnNumType@distance",
  "drawingGridHorizontalOrigin@val",
  "drawingGridVerticalOrigin@val",
  "fitText@val",
  "marLeft@val",
  "marRight@val",
  "marTop@val",
  "marBottom@val",
  "legacy@legacySpace",
  "legacy@legacyIndent",
]);
/** `wp14` percentages written as element text (thousandths in Transitional). */
const WP14 = "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing";
const WP14_PERCENT = new Set(["pctWidth", "pctHeight", "pctPosHOffset", "pctPosVOffset"]);
/** Half-points (ST_HpsMeasure): Strict may write a universal measure; Word writes numbers. */
const HALF_POINTS: Record<string, readonly string[]> = {
  sz: ["val"],
  szCs: ["val"],
  kern: ["val"],
  position: ["val"],
  hps: ["val"],
  hpsRaise: ["val"],
  hpsBaseText: ["val"],
};
/** CT_TblWidth elements: `w:w` by `w:type` (`pct` in fiftieths of a percent, else twips). */
const WIDTHS = new Set(["tblW", "tcW", "tblInd", "tblCellSpacing", "wBefore", "wAfter"]);
/** Parents whose `w:start`/`w:end` children are Transitional's `w:left`/`w:right`. */
const SIDED = new Set(["tblBorders", "tcBorders", "tblCellMar", "tcMar"]);
const MARGINS = new Set(["tblCellMar", "tcMar"]);
const SIDES: Record<string, string> = { start: "left", end: "right" };
const SIDES_BACK: Record<string, string> = { left: "start", right: "end" };
const IND_NAMES: Record<string, string> = {
  start: "left",
  end: "right",
  startChars: "leftChars",
  endChars: "rightChars",
};
const IND_NAMES_BACK = Object.fromEntries(Object.entries(IND_NAMES).map(([s, t]) => [t, s]));
/** Values Strict spells `start`/`end`. */
const ALIGNED = new Set(["jc", "lvlJc", "tab"]);
/** Percent attributes in WordprocessingML (whole percents in Transitional). */
const PERCENT: Record<string, readonly string[]> = { zoom: ["percent"], w: ["val"] };
/** DrawingML percentages (thousandths of a percent in Transitional), by element. */
const DML_PERCENT: Record<string, readonly string[]> = {
  tint: ["val"],
  shade: ["val"],
  alpha: ["val"],
  alphaMod: ["val"],
  alphaOff: ["val"],
  lumMod: ["val"],
  lumOff: ["val"],
  satMod: ["val"],
  satOff: ["val"],
  hueMod: ["val"],
  redMod: ["val"],
  redOff: ["val"],
  greenMod: ["val"],
  greenOff: ["val"],
  blueMod: ["val"],
  blueOff: ["val"],
  spcPct: ["val"],
  gs: ["pos"],
  miter: ["lim"],
  alphaModFix: ["amt"],
  lum: ["bright", "contrast"],
  srcRect: ["l", "t", "r", "b"],
  fillRect: ["l", "t", "r", "b"],
  fillToRect: ["l", "t", "r", "b"],
  tileRect: ["l", "t", "r", "b"],
  scrgbClr: ["r", "g", "b"],
  rPr: ["baseline"],
  defRPr: ["baseline"],
  endParaRPr: ["baseline"],
};
/** `w:tblLook` and `w:cnfStyle`: Transitional's `w:val` beside the named attributes. */
const LOOK_BITS: readonly (readonly [string, number])[] = [
  ["firstRow", 0x20],
  ["lastRow", 0x40],
  ["firstColumn", 0x80],
  ["lastColumn", 0x100],
  ["noHBand", 0x200],
  ["noVBand", 0x400],
];
const CNF_NAMES = [
  "firstRow",
  "lastRow",
  "firstColumn",
  "lastColumn",
  "oddVBand",
  "evenVBand",
  "oddHBand",
  "evenHBand",
  "firstRowFirstColumn",
  "firstRowLastColumn",
  "lastRowFirstColumn",
  "lastRowLastColumn",
];

const MEASURE = /^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*(mm|cm|in|pt|pc|pi)\s*$/;
const PER_POINT: Record<string, number> = {
  pt: 1,
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  pc: 12,
  pi: 12,
};
const PERCENT_VALUE = /^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*%\s*$/;
const NUMBER = /^-?\d+$/;

/** A universal measure in points, or undefined. */
function points(value: string): number | undefined {
  const m = MEASURE.exec(value);
  return m ? Number(m[1]) * (PER_POINT[m[2] as string] as number) : undefined;
}

/** Twips as Word writes them in Strict: `36pt`, `35.40pt`. */
function twipsAsPoints(twips: number): string {
  return twips % 20 === 0 ? `${twips / 20}pt` : `${(twips / 20).toFixed(2)}pt`;
}

/** A number with at most `digits` decimals, no zeros after the point. */
function trimmed(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function setValue(edits: Edit[], attribute: XmlAttribute, value: string): void {
  if (value !== attribute.value)
    edits.push({
      start: attribute.valueStart,
      end: attribute.valueEnd,
      text: escapeAttribute(value),
    });
}

function rename(edits: Edit[], attribute: XmlAttribute, local: string): void {
  const name = attribute.prefix ? `${attribute.prefix}:${local}` : local;
  edits.push({ start: attribute.start, end: attribute.start + attribute.name.length, text: name });
}

function renameElement(edits: Edit[], element: XmlElement, local: string): void {
  const name = element.prefix ? `${element.prefix}:${local}` : local;
  edits.push({
    start: element.start + 1,
    end: element.start + 1 + element.name.length,
    text: name,
  });
  // An empty-element tag ends where its start tag does; `<x></x>` has an end tag to rename too.
  if (element.end !== element.openEnd) {
    const at = element.closeStart + 2;
    edits.push({ start: at, end: at + element.name.length, text: name });
  }
}

/** Removes an attribute with the white space before it. */
function remove(edits: Edit[], source: string, attribute: XmlAttribute): void {
  let start = attribute.start;
  while (start > 0 && /\s/.test(source[start - 1] as string)) start--;
  edits.push({ start, end: attribute.end, text: "" });
}

function applied(source: string, edits: Edit[]): string {
  if (!edits.length) return source;
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const edit of edits) {
    if (edit.start < at) throw new Error("Overlapping edits in a Strict translation");
    out += source.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + source.slice(at);
}

function* elementsOf(element: XmlElement): Generator<[XmlElement, XmlElement | undefined]> {
  const stack: [XmlElement, XmlElement | undefined][] = [[element, undefined]];
  while (stack.length) {
    const [el, parent] = stack.pop() as [XmlElement, XmlElement | undefined];
    yield [el, parent];
    for (let i = el.children.length - 1; i >= 0; i--) {
      const child = el.children[i] as XmlElement;
      if (child.kind === "element") stack.push([child, el]);
    }
  }
}

const isNamespaceDeclaration = (a: XmlAttribute) => a.name === "xmlns" || a.prefix === "xmlns";

/**
 * A Strict part's text in Transitional names and values (ADR-0014).
 * @internal
 */
export function toTransitional(source: string, options: ParseXmlOptions = {}): string {
  return transitionalOf(parseXml(source, options));
}

/**
 * {@link toTransitional} of a part already parsed.
 * @internal
 */
export function transitionalOf({ source, root }: XmlDocument): string {
  const edits: Edit[] = [];
  for (const [el, parent] of elementsOf(root)) {
    const w = el.ns === W_S || el.ns === W_T;
    const a = el.ns === A_S || el.ns === A_T;
    const has = (local: string) => el.attributes.some((x) => x.local === local);
    for (const attribute of el.attributes) {
      const { local, value } = attribute;
      if (isNamespaceDeclaration(attribute)) {
        const mapped = TO_T.get(value);
        if (mapped) setValue(edits, attribute, mapped);
        continue;
      }
      if (el.local === "Relationship" && el.ns === PACKAGE_RELS && local === "Type") {
        setValue(edits, attribute, relationshipToTransitional(value));
        continue;
      }
      if (a && el.local === "graphicData" && local === "uri") {
        setValue(edits, attribute, TO_T.get(value) ?? value);
        continue;
      }
      if (w && attribute.ns !== W_S && attribute.ns !== W_T) continue;
      if (w) {
        if (local === "conformance" && el === root) {
          remove(edits, source, attribute);
          continue;
        }
        if (
          TWIPS[el.local]?.includes(local) ||
          (MARGINS.has(parent?.local ?? "") && local === "w")
        ) {
          const p = points(value);
          if (p !== undefined) setValue(edits, attribute, String(Math.round(p * 20)));
        } else if (HALF_POINTS[el.local]?.includes(local)) {
          const p = points(value);
          if (p !== undefined) setValue(edits, attribute, String(Math.round(p * 2)));
        } else if (WIDTHS.has(el.local) && local === "w") {
          const p = points(value);
          const pct = PERCENT_VALUE.exec(value);
          if (p !== undefined) setValue(edits, attribute, String(Math.round(p * 20)));
          else if (pct) setValue(edits, attribute, String(Math.round(Number(pct[1]) * 50)));
        } else if (PERCENT[el.local]?.includes(local)) {
          const pct = PERCENT_VALUE.exec(value);
          if (pct) setValue(edits, attribute, trimmed(Number(pct[1]), 0));
        } else if (ALIGNED.has(el.local) && local === "val" && SIDES[value]) {
          setValue(edits, attribute, SIDES[value] as string);
        }
        if (el.local === "ind" && IND_NAMES[local] && !has(IND_NAMES[local] as string))
          rename(edits, attribute, IND_NAMES[local] as string);
      } else if (a && DML_PERCENT[el.local]?.includes(local) && attribute.ns === "") {
        const pct = PERCENT_VALUE.exec(value);
        if (pct) setValue(edits, attribute, trimmed(Number(pct[1]) * 1000, 0));
      }
    }
    if (
      w &&
      parent &&
      SIDED.has(parent.local) &&
      SIDES[el.local] &&
      !sibling(parent, SIDES[el.local] as string)
    )
      renameElement(edits, el, SIDES[el.local] as string);
    if (w && (el.local === "tblLook" || el.local === "cnfStyle") && !has("val"))
      edits.push(...withValue(el));
    if (el.ns === WP14 && WP14_PERCENT.has(el.local)) {
      const text = onlyText(el);
      const pct = text && PERCENT_VALUE.exec(text.text);
      if (text && pct)
        edits.push({ start: text.start, end: text.end, text: trimmed(Number(pct[1]) * 1000, 0) });
    }
  }
  return applied(source, edits);
}

/**
 * A Transitional part's text in Strict names and values, as Word writes Strict (ADR-0014).
 * @internal
 */
export function toStrict(source: string, options: ParseXmlOptions = {}): string {
  const { root } = parseXml(source, options);
  const edits: Edit[] = [];
  for (const [el, parent] of elementsOf(root)) {
    const w = el.ns === W_T || el.ns === W_S;
    const a = el.ns === A_T || el.ns === A_S;
    const has = (local: string) => el.attributes.some((x) => x.local === local);
    for (const attribute of el.attributes) {
      const { local, value } = attribute;
      if (isNamespaceDeclaration(attribute)) {
        const mapped = TO_S.get(value);
        if (mapped) setValue(edits, attribute, mapped);
        continue;
      }
      if (el.local === "Relationship" && el.ns === PACKAGE_RELS && local === "Type") {
        setValue(edits, attribute, relationshipToStrict(value));
        continue;
      }
      if (a && el.local === "graphicData" && local === "uri") {
        setValue(edits, attribute, TO_S.get(value) ?? value);
        continue;
      }
      if (w && attribute.ns !== W_S && attribute.ns !== W_T) continue;
      if (w) {
        const twips =
          (TWIPS[el.local]?.includes(local) && !TWIPS_AS_NUMBERS.has(`${el.local}@${local}`)) ||
          (MARGINS.has(parent?.local ?? "") && local === "w") ||
          (WIDTHS.has(el.local) && local === "w");
        if (twips && NUMBER.test(value)) {
          const type = el.attributes.find((x) => x.local === "type")?.value;
          setValue(
            edits,
            attribute,
            type === "pct" ? `${trimmed(Number(value) / 50, 2)}%` : twipsAsPoints(Number(value)),
          );
        } else if (PERCENT[el.local]?.includes(local) && NUMBER.test(value)) {
          setValue(edits, attribute, `${value}%`);
        } else if (ALIGNED.has(el.local) && local === "val" && SIDES_BACK[value]) {
          setValue(edits, attribute, SIDES_BACK[value] as string);
        } else if ((el.local === "tblLook" || el.local === "cnfStyle") && local === "val") {
          edits.push(...expanded(el, attribute, source));
        }
        if (el.local === "ind" && IND_NAMES_BACK[local] && !has(IND_NAMES_BACK[local] as string))
          rename(edits, attribute, IND_NAMES_BACK[local] as string);
      } else if (
        a &&
        DML_PERCENT[el.local]?.includes(local) &&
        attribute.ns === "" &&
        NUMBER.test(value)
      ) {
        setValue(edits, attribute, `${trimmed(Number(value) / 1000, 3)}%`);
      }
    }
    if (
      w &&
      parent &&
      SIDED.has(parent.local) &&
      SIDES_BACK[el.local] &&
      !sibling(parent, SIDES_BACK[el.local] as string)
    )
      renameElement(edits, el, SIDES_BACK[el.local] as string);
    if (el.ns === WP14 && WP14_PERCENT.has(el.local)) {
      const text = onlyText(el);
      if (text && NUMBER.test(text.text))
        edits.push({
          start: text.start,
          end: text.end,
          text: `${trimmed(Number(text.text) / 1000, 3)}%`,
        });
    }
  }
  if (
    (root.ns === W_T || root.ns === W_S) &&
    root.local === "document" &&
    !root.attributes.some((x) => x.local === "conformance")
  ) {
    const at = root.openEnd - (source[root.openEnd - 2] === "/" ? 2 : 1);
    const prefix = root.prefix ? `${root.prefix}:` : "";
    edits.push({ start: at, end: at, text: ` ${prefix}conformance="strict"` });
  }
  return applied(source, edits);
}

/** An element's text when it holds nothing else. */
function onlyText(el: XmlElement): XmlText | undefined {
  const [first, ...rest] = el.children;
  return first?.kind === "text" && !first.cdata && !rest.length ? first : undefined;
}

/**
 * Transitional's `w:val` on `w:tblLook` and `w:cnfStyle`, from the named attributes Strict
 * writes, first, as Word writes it in Transitional.
 */
function withValue(el: XmlElement): Edit[] {
  // After the namespace declarations, so a prefix declared on the element is in scope.
  const declarations = el.attributes.filter(isNamespaceDeclaration);
  const at = declarations.length
    ? (declarations[declarations.length - 1] as XmlAttribute).end
    : el.start + 1 + el.name.length;
  const flag = (name: string) => {
    const v = el.attributes.find((x) => x.local === name)?.value;
    return v === "1" || v === "true" || v === "on";
  };
  const value =
    el.local === "tblLook"
      ? LOOK_BITS.reduce((bits, [name, bit]) => (flag(name) ? bits | bit : bits), 0)
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")
      : CNF_NAMES.map((name) => (flag(name) ? "1" : "0")).join("");
  const prefix = el.prefix ? `${el.prefix}:` : "";
  return [{ start: at, end: at, text: ` ${prefix}val="${value}"` }];
}

function sibling(parent: XmlElement, local: string): boolean {
  return parent.children.some((c) => c.kind === "element" && c.local === local);
}

/**
 * `w:tblLook@w:val` and `w:cnfStyle@w:val` are not in Strict: removed, and the flags they hold
 * written as the named attributes Strict has, where the element lacks them.
 */
function expanded(el: XmlElement, attribute: XmlAttribute, source: string): Edit[] {
  const edits: Edit[] = [];
  const valid =
    el.local === "tblLook"
      ? /^[0-9A-Fa-f]{1,4}$/.test(attribute.value)
      : /^[01]{12}$/.test(attribute.value);
  // A value Foli cannot read is kept: removing it would lose what it says.
  if (!valid) return edits;
  remove(edits, source, attribute);
  const named = new Set(el.attributes.map((x) => x.local));
  const prefix = attribute.prefix ? `${attribute.prefix}:` : "";
  let flags: [string, boolean][] = [];
  if (el.local === "tblLook" && /^[0-9A-Fa-f]{1,4}$/.test(attribute.value)) {
    const bits = Number.parseInt(attribute.value, 16);
    flags = LOOK_BITS.map(([name, bit]) => [name, (bits & bit) !== 0]);
  } else if (el.local === "cnfStyle" && /^[01]{12}$/.test(attribute.value)) {
    flags = CNF_NAMES.map((name, i) => [name, attribute.value[i] === "1"]);
  }
  const added = flags
    .filter(([name]) => !named.has(name))
    .map(([name, on]) => ` ${prefix}${name}="${on ? 1 : 0}"`)
    .join("");
  if (added) edits.push({ start: attribute.end, end: attribute.end, text: added });
  return edits;
}

function relationshipToTransitional(type: string): string {
  const named = REL_NAMES.get(type);
  if (named) return named;
  return type.startsWith(S_REL) ? T_REL + type.slice(S_REL.length) : type;
}

function relationshipToStrict(type: string): string {
  const named = REL_NAMES_BACK.get(type);
  if (named) return named;
  return type.startsWith(T_REL) ? S_REL + type.slice(T_REL.length) : type;
}

/**
 * Whether a package's own relationships (`/_rels/.rels`, its text) make it Strict.
 * @internal
 */
export function isStrictPackage(rootRelationships: string): boolean {
  return rootRelationships.includes(`${S_REL}officeDocument`);
}
