import {
  type ControlValue,
  controlIsReadOnly,
  controlProperties,
  controlsIn,
  controlValues,
  type Field,
  type FieldsReport,
  fieldsIn,
  parseFieldInstruction,
  setControlValue,
  updateFields as updateFieldsOf,
} from "@folijs/core";
import { type Changed, type Context, changed } from "./operations.js";
import { oneLine, readBlocks } from "./read.js";
import { type Refusal, type Result, refuse } from "./result.js";

/** A content control of the body: a place a template leaves to be filled. */
export interface Control {
  /** Its own name in the document: what `fillControl` takes to fill this control and no other. */
  id: string;
  /**
   * Its tag, or its title when it has no tag, or its id. `fillControl` takes it too; controls
   * that share a tag are all filled by it.
   */
  name: string;
  tag?: string;
  title?: string;
  kind: ControlValue["kind"];
  /**
   * Text: the text. A list: the chosen item. A date: `yyyy-mm-dd`, or the text typed. A check
   * box: whether it is checked. Null while it is empty, and for kinds that hold no value.
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

/** A control that was not filled, with why, when others of the same name were. */
export interface Unfilled {
  id: string;
  name: string;
  code: Refusal["code"];
  message: string;
}

const FILLABLE = new Set(["text", "richText", "dropDown", "comboBox", "date", "checkbox"]);

/**
 * The body's controls with what a model needs of each, in document order. Not those in a block
 * that is not read (deleted as a tracked change): they are gone to the agent, as their block is.
 */
function found(context: Context): Control[] {
  const { editor, handles } = context;
  const doc = editor.state.doc;
  // A read first: handles are issued in the document's order, whatever is asked first.
  const read = new Set(readBlocks(editor.state, handles).map((block) => block.handle));
  const ranges = new Map<string, ReturnType<typeof controlsIn>[number]>();
  // The first range of an id, as `controlValues` reports the first.
  for (const range of controlsIn(doc)) if (!ranges.has(range.id)) ranges.set(range.id, range);
  const out: Control[] = [];
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
    const block = handles.at(pos, node);
    if (!read.has(block)) continue;
    // A list's value reads as its item is shown: what `items` lists and `fillControl` takes.
    const item = properties.items?.find((i) => i.value === value.value);
    const control: Control = {
      id: value.id,
      name: oneLine(value.tag || value.title || value.id),
      kind: value.kind,
      value: shownValue(item?.display ?? value.value),
      empty: value.showingPlaceholder,
      readOnly: controlIsReadOnly(properties),
      block,
    };
    if (value.tag) control.tag = oneLine(value.tag);
    if (value.title) control.title = oneLine(value.title);
    if (properties.items)
      control.items = properties.items.map((i) => oneLine(i.display ?? i.value));
    out.push(control);
  }
  return out;
}

/** @internal */
export function controls(context: Context): Control[] {
  return found(context);
}

/** A control's value as it is given: its text on one line, as all a document names. */
const shownValue = (value: string | boolean | null) =>
  typeof value === "string" ? oneLine(value) : value;

const same = (a: string | undefined, b: string) => a?.trim().toLowerCase() === b;
const isDay = (text: string) => {
  const day = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === text;
};

/** Why `control` does not take `value`, known before trying; null when it may. */
function unfit(control: Control, value: string | boolean | null): Refusal | null {
  const label = JSON.stringify(control.name);
  if (control.readOnly)
    return refuse("read-only", `The control ${label} is locked: it cannot be filled.`);
  if (!FILLABLE.has(control.kind))
    return refuse(
      "read-only",
      `The control ${label} is a ${control.kind} control: it holds no value to fill.`,
    );
  if (control.kind === "checkbox")
    return typeof value === "boolean"
      ? null
      : refuse("invalid", `The control ${label} is a check box: its value is true or false.`);
  if (typeof value === "boolean")
    return refuse("invalid", `The control ${label} takes text, not true or false.`);
  if (control.kind === "dropDown" && value && !control.items?.includes(value))
    return refuse(
      "invalid",
      `The control ${label} is a drop-down list: its value is one of ${(control.items ?? []).map((i) => JSON.stringify(i)).join(", ")}.`,
    );
  if (control.kind === "date" && value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isDay(value))
    return refuse("invalid", `${JSON.stringify(value)} is not a day of the calendar.`);
  return null;
}

/** @internal */
export function fillControl(
  context: Context,
  name: string,
  value: string | boolean | null,
): Result<Changed & { controls: Control[]; unfilled: Unfilled[] }> {
  const { editor } = context;
  if (typeof name !== "string")
    return refuse("invalid", "A content control is named by its id, tag or title, a string.");
  if (value !== null && typeof value !== "string" && typeof value !== "boolean")
    return refuse("invalid", "A control's value is text, true or false, or null to empty it.");
  const all = found(context);
  const wanted = oneLine(name).trim().toLowerCase();
  // Its id names one control; a tag every control that has it; then a title.
  const targets = [
    all.filter((c) => c.id === name),
    all.filter((c) => same(c.tag, wanted)),
    all.filter((c) => same(c.title, wanted)),
  ].find((group) => group.length);
  if (!targets) {
    const names = all.map((c) => c.name);
    return refuse(
      "unknown-control",
      names.length
        ? `There is no content control ${JSON.stringify(name)}. The controls are: ${names.join(", ")}.`
        : "The document has no content controls.",
    );
  }
  const filled: string[] = [];
  const unfilled: Unfilled[] = [];
  for (const control of targets) {
    // "true" and "false" are a check box's values too; each control reads the value its way.
    const input =
      control.kind === "checkbox" && (value === "true" || value === "false")
        ? value === "true"
        : value;
    const why =
      unfit(control, input) ??
      // The value it has: nothing to record.
      (control.value === input || (control.empty && (input === null || input === ""))
        ? null
        : editor.run(setControlValue(control.id, input))
          ? null
          : refuse("refused", `The control ${JSON.stringify(control.name)} could not be filled.`));
    if (why)
      unfilled.push({ id: control.id, name: control.name, code: why.code, message: why.message });
    else filled.push(control.block);
  }
  const first = unfilled[0];
  if (!filled.length && first) return refuse(first.code, first.message);
  const ids = new Set(targets.map((t) => t.id));
  const result = changed(context, filled);
  if (unfilled.length) result.text += `\nNot filled: ${unfilled.map((u) => u.message).join(" ")}`;
  return {
    ok: true,
    ...result,
    controls: found(context).filter((c) => ids.has(c.id)),
    unfilled,
  };
}

