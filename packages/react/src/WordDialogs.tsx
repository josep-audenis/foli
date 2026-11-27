/**
 * Word's formatting dialogs (Phase 30), opened by the toolbar as its other built-in dialogs: what
 * the selection shows fills them, a value the selection differs in is blank (a checkbox mixed),
 * and OK applies only what was changed, in one transaction (one undo step).
 */

import {
  type Alignment,
  type Command,
  chainCommands,
  type Editor,
  type LineRule,
  type ParagraphFlags,
  paragraphFormatAt,
  setAlign,
  setIndent,
  setLineSpacing,
  setOutlineLevel,
  setParagraphFlags,
  setParagraphSpacing,
} from "@folijs/core";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useT } from "./messages.js";
import { formatLength, type LengthUnit, parseLength } from "./units.js";

/** A checkbox that can show mixed (null): a click turns it on, then off and on again. */
function TriCheck({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === null;
  }, [value]);
  return (
    <div className="foli-setup-field foli-setup-check">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(value === null ? true : event.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/** A labelled field over its control. */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="foli-setup-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/**
 * A dialog's tabs (WAI-ARIA tabs, automatic activation): the tab list and the shown panel; the
 * others stay mounted (hidden), so what was typed there stays.
 */
function Tabs({
  id,
  tabs,
  selected,
  onSelect,
}: {
  id: string;
  tabs: readonly { key: string; label: string; content: ReactNode }[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent) => {
    const at = tabs.findIndex((tab) => tab.key === selected);
    const moves: Record<string, number> = {
      ArrowRight: (at + 1) % tabs.length,
      ArrowLeft: (at - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onSelect((tabs[next] as { key: string }).key);
    buttons.current[next]?.focus();
  };
  return (
    <>
      <div role="tablist" className="foli-dialog-tabs" onKeyDown={onKeyDown}>
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(element) => {
              buttons.current[i] = element;
            }}
            id={`${id}-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={tab.key === selected}
            aria-controls={`${id}-panel-${tab.key}`}
            tabIndex={tab.key === selected ? 0 : -1}
            onClick={() => onSelect(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          id={`${id}-panel-${tab.key}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${tab.key}`}
          className="foli-dialog-panel"
          hidden={tab.key !== selected}
        >
          {tab.content}
        </div>
      ))}
    </>
  );
}

// ---------- Paragraph ----------

const JUSTIFIED: Record<string, Alignment> = {
  left: "start",
  start: "start",
  center: "center",
  right: "end",
  end: "end",
  both: "justify",
  distribute: "justify",
};

type LineChoice = "single" | "onePointFive" | "double" | "atLeast" | "exact" | "multiple";

/** The line spacing choice and its value (a multiple, or points) a paragraph shows. */
function lineChoice(line: number | null, rule: LineRule): [LineChoice, string] {
  if (rule !== "auto") return [rule, formatLength(line ?? 240, "pt")];
  const multiple = Math.round(((line ?? 240) / 240) * 100) / 100;
  if (multiple === 1) return ["single", ""];
  if (multiple === 1.5) return ["onePointFive", ""];
  if (multiple === 2) return ["double", ""];
  return ["multiple", String(multiple)];
}

type ParagraphField = "left" | "right" | "by" | "before" | "after" | "at";

const PARAGRAPH_FLAGS = [
  "widowControl",
  "keepNext",
  "keepLines",
  "pageBreakBefore",
  "contextualSpacing",
] as const;
type Flag = (typeof PARAGRAPH_FLAGS)[number];

/** Twips Word takes for an indent (22 inches) and for space before or after (1584 pt). */
const MAX_LENGTH = 31_680;

/**
 * Word's Paragraph dialog for the selected paragraphs: Indents and Spacing (alignment, outline
 * level, left and right indents, the special first line or hanging indent, space before and
 * after, line spacing, no space between paragraphs of the same style) and Line and Page Breaks
 * (widow control, keep with next, keep lines together, page break before), with a preview.
 */
export function ParagraphDialog({
  editor,
  unit,
  onClose,
}: {
  editor: Editor;
  unit: LengthUnit;
  /** `applied`: the paragraphs changed (the focus may go to the document). */
  onClose: (applied: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const [initial] = useState(() => {
    const format = paragraphFormatAt(editor.state);
    const indent = format?.indent ?? {};
    const spacing = format?.spacing ?? {};
    const special =
      indent.hanging === undefined || indent.firstLine === undefined
        ? ""
        : indent.hanging > 0
          ? "hanging"
          : indent.firstLine > 0
            ? "firstLine"
            : "none";
    const [line, at] =
      spacing.line === undefined || spacing.lineRule === undefined
        ? ["", ""]
        : lineChoice(spacing.line, spacing.lineRule);
    const length = (twips: number | undefined, to: LengthUnit | "pt") =>
      twips === undefined ? "" : formatLength(twips, to);
    return {
      alignment:
        format?.justification === undefined
          ? ""
          : (JUSTIFIED[format.justification ?? "left"] ?? ""),
      outline:
        format?.outlineLevel === undefined
          ? ""
          : format.outlineLevel === null || format.outlineLevel >= 9
            ? "body"
            : String(format.outlineLevel),
      special,
      line,
      fields: {
        left: length(indent.left, unit),
        right: length(indent.right, unit),
        by:
          special === "hanging"
            ? length(indent.hanging, unit)
            : special === "firstLine"
              ? length(indent.firstLine, unit)
              : "",
        before: length(spacing.before, "pt"),
        after: length(spacing.after, "pt"),
        at,
      } satisfies Record<ParagraphField, string>,
      flags: Object.fromEntries(
        PARAGRAPH_FLAGS.map((key) => [key, format?.[key] ?? null]),
      ) as Record<Flag, boolean | null>,
    };
  });
  const [tab, setTab] = useState("indents");
  const [alignment, setAlignment] = useState(initial.alignment);
  const [outline, setOutline] = useState(initial.outline);
  const [special, setSpecial] = useState(initial.special);
  const [line, setLine] = useState(initial.line);
  const [fields, setFields] = useState(initial.fields);
  const [flags, setFlags] = useState(initial.flags);
  const [error, setError] = useState<ParagraphField | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);

  const labels: Record<ParagraphField, string> = {
    left: t("Left"),
    right: t("Right"),
    by: t("By"),
    before: t("Before"),
    after: t("After"),
    at: t("At"),
  };
  const changed = (field: ParagraphField) => fields[field] !== initial.fields[field];
  /** The field's value as twips in its range, `undefined` unchanged; null when it is wrong. */
  const lengthOf = (field: ParagraphField, min: number, max: number, to: LengthUnit | "pt") => {
    const twips = parseLength(fields[field], to);
    return twips !== null && twips >= min && twips <= max ? twips : null;
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const wrong = (field: ParagraphField) => {
      setError(field);
      setTab("indents");
      // The field is in the shown panel once React has rendered it.
      requestAnimationFrame(() => document.getElementById(`${id}-${field}`)?.focus());
    };
    const commands: Command[] = [];
    if (alignment !== initial.alignment && alignment)
      commands.push(setAlign(alignment as Alignment));
    if (outline !== initial.outline && outline)
      commands.push(setOutlineLevel(outline === "body" ? null : Number(outline)));
    // Indents
    const indent: Parameters<typeof setIndent>[0] = {};
    for (const side of ["left", "right"] as const) {
      if (!changed(side)) continue;
      const twips = lengthOf(side, -MAX_LENGTH, MAX_LENGTH, unit);
      if (twips === null) return wrong(side);
      indent[side] = twips / 20;
    }
    if (special !== initial.special || changed("by")) {
      if (special === "none") indent.firstLine = 0;
      else if (special === "firstLine" || special === "hanging") {
        const twips = lengthOf("by", 0, MAX_LENGTH, unit);
        if (twips === null) return wrong("by");
        indent[special] = twips / 20;
      }
    }
    if (Object.keys(indent).length) commands.push(setIndent(indent));
    // Spacing
    const space: { before?: number; after?: number } = {};
    for (const side of ["before", "after"] as const) {
      if (!changed(side)) continue;
      const twips = lengthOf(side, 0, MAX_LENGTH, "pt");
      if (twips === null) return wrong(side);
      space[side] = twips / 20;
    }
    if (Object.keys(space).length) commands.push(setParagraphSpacing(space));
    if (line && (line !== initial.line || changed("at"))) {
      if (line === "single") commands.push(setLineSpacing(1));
      else if (line === "onePointFive") commands.push(setLineSpacing(1.5));
      else if (line === "double") commands.push(setLineSpacing(2));
      else if (line === "multiple") {
        const value = Number(fields.at.trim().replace(",", "."));
        if (!(value >= 0.06 && value <= 132)) return wrong("at");
        commands.push(setLineSpacing(value));
      } else {
        // Word's smallest line: 0.7 pt.
        const twips = lengthOf("at", 14, MAX_LENGTH, "pt");
        if (twips === null) return wrong("at");
        commands.push(setLineSpacing(twips / 20, line as LineRule));
      }
    }
    const set: ParagraphFlags = {};
    for (const key of PARAGRAPH_FLAGS)
      if (flags[key] !== initial.flags[key] && flags[key] !== null) set[key] = flags[key];
    if (Object.keys(set).length) commands.push(setParagraphFlags(set));
    if (!commands.length) return onClose(false);
    if (editor.run(chainCommands(commands))) return onClose(true);
    // Nothing the commands did changed anything (the values were already there).
    onClose(false);
  };

  const input = (name: ParagraphField, disabled = false) => (
    <Field id={`${id}-${name}`} label={labels[name]}>
      <input
        id={`${id}-${name}`}
        type="text"
        inputMode="decimal"
        value={fields[name]}
        disabled={disabled}
        aria-invalid={error === name || undefined}
        aria-describedby={error === name ? `${id}-error` : undefined}
        onChange={(event) => {
          setFields((current) => ({ ...current, [name]: event.target.value }));
          setError(null);
        }}
      />
    </Field>
  );
  const flag = (key: Flag, label: string) => (
    <TriCheck
      id={`${id}-${key}`}
      label={label}
      value={flags[key]}
      onChange={(value) => setFlags((current) => ({ ...current, [key]: value }))}
    />
  );
  // A blank entry while the paragraphs differ, as Word's.
  const blank = (value: string) => (value === "" ? <option value="" /> : null);

  const indents = (
    <>
      <fieldset className="foli-dialog-section">
        <legend>{t("General")}</legend>
        <Field id={`${id}-alignment`} label={t("Alignment")}>
          <select
            ref={first}
            id={`${id}-alignment`}
            value={alignment}
            onChange={(event) => setAlignment(event.target.value)}
          >
            {blank(initial.alignment)}
            <option value="start">{t("Left")}</option>
            <option value="center">{t("Centered")}</option>
            <option value="end">{t("Right")}</option>
            <option value="justify">{t("Justified")}</option>
          </select>
        </Field>
        <Field id={`${id}-outline`} label={t("Outline level")}>
          <select
            id={`${id}-outline`}
            value={outline}
            onChange={(event) => setOutline(event.target.value)}
          >
            {blank(initial.outline)}
            <option value="body">{t("Body Text")}</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((level) => (
              <option key={level} value={String(level)}>
                {t("Level {n}", { n: level + 1 })}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>
      <fieldset className="foli-dialog-section">
        <legend>{t("Indentation")}</legend>
        {input("left")}
        {input("right")}
        <Field id={`${id}-special`} label={t("Special")}>
          <select
            id={`${id}-special`}
            value={special}
            onChange={(event) => {
              const next = event.target.value;
              setSpecial(next);
              // Word fills By with half an inch when a special indent is picked.
              if ((next === "firstLine" || next === "hanging") && !fields.by)
                setFields((current) => ({ ...current, by: formatLength(720, unit) }));
              if (next === "none") setFields((current) => ({ ...current, by: "" }));
            }}
          >
            {blank(initial.special)}
            <option value="none">{t("None")}</option>
            <option value="firstLine">{t("First line")}</option>
            <option value="hanging">{t("Hanging")}</option>
          </select>
        </Field>
        {input("by", special !== "firstLine" && special !== "hanging")}
      </fieldset>
      <fieldset className="foli-dialog-section">
        <legend>{t("Spacing")}</legend>
        {input("before")}
        {input("after")}
        <Field id={`${id}-line`} label={t("Line spacing")}>
          <select
            id={`${id}-line`}
            value={line}
            onChange={(event) => {
              const next = event.target.value;
              setLine(next);
              setFields((current) => ({
                ...current,
                at:
                  next === "multiple"
                    ? "3"
                    : next === "exact" || next === "atLeast"
                      ? formatLength(240, "pt")
                      : "",
              }));
            }}
          >
            {blank(initial.line)}
            <option value="single">{t("Single")}</option>
            <option value="onePointFive">{t("1.5 lines")}</option>
            <option value="double">{t("Double")}</option>
            <option value="atLeast">{t("At least")}</option>
            <option value="exact">{t("Exactly")}</option>
            <option value="multiple">{t("Multiple")}</option>
          </select>
        </Field>
        {input("at", line !== "multiple" && line !== "exact" && line !== "atLeast")}
        {flag("contextualSpacing", t("Don't add space between paragraphs of the same style"))}
      </fieldset>
      <ParagraphPreview
        alignment={alignment || "start"}
        indent={{
          left: parseLength(fields.left, unit) ?? 0,
          right: parseLength(fields.right, unit) ?? 0,
          first:
            special === "firstLine" || special === "hanging"
              ? (parseLength(fields.by, unit) ?? 0) * (special === "hanging" ? -1 : 1)
              : 0,
        }}
        before={parseLength(fields.before, "pt") ?? 0}
        after={parseLength(fields.after, "pt") ?? 0}
        line={
          line === "onePointFive"
            ? 1.5
            : line === "double"
              ? 2
              : line === "multiple"
                ? Number(fields.at) || 1
                : 1
        }
        label={t("Preview")}
        text={t("Sample text")}
      />
    </>
  );
  const breaks = (
    <fieldset className="foli-dialog-section">
      <legend>{t("Pagination")}</legend>
      {flag("widowControl", t("Widow/Orphan control"))}
      {flag("keepNext", t("Keep with next"))}
      {flag("keepLines", t("Keep lines together"))}
      {flag("pageBreakBefore", t("Page break before"))}
    </fieldset>
  );

  return (
    <div
      role="dialog"
      aria-label={t("Paragraph")}
      className="foli-link-dialog foli-word-dialog foli-paragraph-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <Tabs
          id={id}
          selected={tab}
          onSelect={setTab}
          tabs={[
            { key: "indents", label: t("Indents and Spacing"), content: indents },
            { key: "breaks", label: t("Line and Page Breaks"), content: breaks },
          ]}
        />
        <div className="foli-dialog-buttons">
          <button type="submit">{t("OK")}</button>
          <button type="button" onClick={() => onClose(false)}>
            {t("Cancel")}
          </button>
        </div>
        {error && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            {t("Check this value: {field}.", { field: labels[error] })}
          </p>
        )}
      </form>
    </div>
  );
}

/** Twips to the preview's px: its page is about 6.5 inches of text in 260 px. */
const PREVIEW_SCALE = 260 / 9360;

/** Word's preview: grey paragraphs around one drawn with the dialog's values. Not read out. */
function ParagraphPreview({
  alignment,
  indent,
  before,
  after,
  line,
  label,
  text,
}: {
  alignment: string;
  indent: { left: number; right: number; first: number };
  before: number;
  after: number;
  line: number;
  label: string;
  text: string;
}) {
  const px = (twips: number) => `${Math.max(-60, Math.min(200, twips * PREVIEW_SCALE))}px`;
  const align: Record<string, CSSProperties["textAlign"]> = {
    start: "left",
    center: "center",
    end: "right",
    justify: "justify",
  };
  const sample: CSSProperties = {
    textAlign: align[alignment] ?? "left",
    marginLeft: px(indent.left),
    marginRight: px(indent.right),
    textIndent: px(indent.first),
    marginTop: px(Math.min(before, 1440) * 0.25),
    marginBottom: px(Math.min(after, 1440) * 0.25),
    lineHeight: Math.max(0.6, Math.min(line, 4)) * 1.2,
  };
  const words = `${text} `.repeat(6);
  return (
    <div className="foli-dialog-preview" role="img" aria-label={label}>
      <p className="foli-dialog-preview-other">{words.repeat(2)}</p>
      <p className="foli-dialog-preview-sample" style={sample}>
        {words.repeat(4)}
      </p>
      <p className="foli-dialog-preview-other">{words.repeat(2)}</p>
    </div>
  );
}
