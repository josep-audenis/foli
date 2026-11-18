/**
 * Content controls written back (ADR-0007): each as the `w:sdtPr` and `w:sdtEndPr` it was read
 * from. A control's properties changing is 11.9's; until then that is refused, never dropped.
 */
import type { ControlJSON } from "@folijs/core";
import { controlProperties } from "../import/controls.js";
import { Recorder } from "../import/report.js";
import { DocxError } from "../package.js";
import { same } from "./properties.js";
import { fragment, type Namespaces } from "./xmlout.js";

export class ControlWriter {
  readonly #written = new Set<string>();
  /** Above any id Word gives, for the later part of a control an edit has split. */
  #nextId = 2_000_000_000;

  constructor(readonly controls: Readonly<Record<string, ControlJSON>>) {}

  /** What goes before and after a control's content, in the order `w:sdt` requires. */
  parts(id: string, ns: Namespaces): { properties: string } {
    if (!Object.hasOwn(this.controls, id))
      throw new DocxError(`Content control ${id.slice(0, 64)} has no properties`);
    const control = this.controls[id] as ControlJSON;
    if (!control.ext) throw new DocxError("A new content control cannot be exported to .docx yet");
    const { element, source } = fragment(control.ext, ns, "sdt");
    const reread = controlProperties(element, { source, report: new Recorder() });
    if (!same({ ...control, ext: undefined }, { ...reread, ext: undefined }))
      throw new DocxError("A changed content control cannot be exported to .docx yet");
    let properties = source.slice(element.openEnd, element.closeStart);
    // The same control written twice: an edit has separated its parts, and ids are unique.
    if (this.#written.has(id))
      properties = properties.replace(
        /(<[\w.-]+:id\b[^>]*?[\w.-]+:val=")-?\d+(")/,
        (_, start, end) => `${start}${this.#nextId++}${end}`,
      );
    this.#written.add(id);
    return { properties };
  }
}
