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
  fontFamilyAt,
  fontSizeAt,
  type LineRule,
  type ParagraphFlags,
  paragraphFormatAt,
  type RunEffects,
  runFormatAt,
  setAlign,
  setCharacterSpacing,
  setFontFamily,
  setFontSize,
  setIndent,
  setLineSpacing,
  setOutlineLevel,
  setParagraphFlags,
  setParagraphSpacing,
  setRunEffects,
  setTabStops,
  setTextColor,
  setUnderline,
  setVerticalAlign,
  type TabStop,
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
import { type ToolbarMessage, useT } from "./messages.js";
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
 * @internal
 */
export function ParagraphDialog({
  editor,
  unit,
  onClose,
  onTabs,
}: {
  editor: Editor;
  unit: LengthUnit;
  /** `applied`: the paragraphs changed (the focus may go to the document). */
  onClose: (applied: boolean) => void;
  /** Tabs…: what was changed is applied (as OK), then the Tabs dialog takes this one's place. */
  onTabs: () => void;
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

  const apply = (event: { preventDefault(): void }, toTabs = false) => {
    event.preventDefault();
    const done = (applied: boolean) => (toTabs ? onTabs() : onClose(applied));
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
    if (!commands.length) return done(false);
    // False: nothing the commands did changed anything (the values were already there).
    done(editor.run(chainCommands(commands)));
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
          <button
            type="button"
            className="foli-dialog-start"
            onClick={(event) => apply(event, true)}
          >
            {t("Tabs…")}
          </button>
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

// ---------- Font ----------

/** Word's underline styles in its Font dialog, with Word's names. */
const UNDERLINE_NAMES: readonly (readonly [string, ToolbarMessage])[] = [
  ["single", "Single"],
  ["words", "Words only"],
  ["double", "Double"],
  ["thick", "Thick"],
  ["dotted", "Dotted"],
  ["dash", "Dashed"],
  ["dotDash", "Dot-dash"],
  ["dotDotDash", "Dot-dot-dash"],
  ["wave", "Wave"],
];

const FONT_EFFECTS = [
  "strike",
  "doubleStrike",
  "superscript",
  "subscript",
  "smallCaps",
  "caps",
  "hidden",
] as const;
type Effect = (typeof FONT_EFFECTS)[number];
/** Effects that cannot both be on: checking one clears the other. */
const PAIRED: Partial<Record<Effect, Effect>> = {
  strike: "doubleStrike",
  doubleStrike: "strike",
  superscript: "subscript",
  subscript: "superscript",
  smallCaps: "caps",
  caps: "smallCaps",
};

/** A color's value in a box: `#rrggbb`, "auto" for Word's Automatic, "" when mixed. */
const colorValue = (rrggbb: string | null | undefined) =>
  rrggbb === undefined
    ? ""
    : rrggbb === null || rrggbb.toLowerCase() === "auto"
      ? "auto"
      : `#${rrggbb.toLowerCase()}`;

type FontField = "font" | "size" | "by";

/**
 * Word's Font dialog for the selected text (or the text typed next): Font (font, style, size,
 * color, underline style and color, effects) and Advanced (character spacing), with a preview.
 * `fonts`, `sizes` and `colors` are the toolbar's Font and Size boxes' and color menu's.
 * @internal
 */
export function FontDialog({
  editor,
  fonts,
  sizes,
  colors,
  onClose,
}: {
  editor: Editor;
  fonts: readonly string[];
  sizes: readonly number[];
  colors: readonly { name: ToolbarMessage; color: string }[];
  /** `applied`: the text changed (the focus may go to the document). */
  onClose: (applied: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const [initial] = useState(() => {
    const { state } = editor;
    const run = runFormatAt(state) ?? {};
    const size = fontSizeAt(state);
    const vertical = run.verticalAlign;
    const spacing = run.characterSpacing;
    const { from, to } = state.selection;
    return {
      font: fontFamilyAt(state) ?? "",
      style:
        run.bold === undefined || run.italic === undefined
          ? ""
          : run.bold
            ? run.italic
              ? "boldItalic"
              : "bold"
            : run.italic
              ? "italic"
              : "regular",
      size: size === null ? "" : String(size),
      color: colorValue(run.color),
      underline: run.underline === undefined ? "" : (run.underline ?? "none"),
      underlineColor: colorValue(run.underlineColor),
      effects: {
        strike: run.strike ?? null,
        doubleStrike: run.doubleStrike ?? null,
        superscript: vertical === undefined ? null : vertical === "superscript",
        subscript: vertical === undefined ? null : vertical === "subscript",
        smallCaps: run.smallCaps ?? null,
        caps: run.caps ?? null,
        hidden: run.hidden ?? null,
      } as Record<Effect, boolean | null>,
      spacing:
        spacing === undefined
          ? ""
          : spacing > 0
            ? "expanded"
            : spacing < 0
              ? "condensed"
              : "normal",
      by: spacing ? formatLength(Math.abs(spacing), "pt") : "",
      sample: state.doc
        .textBetween(from, Math.min(to, from + 200), " ")
        .trim()
        .slice(0, 40),
    };
  });
  const [tab, setTab] = useState("font");
  const [font, setFont] = useState(initial.font);
  const [style, setStyle] = useState(initial.style);
  const [size, setSize] = useState(initial.size);
  const [color, setColor] = useState(initial.color);
  const [underline, setUnderlineStyle] = useState(initial.underline);
  const [underlineColor, setUnderlineColor] = useState(initial.underlineColor);
  const [effects, setEffects] = useState(initial.effects);
  const [spacing, setSpacing] = useState(initial.spacing);
  const [by, setBy] = useState(initial.by);
  const [error, setError] = useState<FontField | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const labels: Record<FontField, string> = { font: t("Font"), size: t("Size"), by: t("By") };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const wrong = (field: FontField) => {
      setError(field);
      setTab(field === "by" ? "advanced" : "font");
      requestAnimationFrame(() => document.getElementById(`${id}-${field}`)?.focus());
    };
    const commands: Command[] = [];
    if (font !== initial.font) {
      if (!font.trim()) return wrong("font");
      commands.push(setFontFamily(font));
    }
    if (style !== initial.style && style)
      commands.push(
        setRunEffects({
          bold: style === "bold" || style === "boldItalic",
          italic: style === "italic" || style === "boldItalic",
        }),
      );
    if (size !== initial.size) {
      const points = Number(size.trim().replace(",", "."));
      if (!(points >= 1 && points <= 1638)) return wrong("size");
      commands.push(setFontSize(Math.round(points * 2) / 2));
    }
    if (color !== initial.color && color)
      commands.push(setTextColor(color === "auto" ? null : color));
    if (
      underline &&
      (underline !== initial.underline || underlineColor !== initial.underlineColor)
    ) {
      if (underline === "none") commands.push(setUnderline(null));
      else {
        const changed = underlineColor !== initial.underlineColor && underlineColor !== "";
        const value = underlineColor === "auto" ? null : underlineColor;
        commands.push(setUnderline(underline, changed ? value : undefined));
      }
    }
    const set: RunEffects = {};
    for (const key of ["strike", "doubleStrike", "smallCaps", "caps", "hidden"] as const) {
      const value = effects[key];
      if (value !== initial.effects[key] && value !== null) set[key] = value;
    }
    if (Object.keys(set).length) commands.push(setRunEffects(set));
    const { superscript, subscript } = effects;
    if (superscript !== initial.effects.superscript || subscript !== initial.effects.subscript) {
      if (superscript) commands.push(setVerticalAlign("superscript"));
      else if (subscript) commands.push(setVerticalAlign("subscript"));
      else if (superscript === false && subscript === false)
        commands.push(setVerticalAlign("baseline"));
    }
    if (spacing && (spacing !== initial.spacing || by !== initial.by)) {
      if (spacing === "normal") commands.push(setCharacterSpacing(0));
      else {
        const twips = parseLength(by, "pt");
        if (twips === null || twips <= 0 || twips > 31_680) return wrong("by");
        commands.push(setCharacterSpacing(((spacing === "condensed" ? -1 : 1) * twips) / 20));
      }
    }
    if (!commands.length) return onClose(false);
    onClose(editor.run(chainCommands(commands)));
  };

  const colorOptions = (current: string, initialValue: string) => {
    const others = [current, initialValue].filter(
      (v, i, all) =>
        v.startsWith("#") && all.indexOf(v) === i && !colors.some((c) => c.color === v),
    );
    return (
      <>
        {initialValue === "" && <option value="" />}
        <option value="auto">{t("Automatic")}</option>
        {colors.map((c) => (
          <option key={c.color} value={c.color}>
            {t(c.name)}
          </option>
        ))}
        {others.map((v) => (
          <option key={v} value={v}>
            {t("Other color {color}", { color: v })}
          </option>
        ))}
      </>
    );
  };
  const effect = (key: Effect, label: string) => (
    <TriCheck
      id={`${id}-${key}`}
      label={label}
      value={effects[key]}
      onChange={(value) =>
        setEffects((current) => {
          const next = { ...current, [key]: value };
          const other = PAIRED[key];
          if (value && other) next[other] = false;
          return next;
        })
      }
    />
  );
  const marked = (field: FontField) => ({
    "aria-invalid": error === field || undefined,
    "aria-describedby": error === field ? `${id}-error` : undefined,
  });
  const typed = (field: FontField, set: (value: string) => void) => ({
    ...marked(field),
    onChange: (event: { target: { value: string } }) => {
      set(event.target.value);
      setError(null);
    },
  });

  const fontTab = (
    <>
      <fieldset className="foli-dialog-section">
        <legend>{t("Font")}</legend>
        <Field id={`${id}-font`} label={t("Font")}>
          <input
            ref={first}
            id={`${id}-font`}
            type="text"
            list={`${id}-fonts`}
            value={font}
            {...typed("font", setFont)}
          />
          <datalist id={`${id}-fonts`}>
            {fonts.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field id={`${id}-style`} label={t("Font style")}>
          <select id={`${id}-style`} value={style} onChange={(e) => setStyle(e.target.value)}>
            {initial.style === "" && <option value="" />}
            <option value="regular">{t("Regular")}</option>
            <option value="italic">{t("Italic")}</option>
            <option value="bold">{t("Bold")}</option>
            <option value="boldItalic">{t("Bold Italic")}</option>
          </select>
        </Field>
        <Field id={`${id}-size`} label={t("Size")}>
          <input
            id={`${id}-size`}
            type="text"
            inputMode="decimal"
            list={`${id}-sizes`}
            value={size}
            {...typed("size", setSize)}
          />
          <datalist id={`${id}-sizes`}>
            {sizes.map((n) => (
              <option key={n} value={String(n)} />
            ))}
          </datalist>
        </Field>
        <Field id={`${id}-color`} label={t("Font color")}>
          <select id={`${id}-color`} value={color} onChange={(e) => setColor(e.target.value)}>
            {colorOptions(color, initial.color)}
          </select>
        </Field>
        <Field id={`${id}-underline`} label={t("Underline style")}>
          <select
            id={`${id}-underline`}
            value={underline}
            onChange={(e) => setUnderlineStyle(e.target.value)}
          >
            {initial.underline === "" && <option value="" />}
            <option value="none">{t("None")}</option>
            {UNDERLINE_NAMES.map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
            {/* A style Word has that the list does not name (dashLong, wavyDouble…). */}
            {initial.underline &&
              initial.underline !== "none" &&
              !UNDERLINE_NAMES.some(([value]) => value === initial.underline) && (
                <option value={initial.underline}>{initial.underline}</option>
              )}
          </select>
        </Field>
        <Field id={`${id}-underlineColor`} label={t("Underline color")}>
          <select
            id={`${id}-underlineColor`}
            value={underlineColor}
            disabled={underline === "none" || underline === ""}
            onChange={(e) => setUnderlineColor(e.target.value)}
          >
            {colorOptions(underlineColor, initial.underlineColor)}
          </select>
        </Field>
      </fieldset>
      <fieldset className="foli-dialog-section">
        <legend>{t("Effects")}</legend>
        {effect("strike", t("Strikethrough"))}
        {effect("doubleStrike", t("Double strikethrough"))}
        {effect("superscript", t("Superscript"))}
        {effect("subscript", t("Subscript"))}
        {effect("smallCaps", t("Small caps"))}
        {effect("caps", t("All caps"))}
        {effect("hidden", t("Hidden"))}
      </fieldset>
    </>
  );
  const advanced = (
    <fieldset className="foli-dialog-section">
      <legend>{t("Character Spacing")}</legend>
      <Field id={`${id}-spacing`} label={t("Spacing")}>
        <select
          id={`${id}-spacing`}
          value={spacing}
          onChange={(event) => {
            const next = event.target.value;
            setSpacing(next);
            setBy(next === "normal" ? "" : by || formatLength(20, "pt"));
            setError(null);
          }}
        >
          {initial.spacing === "" && <option value="" />}
          <option value="normal">{t("Normal")}</option>
          <option value="expanded">{t("Expanded")}</option>
          <option value="condensed">{t("Condensed")}</option>
        </select>
      </Field>
      <Field id={`${id}-by`} label={t("By")}>
        <input
          id={`${id}-by`}
          type="text"
          inputMode="decimal"
          value={by}
          disabled={spacing !== "expanded" && spacing !== "condensed"}
          {...typed("by", setBy)}
        />
      </Field>
    </fieldset>
  );
  const spaced = spacing === "expanded" || spacing === "condensed";
  const decorations = [
    underline && underline !== "none" ? "underline" : "",
    effects.strike || effects.doubleStrike ? "line-through" : "",
  ].filter(Boolean);
  const preview: CSSProperties = {
    fontFamily: font || undefined,
    fontSize: `${Math.max(6, Math.min(Number(size) || 11, 36))}pt`,
    fontWeight: style === "bold" || style === "boldItalic" ? "bold" : undefined,
    fontStyle: style === "italic" || style === "boldItalic" ? "italic" : undefined,
    color: color.startsWith("#") ? color : undefined,
    textDecorationLine: decorations.join(" ") || undefined,
    textDecorationStyle:
      underline === "double" || effects.doubleStrike
        ? "double"
        : underline === "wave"
          ? "wavy"
          : underline === "dotted"
            ? "dotted"
            : underline.startsWith("dash") || underline.startsWith("dot")
              ? "dashed"
              : undefined,
    textDecorationColor: underlineColor.startsWith("#") ? underlineColor : undefined,
    textTransform: effects.caps ? "uppercase" : undefined,
    fontVariant: effects.smallCaps ? "small-caps" : undefined,
    letterSpacing: spaced
      ? `${((spacing === "condensed" ? -1 : 1) * (parseLength(by, "pt") ?? 0)) / 20}pt`
      : undefined,
    verticalAlign: effects.superscript ? "super" : effects.subscript ? "sub" : undefined,
    opacity: effects.hidden ? 0.5 : undefined,
  };

  return (
    <div
      role="dialog"
      aria-label={t("Font")}
      className="foli-link-dialog foli-word-dialog foli-font-dialog"
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
            { key: "font", label: t("Font"), content: fontTab },
            { key: "advanced", label: t("Advanced"), content: advanced },
          ]}
        />
        <div className="foli-dialog-preview foli-font-preview" role="img" aria-label={t("Preview")}>
          <span style={preview}>{initial.sample || font || t("Sample text")}</span>
        </div>
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

// ---------- Tabs ----------

const TAB_ALIGNMENT_NAMES: readonly (readonly [TabStop["alignment"], ToolbarMessage])[] = [
  ["left", "Left"],
  ["center", "Center"],
  ["right", "Right"],
  ["decimal", "Decimal"],
  ["bar", "Bar"],
];
const TAB_LEADER_NAMES: readonly (readonly [NonNullable<TabStop["leader"]>, ToolbarMessage])[] = [
  ["none", "None"],
  ["dot", "Dots"],
  ["hyphen", "Dashes"],
  ["underscore", "Underline"],
];

/** A stop in the dialog, its position in twips. */
type Stop = {
  position: number;
  alignment: TabStop["alignment"];
  leader: NonNullable<TabStop["leader"]>;
};

/**
 * Word's Tabs dialog for the selected paragraphs: their stops (those all of them share), a
 * position, alignment and leader to Set, Clear the stop picked, Clear All. OK applies what was
 * set and cleared to each paragraph, in one undo step.
 * @internal
 */
export function TabsDialog({
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
  const [stops, setStops] = useState<Stop[]>(() =>
    (paragraphFormatAt(editor.state)?.tabs ?? [])
      .filter((s) => s.kind !== "clear" && s.kind !== "num")
      .map((s) => ({
        position: s.position,
        alignment: (s.kind === "start"
          ? "left"
          : s.kind === "end"
            ? "right"
            : s.kind) as Stop["alignment"],
        leader: (s.leader ?? "none") as Stop["leader"],
      })),
  );
  const [set, setSet] = useState<Stop[]>([]);
  const [cleared, setCleared] = useState<number[]>([]);
  const [clearAll, setClearAll] = useState(false);
  const [position, setPosition] = useState("");
  // The stop picked from the list, exactly: its position shown in the unit may be rounded.
  const [pickedAt, setPickedAt] = useState<number | null>(null);
  const at = pickedAt ?? parseLength(position, unit);
  const [alignment, setAlignment] = useState<Stop["alignment"]>("left");
  const [leader, setLeader] = useState<Stop["leader"]>("none");
  const [error, setError] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  /** The stop the fields describe, or null (the position is marked) when it is not one. */
  const typed = (): Stop | null => {
    const twips = at;
    if (twips === null || twips < -31_680 || twips > 31_680) {
      setError(true);
      first.current?.focus();
      return null;
    }
    return { position: twips, alignment, leader };
  };
  const add = (stop: Stop) => {
    const others = (list: Stop[]) => list.filter((s) => s.position !== stop.position);
    setStops((list) => [...others(list), stop].sort((a, b) => a.position - b.position));
    setSet((list) => [...others(list), stop]);
    setCleared((list) => list.filter((p) => p !== stop.position));
  };
  const onSet = () => {
    const stop = typed();
    if (stop) add(stop);
  };
  const onClear = () => {
    const twips = at;
    if (twips === null || !stops.some((s) => s.position === twips)) return;
    setStops((list) => list.filter((s) => s.position !== twips));
    setSet((list) => list.filter((s) => s.position !== twips));
    setCleared((list) => [...list, twips]);
    setPosition("");
    setPickedAt(null);
  };
  const onClearAll = () => {
    setStops([]);
    setSet([]);
    setCleared([]);
    setClearAll(true);
    setPosition("");
    setPickedAt(null);
  };
  const pick = (twips: number) => {
    const stop = stops.find((s) => s.position === twips);
    if (!stop) return;
    setPosition(formatLength(stop.position, unit));
    setPickedAt(stop.position);
    setAlignment(stop.alignment);
    setLeader(stop.leader);
    setError(false);
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    let toSet = set;
    // A position typed (or picked and changed) but not Set is set by OK, as in Word.
    if (position.trim()) {
      const stop = typed();
      if (!stop) return;
      const listed = stops.find((s) => s.position === stop.position);
      if (!listed || listed.alignment !== stop.alignment || listed.leader !== stop.leader)
        toSet = [...set.filter((s) => s.position !== stop.position), stop];
    }
    if (!toSet.length && !cleared.length && !clearAll) return onClose(false);
    const pt = (twips: number) => twips / 20;
    const command = setTabStops({
      set: toSet.map((s) => ({
        position: pt(s.position),
        alignment: s.alignment,
        leader: s.leader,
      })),
      clear: clearAll ? "all" : cleared.map(pt),
    });
    onClose(editor.run(command));
  };

  const picked = at;
  const radios = <T extends string>(
    name: string,
    legend: string,
    options: readonly (readonly [T, ToolbarMessage])[],
    value: T | undefined,
    onChange: (value: T) => void,
  ) => (
    <fieldset className="foli-dialog-section">
      <legend>{legend}</legend>
      {options.map(([key, label]) => (
        <div key={key} className="foli-setup-field foli-setup-check">
          <input
            id={`${id}-${name}-${key}`}
            type="radio"
            name={`${id}-${name}`}
            checked={value === key}
            onChange={() => onChange(key)}
          />
          <label htmlFor={`${id}-${name}-${key}`}>{t(label)}</label>
        </div>
      ))}
    </fieldset>
  );

  return (
    <div
      role="dialog"
      aria-label={t("Tabs")}
      className="foli-link-dialog foli-word-dialog foli-tabs-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <div className="foli-dialog-panel">
          <fieldset className="foli-dialog-section">
            <legend>{t("Tab stops")}</legend>
            <Field id={`${id}-position`} label={t("Tab stop position")}>
              <input
                ref={first}
                id={`${id}-position`}
                type="text"
                inputMode="decimal"
                value={position}
                aria-invalid={error || undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => {
                  setPosition(event.target.value);
                  setPickedAt(null);
                  setError(false);
                }}
              />
            </Field>
            <Field id={`${id}-stops`} label={t("Stops")}>
              <select
                id={`${id}-stops`}
                size={5}
                value={
                  picked !== null && stops.some((s) => s.position === picked) ? String(picked) : ""
                }
                onChange={(event) => pick(Number(event.target.value))}
              >
                {stops.map((s) => (
                  <option key={s.position} value={String(s.position)}>
                    {formatLength(s.position, unit)}
                  </option>
                ))}
              </select>
            </Field>
            <p className="foli-dialog-note">
              {clearAll
                ? t("Tab stops to be cleared: all")
                : cleared.length
                  ? t("Tab stops to be cleared: {stops}", {
                      stops: cleared.map((p) => formatLength(p, unit)).join(", "),
                    })
                  : ""}
            </p>
          </fieldset>
          {radios("alignment", t("Alignment"), TAB_ALIGNMENT_NAMES, alignment, setAlignment)}
          {radios("leader", t("Leader"), TAB_LEADER_NAMES, leader, setLeader)}
        </div>
        <div className="foli-dialog-buttons">
          <button type="button" onClick={onSet}>
            {t("Set")}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={!stops.some((s) => s.position === picked)}
          >
            {t("Clear")}
          </button>
          <button type="button" onClick={onClearAll} disabled={!stops.length}>
            {t("Clear All")}
          </button>
          <button type="submit">{t("OK")}</button>
          <button type="button" onClick={() => onClose(false)}>
            {t("Cancel")}
          </button>
        </div>
        {error && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            {t("Check this value: {field}.", { field: t("Tab stop position") })}
          </p>
        )}
      </form>
    </div>
  );
}
