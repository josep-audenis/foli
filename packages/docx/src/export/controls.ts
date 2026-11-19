/**
 * Content controls written back (ADR-0007). A control keeps the `w:sdtPr` and `w:sdtEndPr` it was
 * read from: what changed is patched child by child, the rest stays byte for byte. A new control
 * gets a whole `w:sdtPr`. A control written twice (an edit split it) gets a new `w:id` the second
 * time; a copy carries none (core drops it), and Word gives it one.
 */
import type { ControlJSON } from "@folijs/core";
import { controlProperties } from "../import/controls.js";
import { child, elements, W14, W15 } from "../import/ooxml.js";
import { Recorder } from "../import/report.js";
import { DocxError } from "../package.js";
import type { XmlElement } from "../xml.js";
import { same } from "./properties.js";
import { el, escapeAttribute, fragment, type Namespaces, val } from "./xmlout.js";

/** `w:sdtPr`'s children in the order the schema gives them; the kind's element comes after. */
const ORDER = [
  "rPr",
  "alias",
  "tag",
  "id",
  "lock",
  "placeholder",
  "temporary",
  "showingPlcHdr",
  "dataBinding",
  "label",
  "tabIndex",
];
const ID = /(<[\w.-]+:id\b[^>]*?[\w.-]+:val=")(-?\d+)(")/;

interface Edit {
  from: number;
  to: number;
  text: string;
}

const itemsXml = (items: NonNullable<ControlJSON["items"]>) =>
  items
    .map((item) =>
      el("w:listItem", {
        "w:displayText": item.display ?? item.value,
        "w:value": item.value,
      }),
    )
    .join("");

/** An extension's element, its namespace declared on it where the part does not. */
const extension = (prefix: "w14" | "w15", uri: string, ns: Namespaces) =>
  ns.prefixes.has(prefix) ? {} : { [`xmlns:${prefix}`]: uri };

/** The element of a control's kind, as Word writes it. */
function kindXml(control: ControlJSON, ns: Namespaces): string {
  switch (control.kind) {
    case "text":
      return el("w:text", control.multiLine ? { "w:multiLine": "1" } : {});
    case "dropDown":
      return el("w:dropDownList", {}, itemsXml(control.items ?? []));
    case "comboBox":
      return el("w:comboBox", {}, itemsXml(control.items ?? []));
    case "date":
      return el(
        "w:date",
        { "w:fullDate": control.date },
        val("dateFormat", control.dateFormat ?? "d MMMM yyyy") +
          val("lid", "en-US") +
          val("storeMappedDataAs", "dateTime") +
          val("calendar", "gregorian"),
      );
    case "checkbox": {
      const glyph = (name: string, state: ControlJSON["checkedState"], code: string) =>
        el(`w14:${name}`, {
          "w14:val": state?.value ?? code,
          "w14:font": state?.font ?? "MS Gothic",
        });
      return el(
        "w14:checkbox",
        extension("w14", W14, ns),
        el("w14:checked", { "w14:val": control.checked ? "1" : "0" }) +
          glyph("checkedState", control.checkedState, "2612") +
          glyph("uncheckedState", control.uncheckedState, "2610"),
      );
    }
    case "picture":
      return el("w:picture");
    case "repeating":
      return el("w15:repeatingSection", extension("w15", W15, ns));
    case "repeatingItem":
      return el("w15:repeatingSectionItem", extension("w15", W15, ns));
    default:
      return "";
  }
}

/** The whole `w:sdtPr` of a control that has none yet. */
function newProperties(control: ControlJSON, id: number, ns: Namespaces): string {
  const { placeholder } = control;
  return el(
    "w:sdtPr",
    {},
    val("alias", control.alias) +
      val("tag", control.tag) +
      val("id", id) +
      val("lock", control.lock) +
      (placeholder?.docPart ? el("w:placeholder", {}, val("docPart", placeholder.docPart)) : "") +
      (placeholder?.showing ? el("w:showingPlcHdr") : "") +
      kindXml(control, ns),
  );
}

