/**
 * Content controls (`w:sdt`, ADR-0007): their properties as the envelope's `controls`, with the
 * elements they were read from kept verbatim in `ext`. Export reads the same way, to tell what a
 * control says differently from its `ext`.
 */
import type { ControlJSON } from "@folijs/core";
import { checkControl } from "@folijs/core/internal";
import type { DocxPackage } from "../package.js";
import type { XmlElement } from "../xml.js";
import { attr, child, deepText, elements, isW, W, W14, W15 } from "./ooxml.js";
import { type Context, compactDefined, runProperties, sourceOf } from "./properties.js";

const KINDS: readonly [string, string, ControlJSON["kind"]][] = [
  [W, "text", "text"],
  [W, "richText", "richText"],
  [W, "dropDownList", "dropDown"],
  [W, "comboBox", "comboBox"],
  [W, "date", "date"],
  [W14, "checkbox", "checkbox"],
  [W, "picture", "picture"],
  [W15, "repeatingSection", "repeating"],
  [W15, "repeatingSectionItem", "repeatingItem"],
];
/** What marks a control as something other than an editable value. */
const OTHER = new Set([
  "docPartObj",
  "docPartList",
  "group",
  "equation",
  "citation",
  "bibliography",
]);
const GLOSSARY =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument";

const on = (value: string | undefined) => value !== "0" && value !== "false" && value !== "off";

const glossaries = new WeakMap<DocxPackage, ReadonlyMap<string, string>>();

/** The text of the package's glossary entries, by name: what placeholders come back as. */
function glossaryTexts(pkg: DocxPackage): ReadonlyMap<string, string> {
  const known = glossaries.get(pkg);
  if (known) return known;
  const texts = new Map<string, string>();
  const relationship = pkg
    .relationships(pkg.mainDocument)
    .find((r) => r.type === GLOSSARY && !r.external);
  const part = relationship?.partName ? pkg.part(relationship.partName) : undefined;
  const parts = part && child(pkg.xml(part.name).root, "docParts");
  for (const entry of parts ? elements(parts) : []) {
    const name = attr(child(child(entry, "docPartPr") ?? entry, "name"), "val");
    const body = child(entry, "docPartBody");
    if (name && body) texts.set(name, deepText(body));
  }
  glossaries.set(pkg, texts);
  return texts;
}

/**
 * The properties of `sdt`'s `w:sdtPr` and `w:sdtEndPr`, or undefined if the model cannot hold them.
 * @internal
 */
export function controlProperties(
  sdt: XmlElement,
  context: Context & { pkg?: DocxPackage },
): ControlJSON | undefined {
  const pr = child(sdt, "sdtPr");
  const end = child(sdt, "sdtEndPr");
  const props = pr ? elements(pr) : [];
  const find = (ns: string, local: string) => props.find((p) => p.ns === ns && p.local === local);
  const value = (local: string) => attr(find(W, local), "val");
  const typed = KINDS.find(([ns, local]) => find(ns, local));
  const kind: ControlJSON["kind"] = props.some((p) => p.ns === W && OTHER.has(p.local))
    ? "other"
    : (typed?.[2] ?? "richText");
  const list = find(W, "dropDownList") ?? find(W, "comboBox");
  const date = find(W, "date");
  const text = find(W, "text");
  const checkbox = find(W14, "checkbox");
  const inBox = (local: string) =>
    checkbox && elements(checkbox).find((c) => c.ns === W14 && c.local === local);
  const glyph = (local: string) => {
    const state = inBox(local);
    const code = attr(state, "val", W14);
    return code === undefined
      ? undefined
      : compactDefined({ value: code, font: attr(state, "font", W14) });
  };
  const checked = inBox("checked");
  const placeholder = find(W, "placeholder");
  const showing = find(W, "showingPlcHdr");
  const binding = find(W, "dataBinding");
  const docPart = placeholder && attr(child(placeholder, "docPart"), "val");
  const section = find(W15, "repeatingSection");
  const fixed =
    section && elements(section).find((c) => c.local === "doNotAllowInsertDeleteSection");
  const format = pr ? runProperties(child(pr, "rPr"), context) : [];
  const entry = docPart !== undefined ? context.pkg && glossaryTexts(context.pkg).get(docPart) : "";
  const control = compactDefined({
    kind,
    tag: value("tag"),
    alias: value("alias"),
    lock: value("lock"),
    items: list
      ? elements(list)
          .filter((item) => isW(item, "listItem"))
          .map((item) =>
            compactDefined({
              value: attr(item, "value") ?? attr(item, "displayText") ?? "",
              display: attr(item, "displayText"),
            }),
          )
      : undefined,
    dateFormat: date && attr(child(date, "dateFormat"), "val"),
    date: date && attr(date, "fullDate"),
    checked: checked ? on(attr(checked, "val", W14)) : undefined,
    checkedState: glyph("checkedState"),
    uncheckedState: glyph("uncheckedState"),
    multiLine:
      text && attr(text, "multiLine") !== undefined ? on(attr(text, "multiLine")) : undefined,
    format: format.length ? format : undefined,
    noInsertDelete: fixed ? on(attr(fixed, "val") ?? attr(fixed, "val", W15)) : undefined,
    placeholder:
      showing || docPart !== undefined
        ? compactDefined({
            showing: showing ? on(attr(showing, "val")) : undefined,
            docPart,
            text: entry || undefined,
          })
        : undefined,
    binding: binding
      ? compactDefined({
          xpath: attr(binding, "xpath"),
          storeItemId: attr(binding, "storeItemID"),
          prefixMappings: attr(binding, "prefixMappings"),
        })
      : undefined,
    ext: `<${sdt.name}>${pr ? sourceOf(context, pr) : ""}${end ? sourceOf(context, end) : ""}</${sdt.name}>`,
  }) as unknown as ControlJSON;
  return checkControl(control) ? undefined : control;
}