export interface UpdateFieldsOptions {
  /**
   * Values for the document's merge fields (`«Name»` in a read), by field name, capitals not
   * counting: text, numbers, true or false, dates.
   */
  data?: Readonly<Record<string, string | number | boolean | Date | null>>;
  /**
   * Build the tables of contents again from the headings as they are now. Default false: a
   * table of contents is left as it is. Its page numbers need a page layout, which a session
   * has not, so one built here has its entries right and their page numbers empty until Word
   * updates the field.
   */
  contents?: boolean;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** @internal */
export function updateFields(
  context: Context,
  options: UpdateFieldsOptions = {},
): Result<FieldsReport & { text: string }> {
  const given = options?.data;
  if (given !== undefined && (given === null || typeof given !== "object" || Array.isArray(given)))
    return refuse("invalid", "data must be an object: merge field names with their values.");
  for (const [key, value] of Object.entries(given ?? {}))
    if (value !== null && !(value instanceof Date) && typeof value === "object")
      return refuse("invalid", `data.${key} must be text, a number, true or false, or a date.`);
  // A table of contents is not built again unless asked: without pages its entries would
  // come back with their page numbers empty, and a reader would take the document for broken.
  const rebuild = options?.contents === true;
  const inContents = (field: Field | null): boolean =>
    field !== null && (field.name === "TOC" || inContents(field.parent));
  // The tables `contents` would build: not one deleted, nor one inside another.
  const tables = fieldsIn(context.editor.state.doc).filter(
    (f) => f.name === "TOC" && !f.deleted && !inContents(f.parent),
  ).length;
  const before = context.editor.state.doc;
  const rest = updateFieldsOf(context.editor, {
    ...(given ? { data: given } : {}),
    only: (field: Field) => !inContents(field),
  });
  // The tables apart, after the rest: the page numbers of entries about to be replaced are
  // not among those "left as they were".
  const built = rebuild
    ? updateFieldsOf(context.editor, {
        only: (field: Field) => field.name === "TOC",
        continues: context.editor.state.doc !== before,
      })
    : null;
  const report: FieldsReport = built
    ? {
        updated: rest.updated + built.updated,
        unchanged: rest.unchanged + built.unchanged,
        rebuilt: built.rebuilt,
        skipped: [...rest.skipped, ...built.skipped],
      }
    : rest;

  // What was left, said for a model: by reason, the body's only (the session reads no other).
  const body = rest.skipped.filter((s) => s.story === null);
  const pages = body.filter((s) => s.reason === "no-layout").length;
  const noData = new Set(body.filter((s) => s.reason === "no-data").map((s) => s.detail ?? ""));
  // Without data core leaves merge fields alone and does not report them: name them.
  if (!given)
    for (const field of fieldsIn(context.editor.state.doc)) {
      const { name, args } = parseFieldInstruction(field.instruction);
      if (name.toUpperCase() === "MERGEFIELD" && args[0]) noData.add(args[0]);
    }
  noData.delete("");
  const others = body
    .filter((s) => s.reason !== "no-layout" && s.reason !== "no-data")
    .map((s) => `${s.instruction.trim()} (${s.reason}${s.detail ? `: ${s.detail}` : ""})`);
  // Core counts a table built again among the updated.
  const done = report.updated;
  const text = [
    `${count(done, "field")} updated, ${report.unchanged} unchanged.`,
    ...(noData.size ? [`Merge fields without data: ${[...noData].join(", ")}.`] : []),
    ...(pages
      ? [
          `${count(pages, "page number")} not worked out, and left as ${pages === 1 ? "it was" : "they were"}: they need a page layout the session does not have.`,
        ]
      : []),
    ...(tables && !rebuild
      ? [
          `${count(tables, "table of contents", "tables of contents")} left as ${tables === 1 ? "it is" : "they are"}: update ${tables === 1 ? "it" : "them"} in Word, or pass contents: true to build ${tables === 1 ? "its" : "their"} entries again here, with page numbers empty until Word updates them.`,
        ]
      : []),
    ...(report.rebuilt
      ? [
          "A table of contents was built again from the headings its levels cover: its entries are new blocks with new handles, and their page numbers are empty until Word updates the field.",
        ]
      : []),
    ...(others.length ? [`Left as they were: ${others.join("; ")}.`] : []),
    ...(done ? ["Read again to see the text."] : []),
  ].join(" ");
  // One sentence run, on one line: a field's instruction and a merge field's name are the
  // document's, and must not start a line any more than its text may.
  return { ok: true, ...report, text: oneLine(text) };
}