/** The kept `w:sdtPr` with what `control` says differently written into it. */
function patched(source: string, pr: XmlElement, control: ControlJSON, kept: ControlJSON): string {
  const edits: Edit[] = [];
  const children = elements(pr);
  const prefix = pr.name.includes(":") ? `${pr.name.split(":")[0]}:` : "";
  const named = (local: string) => children.find((c) => c.ns === pr.ns && c.local === local);
  /** Where a new child goes: before the first that comes after it. */
  const insertAt = (local: string) => {
    const rank = ORDER.indexOf(local);
    const next = children.find((c) => {
      const at = c.ns === pr.ns ? ORDER.indexOf(c.local) : -1;
      return at < 0 || at > rank;
    });
    return next ? next.start : pr.closeStart;
  };
  const child1 = (local: string, value: string | undefined) => {
    const old = named(local);
    const xml = value === undefined ? "" : el(`${prefix}${local}`, { [`${prefix}val`]: value });
    if (old) edits.push({ from: old.start, to: old.end, text: xml });
    else if (xml) {
      const at = insertAt(local);
      edits.push({ from: at, to: at, text: xml });
    }
  };
  const isEmptyTag = (element: XmlElement) => element.openEnd === element.end;
  /** `element`'s start tag with attribute `name` set, or gone. */
  const withAttribute = (element: XmlElement, name: string, value: string | undefined) => {
    const end = isEmptyTag(element) ? element.openEnd - 2 : element.openEnd - 1;
    let tag = source.slice(element.start, end);
    tag = tag.replace(new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`), "");
    if (value !== undefined) tag += ` ${name}="${escapeAttribute(value)}"`;
    edits.push({ from: element.start, to: end, text: tag });
  };
  /** `element` holding `inner` in place of its children (none: `inner` goes first among them). */
  const withChildren = (element: XmlElement, inner: string, replace = true) => {
    if (isEmptyTag(element))
      edits.push({
        from: element.openEnd - 2,
        to: element.end,
        text: `>${inner}</${element.name}>`,
      });
    else
      edits.push({
        from: element.openEnd,
        to: replace ? element.closeStart : element.openEnd,
        text: inner,
      });
  };
  if (control.kind !== kept.kind) throw new DocxError("A content control cannot change kind");
  if (control.alias !== kept.alias) child1("alias", control.alias);
  if (control.tag !== kept.tag) child1("tag", control.tag);
  if (control.lock !== kept.lock) child1("lock", control.lock);
  const showing = control.placeholder?.showing === true;
  if (showing !== (kept.placeholder?.showing === true)) {
    const old = named("showingPlcHdr");
    if (old) edits.push({ from: old.start, to: old.end, text: showing ? `<${old.name}/>` : "" });
    else {
      const at = insertAt("showingPlcHdr");
      edits.push({ from: at, to: at, text: `<${prefix}showingPlcHdr/>` });
    }
  }
  const list = named("dropDownList") ?? named("comboBox");
  if (list && !same(control.items, kept.items)) withChildren(list, itemsXml(control.items ?? []));
  const date = named("date");
  if (date) {
    if (control.date !== kept.date) withAttribute(date, `${prefix}fullDate`, control.date);
    if (control.dateFormat !== kept.dateFormat) {
      const format = child(date, "dateFormat");
      const xml = el(`${prefix}dateFormat`, { [`${prefix}val`]: control.dateFormat });
      if (format) edits.push({ from: format.start, to: format.end, text: xml });
      else withChildren(date, xml, false);
    }
  }
  const text = named("text");
  if (text && (control.multiLine ?? false) !== (kept.multiLine ?? false))
    withAttribute(text, `${prefix}multiLine`, control.multiLine ? "1" : undefined);
  const box = children.find((c) => c.ns === W14 && c.local === "checkbox");
  if (box && (control.checked ?? false) !== (kept.checked ?? false)) {
    const checked = elements(box).find((c) => c.ns === W14 && c.local === "checked");
    const name = checked?.name ?? box.name.replace("checkbox", "checked");
    const boxPrefix = name.slice(0, name.indexOf(":") + 1);
    const xml = el(name, { [`${boxPrefix}val`]: control.checked ? "1" : "0" });
    if (checked) edits.push({ from: checked.start, to: checked.end, text: xml });
    else withChildren(box, xml, false);
  }
  let out = source.slice(pr.start, pr.end);
  // From the end; of two put at one place, the first made ends up first.
  const order = edits.map((edit, i) => ({ edit, i }));
  order.sort((a, b) => b.edit.from - a.edit.from || b.edit.to - a.edit.to || b.i - a.i);
  for (const { edit } of order)
    out = out.slice(0, edit.from - pr.start) + edit.text + out.slice(edit.to - pr.start);
  return out;
}

/** @internal */
export class ControlWriter {
  readonly #written = new Set<string>();
  /** Every `w:id` the document's controls hold. */
  readonly #held = new Set<string>();
  /** Above any id Word gives. */
  #nextId = 2_000_000_000;

  constructor(readonly controls: Readonly<Record<string, ControlJSON>>) {
    for (const control of Object.values(controls)) {
      const id = control.ext && ID.exec(control.ext)?.[2];
      if (id) this.#held.add(id);
    }
  }

  #freshId(): number {
    while (this.#held.has(String(this.#nextId))) this.#nextId++;
    return this.#nextId++;
  }

  /** What goes before a control's content, in the order `w:sdt` requires. */
  parts(id: string, ns: Namespaces): { properties: string } {
    if (!Object.hasOwn(this.controls, id))
      throw new DocxError(`Content control ${id.slice(0, 64)} has no properties`);
    const control = this.controls[id] as ControlJSON;
    let properties = control.ext
      ? this.#kept(control, ns)
      : newProperties(control, this.#freshId(), ns);
    // The same control written twice: an edit has separated its parts, and ids are unique.
    if (this.#written.has(id))
      properties = properties.replace(
        ID,
        (_, start, _id, end) => `${start}${this.#freshId()}${end}`,
      );
    this.#written.add(id);
    return { properties };
  }

  #kept(control: ControlJSON, ns: Namespaces): string {
    const { element, source } = fragment(control.ext as string, ns, "sdt");
    const pr = child(element, "sdtPr");
    const reread = controlProperties(element, { source, report: new Recorder() });
    const end = child(element, "sdtEndPr");
    const after = end ? source.slice(end.start, end.end) : "";
    const whatItSays = (c: ControlJSON | undefined) => {
      const { ext: _ext, deleted: _deleted, placeholder, ...rest } = c ?? ({} as ControlJSON);
      const { text: _text, ...shown } = placeholder ?? {};
      return { ...rest, placeholder: { ...shown, showing: shown.showing === true } };
    };
    if (reread && same(whatItSays(control), whatItSays(reread)))
      return source.slice(element.openEnd, element.closeStart);
    if (!pr || !reread || pr.openEnd === pr.end)
      return newProperties(control, this.#freshId(), ns) + after;
    return patched(source, pr, control, reread) + after;
  }
}
