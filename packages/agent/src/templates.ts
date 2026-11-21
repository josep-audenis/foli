import {
  type ControlValue,
  controlIsReadOnly,
  controlProperties,
  controlsIn,
  controlValues,
  type FieldsReport,
  fieldsIn,
  setControlValue,
  updateFields as updateFieldsOf,
} from "@folijs/core";
import { type Changed, type Context, changed } from "./operations.js";
import { type Refusal, type Result, refuse } from "./result.js";

/** A content control of the body: a place a template leaves to be filled. */
export interface Control {
  /** What `fillControl` takes: its tag, or its title when it has no tag, or its id. */
  name: string;
  tag?: string;
  title?: string;
  kind: ControlValue["kind"];
  /**
   * Text: the text. A list: the chosen item. A date: `yyyy-mm-dd`. A check box: whether it is
   * checked. Null while it is empty, and for kinds that hold no value.
   */
  value: string | boolean | null;
  /** It shows its placeholder: nothing was filled in yet. */
  empty: boolean;
  /** A drop-down list's or combo box's items, as shown. */
  items?: string[];
  /** Locked, or filled from bound data: it cannot be filled. */
  readOnly: boolean;
  /** The handle of the block it is in (the first, when it holds several). */
  block: string;
}

const FILLABLE = new Set(["text", "richText", "dropDown", "comboBox", "date", "checkbox"]);

interface Found {
  control: Control;
  id: string;
}

/** The body's controls with what a model needs of each, in document order. */
function found(context: Context): Found[] {
  const { editor, handles } = context;
  const doc = editor.state.doc;
  const ranges = new Map(controlsIn(doc).map((range) => [range.id, range]));
  const out: Found[] = [];
  for (const value of controlValues(editor.state)) {
    const range = ranges.get(value.id);
    const properties = controlProperties(editor.state, value.id);
    if (!range || !properties) continue;
    // The innermost block around the control's content: a paragraph, for all but a row's.
    const $from = doc.resolve(range.contentFrom);
    let depth = $from.depth;
    while (depth > 1 && !$from.node(depth).isBlock) depth--;
    const pos = depth > 0 ? $from.before(depth) : range.from;
    const node = doc.nodeAt(pos);
    if (!node) continue;
    const control: Control = {
      name: value.tag ?? value.title ?? value.id,
      kind: value.kind,
      value: value.value,
      empty: value.showingPlaceholder,
      readOnly: controlIsReadOnly(properties),
      block: handles.at(pos, node),
    };
    if (value.tag !== undefined) control.tag = value.tag;
    if (value.title !== undefined) control.title = value.title;
    if (properties.items) control.items = properties.items.map((i) => i.display ?? i.value);
    out.push({ control, id: value.id });
  }
  return out;
}

/** @internal */
export function controls(context: Context): Control[] {
  return found(context).map((f) => f.control);
}

const same = (a: string | undefined, b: string) => a?.trim().toLowerCase() === b;

/** @internal */
export function fillControl(
  context: Context,
  name: string,
  value: string | boolean | null,
): Result<Changed & { controls: Control[] }> {
  const { editor } = context;
  if (typeof name !== "string")
    return refuse("invalid", "A content control is named by its tag or title, a string.");
  if (value !== null && typeof value !== "string" && typeof value !== "boolean")
    return refuse("invalid", "A control's value is text, true or false, or null to empty it.");
  const all = found(context);
  const wanted = name.trim().toLowerCase();
  // By tag first (several controls may share one: all are filled), then title, then id.
  const targets = [
    all.filter((f) => same(f.control.tag, wanted)),
    all.filter((f) => same(f.control.title, wanted)),
    all.filter((f) => f.id.toLowerCase() === wanted),
  ].find((group) => group.length);
  if (!targets) {
    const names = all.map((f) => f.control.name);
    return refuse(
      "unknown-control",
      names.length
        ? `There is no content control ${JSON.stringify(name)}. The controls are: ${names.join(", ")}.`
        : "The document has no content controls.",
    );
  }
  let input: string | boolean | null = value;
  const filled: string[] = [];
  let why: Refusal | undefined;
  for (const { control, id } of targets) {
    const label = JSON.stringify(control.name);
    if (control.readOnly) {
      why ??= refuse("read-only", `The control ${label} is locked: it cannot be filled.`);
      continue;
    }
    if (!FILLABLE.has(control.kind)) {
      why ??= refuse(
        "read-only",
        `The control ${label} is a ${control.kind} control: it holds no value to fill.`,
      );
      continue;
    }
    if (control.kind === "checkbox") {
      if (input === "true" || input === "false") input = input === "true";
      if (typeof input !== "boolean") {
        why ??= refuse(
          "invalid",
          `The control ${label} is a check box: its value is true or false.`,
        );
        continue;
      }
    } else if (typeof input === "boolean") {
      why ??= refuse("invalid", `The control ${label} takes text, not true or false.`);
      continue;
    }
    if (editor.run(setControlValue(id, input))) {
      filled.push(control.block);
      continue;
    }
    why ??=
      control.kind === "dropDown"
        ? refuse(
            "invalid",
            `The control ${label} is a drop-down list: its value is one of ${(control.items ?? []).map((i) => JSON.stringify(i)).join(", ")}.`,
          )
        : control.kind === "date"
          ? refuse("invalid", `The control ${label} is a date: its value is a date as yyyy-mm-dd.`)
          : refuse("refused", `The control ${label} could not be filled.`);
  }
  if (!filled.length)
    return why ?? refuse("refused", `The control ${JSON.stringify(name)} could not be filled.`);
  const ids = new Set(targets.map((t) => t.id));
  return {
    ok: true,
    ...changed(context, filled),
    controls: found(context)
      .filter((f) => ids.has(f.id))
      .map((f) => f.control),
  };
}

export interface UpdateFieldsOptions {
  /** Values for the document's merge fields (`«Name»` in a read), by field name. */
  data?: Readonly<Record<string, unknown>>;
}

/** @internal */
export function updateFields(
  context: Context,
  options: UpdateFieldsOptions = {},
): Result<FieldsReport & { text: string }> {
  const given = options?.data;
  if (given !== undefined && (given === null || typeof given !== "object" || Array.isArray(given)))
    return refuse("invalid", "data must be an object: merge field names with their values.");
  const report = updateFieldsOf(context.editor, given ? { data: given } : {});
  const skipped = report.skipped.map(
    (s) => `${s.instruction.trim()} (${s.reason}${s.detail ? `: ${s.detail}` : ""})`,
  );
  // Merge fields are left alone without data for them, and not reported: name them.
  const data = given ?? {};
  const unfilled = new Set<string>();
  for (const field of fieldsIn(context.editor.state.doc)) {
    const name = /^\s*MERGEFIELD\s+("[^"]*"|\S+)/i
      .exec(field.instruction)?.[1]
      ?.replaceAll('"', "");
    if (name && !Object.hasOwn(data, name)) unfilled.add(name);
  }
  const changed = report.updated + report.rebuilt;
  const text = [
    `${changed} field${changed === 1 ? "" : "s"} updated, ${report.unchanged} unchanged.`,
    ...(skipped.length ? [`Left as they were: ${skipped.join("; ")}.`] : []),
    ...(unfilled.size ? [`Merge fields without data: ${[...unfilled].join(", ")}.`] : []),
  ].join(" ");
  return { ok: true, ...report, text };
}
