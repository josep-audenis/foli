/**
 * Content controls (`w:sdt`, ADR-0007): their properties as the envelope's `controls`, with the
 * elements they were read from kept verbatim in `ext`. Export reads the same way, to tell whether
 * a control still says what its `ext` says.
 */
import { type ControlJSON, checkControl } from "@folijs/core";
import type { XmlElement } from "../xml.js";
import { attr, child, elements, isW, W, W14, W15 } from "./ooxml.js";
import { type Context, compactDefined, sourceOf } from "./properties.js";

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

const on = (value: string | undefined) => value !== "0" && value !== "false" && value !== "off";

/**
 * Whether its content may be edited as ordinary content. A bound control takes its value from its
 * data, one showing its placeholder treats typed text as placeholder, a locked one refuses edits:
 * until 11.9 honours these, such a control stays verbatim.
 */
export function plainlyEditable(control: ControlJSON): boolean {
  return (
    !control.binding &&
    !control.placeholder?.showing &&
    control.lock !== "contentLocked" &&
    control.lock !== "sdtContentLocked"
  );
}

/** The properties of `sdt`'s `w:sdtPr` and `w:sdtEndPr`, or undefined if the model cannot hold them. */
export function controlProperties(sdt: XmlElement, context: Context): ControlJSON | undefined {
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
  const checkbox = find(W14, "checkbox");
  const checked = checkbox && elements(checkbox).find((c) => c.ns === W14 && c.local === "checked");
  const placeholder = find(W, "placeholder");
  const showing = find(W, "showingPlcHdr");
  const binding = find(W, "dataBinding");
  const docPart = placeholder && attr(child(placeholder, "docPart"), "val");
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
    checked: checked ? on(attr(checked, "val", W14)) : undefined,
    placeholder:
      showing || docPart !== undefined
        ? compactDefined({
            showing: showing ? on(attr(showing, "val")) : undefined,
            docPart,
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
