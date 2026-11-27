/**
 * Word's Design tab dialogs (Phase 32), opened by the toolbar as its other built-in dialogs:
 * filled from the caret's section, applied in one transaction (one undo step).
 */

import {
  type Command,
  chainCommands,
  type Editor,
  type EditorState,
  paragraphBordersAt,
  sectionAt,
  setPageBorders,
  setParagraphBorders,
  setParagraphShading,
  setWatermark,
  type WatermarkJSON,
  watermarkOf,
} from "@folijs/core";
import { measureImageFile } from "@folijs/view";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type ToolbarMessage, useT } from "./messages.js";

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="foli-setup-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/** Word's line styles for borders, as its dialogs list them. */
const BORDER_STYLE_NAMES = [
  ["single", "Single line"],
  ["dotted", "Dotted"],
  ["dashed", "Dashed"],
  ["dashSmallGap", "Dashed, small gaps"],
  ["dotDash", "Dot dash"],
  ["double", "Double line"],
  ["triple", "Triple line"],
  ["thick", "Thick line"],
  ["wave", "Wave"],
] as const satisfies readonly (readonly [string, ToolbarMessage])[];
/** Word's border widths, in eighths of a point. */
const BORDER_WIDTHS = [2, 4, 6, 8, 12, 18, 24, 36, 48] as const;
const SIDES = ["top", "bottom", "left", "right"] as const;
type Side = (typeof SIDES)[number];
const SIDE_NAMES: Record<Side, ToolbarMessage> = Object.fromEntries([
  ["top", "Top border"],
  ["bottom", "Bottom border"],
  ["left", "Left border"],
  ["right", "Right border"],
] as const) as Record<Side, ToolbarMessage>;
const SETTING_NAMES = [
  ["none", "None"],
  ["box", "Box"],
  ["custom", "Custom"],
] as const satisfies readonly (readonly [string, ToolbarMessage])[];
const APPLY_NAMES = [
  ["document", "Whole document"],
  ["section", "This section"],
  ["firstPage", "This section - First page only"],
  ["notFirstPage", "This section - All except first page"],
] as const satisfies readonly (readonly [string, ToolbarMessage])[];
type ApplyTo = (typeof APPLY_NAMES)[number][0];
type Setting = "none" | "box" | "custom";

const isLine = (style: string | undefined) => !!style && style !== "none" && style !== "nil";

/**
 * Word's Page Borders dialog for the caret's section: Setting (None, Box, Custom), the line's
 * style, color and width, which sides, what it applies to, and where it is measured from. OK
 * sets them in one undo step (`setPageBorders`).
 * shortcut: Word's Shadow and 3-D settings, art borders and the preview are not offered; the
 * sides are check boxes, and one distance applies to every side.
 * @internal
 */
export function PageBordersDialog({
  editor,
  colors,
  onClose,
}: {
  editor: Editor;
  colors: readonly { name: ToolbarMessage; color: string }[];
  /** `applied`: the document changed. */
  onClose: (applied: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const [initial] = useState(() => {
    const borders = sectionAt(editor.state)?.setup.pageBorders;
    const present = SIDES.filter((side) => isLine(borders?.[side]?.style));
    const line = present[0] ? borders?.[present[0]] : undefined;
    const same = present.every((side) => {
      const b = borders?.[side];
      return b?.style === line?.style && b?.size === line?.size && b?.color === line?.color;
    });
    const setting: Setting = !present.length
      ? "none"
      : present.length === 4 && same
        ? "box"
        : "custom";
    const display = borders?.display;
    return {
      borders,
      setting,
      style: line?.style ?? "single",
      color: line?.color && line.color !== "auto" ? `#${line.color.toLowerCase()}` : "auto",
      width: line?.size ?? 4,
      sides: Object.fromEntries(
        SIDES.map((side) => [side, !present.length || present.includes(side)]),
      ) as Record<Side, boolean>,
      applyTo: (display === "firstPage" || display === "notFirstPage"
        ? display
        : "document") as ApplyTo,
      from: !borders || borders.offsetFrom === "page" ? "page" : "text",
      distance: String(line?.space ?? 24),
    };
  });
  const [setting, setSetting] = useState<Setting>(initial.setting);
  const [style, setStyle] = useState<string>(initial.style);
  const [color, setColor] = useState(initial.color);
  const [width, setWidth] = useState<number>(initial.width);
  const [sides, setSides] = useState(initial.sides);
  const [applyTo, setApplyTo] = useState<ApplyTo>(initial.applyTo);
  const [from, setFrom] = useState(initial.from);
  const [distance, setDistance] = useState(initial.distance);
  const [error, setError] = useState(false);
  // Whether the line (style, color, width, distance) was changed: untouched, each side keeps its own.
  const [lineChanged, setLineChanged] = useState(false);
  const [touched, setTouched] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const distanceBox = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    // OK with nothing changed changes nothing (no tracked change either).
    if (!touched) return onClose(false);
    const space = Number(distance.trim());
    if (setting !== "none" && (!/^\d+$/.test(distance.trim()) || space > 31)) {
      setError(true);
      distanceBox.current?.focus();
      return;
    }
    const shown = setting === "box" ? SIDES : SIDES.filter((side) => sides[side]);
    const line = {
      style,
      size: width,
      space,
      color: color === "auto" ? "auto" : color.slice(1).toUpperCase(),
    };
    const before = initial.borders;
    const borders =
      setting === "none" || !shown.length
        ? null
        : {
            ...(from === "page" ? { offsetFrom: "page" as const } : {}),
            ...(applyTo === "firstPage" || applyTo === "notFirstPage" ? { display: applyTo } : {}),
            // What the dialog does not show stays.
            ...(before?.zOrder ? { zOrder: before.zOrder } : {}),
            ...Object.fromEntries(
              shown.map((side) => {
                const own = before?.[side];
                return [side, !lineChanged && own && isLine(own.style) ? own : line];
              }),
            ),
          };
    const scope = applyTo === "document" ? "document" : "section";
    onClose(editor.run(setPageBorders(borders, scope)));
  };

  const settingRadio = (value: Setting, label: ToolbarMessage) => (
    <div key={value} className="foli-setup-field foli-setup-check">
      <input
        ref={value === initial.setting ? first : undefined}
        id={`${id}-setting-${value}`}
        type="radio"
        name={`${id}-setting`}
        checked={setting === value}
        onChange={() => setSetting(value)}
      />
      <label htmlFor={`${id}-setting-${value}`}>{t(label)}</label>
    </div>
  );
  const off = setting === "none";
  return (
    <div
      role="dialog"
      aria-label={t("Page Borders")}
      className="foli-link-dialog foli-word-dialog foli-page-borders-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} onChange={() => setTouched(true)} noValidate>
        <div className="foli-dialog-panel">
          <fieldset className="foli-dialog-section">
            <legend>{t("Setting")}</legend>
            {SETTING_NAMES.map(([value, label]) => settingRadio(value, label))}
          </fieldset>
          <fieldset className="foli-dialog-section" disabled={off}>
            <legend>{t("Line")}</legend>
            <Field id={`${id}-style`} label={t("Style")}>
              <select
                id={`${id}-style`}
                value={style}
                onChange={(e) => {
                  setStyle(e.target.value);
                  setLineChanged(true);
                }}
              >
                {!BORDER_STYLE_NAMES.some(([value]) => value === style) && (
                  <option value={style}>{style}</option>
                )}
                {BORDER_STYLE_NAMES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-color`} label={t("Color")}>
              <select
                id={`${id}-color`}
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  setLineChanged(true);
                }}
              >
                <option value="auto">{t("Automatic")}</option>
                {colors.map((c) => (
                  <option key={c.name} value={c.color}>
                    {t(c.name)}
                  </option>
                ))}
                {color !== "auto" && !colors.some((c) => c.color === color) && (
                  <option value={color}>{t("Other color {color}", { color })}</option>
                )}
              </select>
            </Field>
            <Field id={`${id}-width`} label={t("Width")}>
              <select
                id={`${id}-width`}
                value={String(width)}
                onChange={(e) => {
                  setWidth(Number(e.target.value));
                  setLineChanged(true);
                }}
              >
                {!(BORDER_WIDTHS as readonly number[]).includes(width) && (
                  <option value={String(width)}>{`${width / 8} pt`}</option>
                )}
                {BORDER_WIDTHS.map((w) => (
                  <option key={w} value={String(w)}>
                    {`${w / 8} pt`}
                  </option>
                ))}
              </select>
            </Field>
          </fieldset>
          <fieldset className="foli-dialog-section" disabled={off}>
            <legend>{t("Sides")}</legend>
            {SIDES.map((side) => (
              <div key={side} className="foli-setup-field foli-setup-check">
                <input
                  id={`${id}-side-${side}`}
                  type="checkbox"
                  checked={setting === "box" || sides[side]}
                  onChange={(e) => {
                    // A side turned off or on is Word's Custom.
                    const all = setting === "box";
                    setSides((now) => ({
                      top: all || now.top,
                      bottom: all || now.bottom,
                      left: all || now.left,
                      right: all || now.right,
                      [side]: e.target.checked,
                    }));
                    setSetting("custom");
                  }}
                />
                <label htmlFor={`${id}-side-${side}`}>{t(SIDE_NAMES[side])}</label>
              </div>
            ))}
          </fieldset>
          <fieldset className="foli-dialog-section">
            <legend>{t("Options")}</legend>
            <Field id={`${id}-apply`} label={t("Apply to")}>
              <select
                id={`${id}-apply`}
                value={applyTo}
                onChange={(e) => setApplyTo(e.target.value as ApplyTo)}
              >
                {APPLY_NAMES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-from`} label={t("Measure from")}>
              <select
                id={`${id}-from`}
                disabled={off}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              >
                <option value="page">{t("Edge of page")}</option>
                <option value="text">{t("Text")}</option>
              </select>
            </Field>
            <Field id={`${id}-distance`} label={t("Distance (pt)")}>
              <input
                ref={distanceBox}
                id={`${id}-distance`}
                disabled={off}
                type="text"
                inputMode="numeric"
                value={distance}
                aria-invalid={error || undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e) => {
                  setDistance(e.target.value);
                  setLineChanged(true);
                  setError(false);
                }}
              />
            </Field>
          </fieldset>
        </div>
        <div className="foli-dialog-buttons">
          <button type="submit">{t("OK")}</button>
          <button type="button" onClick={() => onClose(false)}>
            {t("Cancel")}
          </button>
        </div>
        {error && (
          <p id={`${id}-error`} className="foli-link-error" role="alert">
            {t("Check this value: {field}.", { field: t("Distance (pt)") })}
          </p>
        )}
      </form>
    </div>
  );
}

// ---------- Design ▸ Watermark (32.3) ----------

/** The caret's section's text width, in twips. */
function textWidthOf(state: EditorState): number {
  const setup = sectionAt(state)?.setup ?? {};
  const m = setup.margins ?? {};
  return (setup.pageSize?.width ?? 12_240) - (m.left ?? 1440) - (m.right ?? 1440) - (m.gutter ?? 0);
}

/**
 * What Word's text watermark dialog sets.
 * @internal
 */
export interface TextWatermarkOptions {
  text: string;
  font?: string | undefined;
  /** In points; undefined: Auto (as wide as the text area allows). */
  size?: number | undefined;
  /** RRGGBB; Word's default is its light gray. */
  color?: string | undefined;
  semitransparent?: boolean | undefined;
  layout?: "diagonal" | "horizontal" | undefined;
}

/**
 * A text watermark sized as Word sizes it for the caret's section: its box a third as tall as
 * it is wide per letter (Word's WordArt in Calibri capitals); Auto as wide as the text area, or
 * on the diagonal as wide as fits it turned.
 * @internal
 */
export function textWatermark(state: EditorState, options: TextWatermarkOptions): WatermarkJSON {
  const letters = Math.max([...options.text].length, 1);
  const diagonal = options.layout !== "horizontal";
  const area = textWidthOf(state);
  let width: number;
  let height: number;
  if (options.size) {
    height = Math.round(options.size * 20);
    width = Math.round((letters * height) / 3);
  } else {
    width = Math.round(diagonal ? (area * Math.SQRT2) / (1 + 3 / letters) : area);
    height = Math.round((3 * width) / letters);
  }
  return {
    kind: "text",
    text: options.text,
    font: options.font || "Calibri",
    color: options.color ?? "C0C0C0",
    ...(options.semitransparent === false ? {} : { semitransparent: true }),
    ...(diagonal ? { rotation: 315 } : {}),
    width: Math.max(1, Math.min(width, 31_680)),
    height: Math.max(1, Math.min(height, 31_680)),
  };
}

const WATERMARK_TEXTS = [
  "ASAP",
  "CONFIDENTIAL",
  "DO NOT COPY",
  "DRAFT",
  "ORIGINAL",
  "PERSONAL",
  "SAMPLE",
  "TOP SECRET",
  "URGENT",
];
const WATERMARK_SIZES = [36, 40, 44, 48, 54, 60, 66, 72, 80, 90, 96, 105, 120, 144];
const SCALES = [50, 100, 150, 200, 500];
const KIND_NAMES = [
  ["none", "No watermark"],
  ["picture", "Picture watermark"],
  ["text", "Text watermark"],
] as const satisfies readonly (readonly [string, ToolbarMessage])[];
const LAYOUT_NAMES = [
  ["diagonal", "Diagonal"],
  ["horizontal", "Horizontal"],
] as const satisfies readonly (readonly [string, ToolbarMessage])[];

/**
 * Word's Printed Watermark dialog: none, a picture (its scale, washed out or not; with the
 * toolbar's `upload`) or a text (text, font, size, color, semitransparent, diagonal or
 * horizontal), for every header of the document (`setWatermark`), in one undo step.
 * @internal
 */
export function WatermarkDialog({
  editor,
  fonts,
  colors,
  upload,
  onClose,
}: {
  editor: Editor;
  fonts: readonly string[];
  colors: readonly { name: ToolbarMessage; color: string }[];
  upload: ((file: File) => Promise<string | { src: string }>) | undefined;
  onClose: (applied: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const [initial] = useState(() => watermarkOf(editor.state));
  // Word's opens on what the document has: none, a picture or a text.
  const [kind, setKind] = useState<"none" | "picture" | "text">(initial?.kind ?? "none");
  // The text's box stays as it is unless its text, size or layout change.
  const [boxChanged, setBoxChanged] = useState(false);
  const [text, setText] = useState(
    initial?.kind === "text" ? (initial.text ?? "") : "CONFIDENTIAL",
  );
  const [font, setFont] = useState(initial?.font ?? "Calibri");
  const [size, setSize] = useState("auto");
  const [color, setColor] = useState(`#${(initial?.color ?? "C0C0C0").toLowerCase()}`);
  const [semitransparent, setSemitransparent] = useState(initial?.semitransparent ?? true);
  const [layout, setLayout] = useState<"diagonal" | "horizontal">(
    initial && !initial.rotation ? "horizontal" : "diagonal",
  );
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState("auto");
  const [washout, setWashout] = useState(initial?.kind === "picture" ? !!initial.washout : true);
  const [error, setError] = useState<ToolbarMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const apply = async (event: FormEvent) => {
    event.preventDefault();
    if (kind === "none") return onClose(editor.run(setWatermark(null)));
    if (kind === "text") {
      if (!text.trim()) return setError("Text");
      const made = textWatermark(editor.state, {
        text,
        font,
        size: size === "auto" ? undefined : Number(size),
        color: color.slice(1).toUpperCase(),
        semitransparent,
        layout,
      });
      const watermark =
        initial?.kind === "text" && !boxChanged
          ? { ...made, width: initial.width, height: initial.height }
          : made;
      return onClose(editor.run(setWatermark(watermark)));
    }
    if (!file) {
      // The picture it has, with the scale and washout changed.
      if (initial?.kind !== "picture") return setError("Select picture…");
      return onClose(editor.run(setWatermark({ ...initial, washout })));
    }
    if (!upload || !file.type.startsWith("image/")) return setError("Select picture…");
    setBusy(true);
    try {
      const measured = await measureImageFile(file, first.current?.ownerDocument ?? document);
      const answer = measured ? await upload(file) : null;
      const src = typeof answer === "string" ? answer : answer?.src;
      if (!open.current) return;
      if (!measured || !src) throw new Error("no image");
      // A pixel is 15 twips; Auto fills the text area's width.
      const natural = measured.width * 15;
      const width = scale === "auto" ? textWidthOf(editor.state) : (natural * Number(scale)) / 100;
      const height = (width * measured.height) / measured.width;
      const type = /^data:([^;,]+)/i.exec(src)?.[1]?.toLowerCase() ?? file.type;
      const done = editor.run(
        setWatermark(
          {
            kind: "picture",
            ...(washout ? { washout: true } : {}),
            width: Math.max(1, Math.min(Math.round(width), 31_680)),
            height: Math.max(1, Math.min(Math.round(height), 31_680)),
          },
          { contentType: type, ...(src.startsWith("data:") ? { data: src } : { url: src }) },
        ),
      );
      onClose(done);
    } catch {
      if (!open.current) return;
      setBusy(false);
      setError("Select picture…");
    }
  };

  return (
    <div
      role="dialog"
      aria-label={t("Watermark")}
      className="foli-link-dialog foli-word-dialog foli-watermark-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <div className="foli-dialog-panel">
          <fieldset className="foli-dialog-section">
            <legend>{t("Watermark")}</legend>
            {KIND_NAMES.map(([value, label]) => (
              <div key={value} className="foli-setup-field foli-setup-check">
                <input
                  ref={value === kind ? first : undefined}
                  id={`${id}-kind-${value}`}
                  type="radio"
                  name={`${id}-kind`}
                  checked={kind === value}
                  disabled={value === "picture" && !upload && initial?.kind !== "picture"}
                  onChange={() => {
                    setKind(value);
                    setError(null);
                  }}
                />
                <label htmlFor={`${id}-kind-${value}`}>{t(label)}</label>
              </div>
            ))}
          </fieldset>
          <fieldset className="foli-dialog-section" disabled={kind !== "picture" || busy}>
            <legend>{t("Picture watermark")}</legend>
            <Field id={`${id}-file`} label={t("Select picture…")}>
              <input
                id={`${id}-file`}
                type="file"
                accept="image/*"
                aria-invalid={error === "Select picture…" || undefined}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
              />
            </Field>
            <Field id={`${id}-scale`} label={t("Scale")}>
              <select id={`${id}-scale`} value={scale} onChange={(e) => setScale(e.target.value)}>
                <option value="auto">{t("Auto")}</option>
                {SCALES.map((s) => (
                  <option key={s} value={String(s)}>{`${s}%`}</option>
                ))}
              </select>
            </Field>
            <div className="foli-setup-field foli-setup-check">
              <input
                id={`${id}-washout`}
                type="checkbox"
                checked={washout}
                onChange={(e) => setWashout(e.target.checked)}
              />
              <label htmlFor={`${id}-washout`}>{t("Washout")}</label>
            </div>
          </fieldset>
          <fieldset className="foli-dialog-section" disabled={kind !== "text"}>
            <legend>{t("Text watermark")}</legend>
            <Field id={`${id}-text`} label={t("Text")}>
              <input
                id={`${id}-text`}
                type="text"
                list={`${id}-texts`}
                value={text}
                aria-invalid={error === "Text" || undefined}
                onChange={(e) => {
                  setText(e.target.value);
                  setBoxChanged(true);
                  setError(null);
                }}
              />
              <datalist id={`${id}-texts`}>
                {WATERMARK_TEXTS.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </Field>
            <Field id={`${id}-font`} label={t("Font")}>
              <select id={`${id}-font`} value={font} onChange={(e) => setFont(e.target.value)}>
                {!fonts.includes(font) && <option value={font}>{font}</option>}
                {fonts.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-size`} label={t("Size")}>
              <select
                id={`${id}-size`}
                value={size}
                onChange={(e) => {
                  setSize(e.target.value);
                  setBoxChanged(true);
                }}
              >
                <option value="auto">{t("Auto")}</option>
                {WATERMARK_SIZES.map((s) => (
                  <option key={s} value={String(s)}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-color`} label={t("Color")}>
              <select id={`${id}-color`} value={color} onChange={(e) => setColor(e.target.value)}>
                {colors.map((c) => (
                  <option key={c.name} value={c.color}>
                    {t(c.name)}
                  </option>
                ))}
                {!colors.some((c) => c.color === color) && (
                  <option value={color}>{t("Other color {color}", { color })}</option>
                )}
              </select>
            </Field>
            <div className="foli-setup-field foli-setup-check">
              <input
                id={`${id}-semi`}
                type="checkbox"
                checked={semitransparent}
                onChange={(e) => setSemitransparent(e.target.checked)}
              />
              <label htmlFor={`${id}-semi`}>{t("Semitransparent")}</label>
            </div>
            <fieldset className="foli-dialog-section">
              <legend>{t("Layout")}</legend>
              {LAYOUT_NAMES.map(([value, label]) => (
                <div key={value} className="foli-setup-field foli-setup-check">
                  <input
                    id={`${id}-layout-${value}`}
                    type="radio"
                    name={`${id}-layout`}
                    checked={layout === value}
                    onChange={() => {
                      setLayout(value);
                      setBoxChanged(true);
                    }}
                  />
                  <label htmlFor={`${id}-layout-${value}`}>{t(label)}</label>
                </div>
              ))}
            </fieldset>
          </fieldset>
        </div>
        <div className="foli-dialog-buttons">
          <button type="submit" disabled={busy}>
            {t("OK")}
          </button>
          <button type="button" onClick={() => onClose(false)}>
            {t("Cancel")}
          </button>
        </div>
        {error && (
          <p className="foli-link-error" role="alert">
            {t("Check this value: {field}.", { field: t(error) })}
          </p>
        )}
      </form>
    </div>
  );
}

// ---------- Home ▸ Borders and Shading (32.4) ----------

const PARAGRAPH_SIDES = ["top", "bottom", "left", "right", "between"] as const;
type ParagraphSide = (typeof PARAGRAPH_SIDES)[number];
const PARAGRAPH_SIDE_NAMES = Object.fromEntries([
  ["top", "Top border"],
  ["bottom", "Bottom border"],
  ["left", "Left border"],
  ["right", "Right border"],
  ["between", "Border between paragraphs"],
] as const) as Record<ParagraphSide, ToolbarMessage>;
/** Word's shading patterns (`w:shd/@w:val`) the dialog offers. */
const PATTERN_NAMES = [
  ["clear", "Clear"],
  ["solid", "Solid (100%)"],
  ["pct5", "5%"],
  ["pct10", "10%"],
  ["pct20", "20%"],
  ["pct25", "25%"],
  ["pct50", "50%"],
  ["pct75", "75%"],
  ["horzStripe", "Dark horizontal"],
  ["vertStripe", "Dark vertical"],
] as const satisfies readonly (readonly [string, ToolbarMessage])[];

/**
 * Word's Borders and Shading dialog for the selected paragraphs: their borders (None, Box or
 * Custom; the line's style, color and width; which sides, the one between paragraphs too) and
 * shading (fill, pattern and its color). OK sets what was changed, in one undo step; tracked as
 * paragraph formatting.
 * shortcut: no preview, no Page Border tab (Design ▸ Page Borders), no Shadow or 3-D setting.
 * @internal
 */
export function BordersShadingDialog({
  editor,
  colors,
  onClose,
}: {
  editor: Editor;
  colors: readonly { name: ToolbarMessage; color: string }[];
  onClose: (applied: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const [initial] = useState(() => {
    const at = paragraphBordersAt(editor.state);
    const borders = at?.borders ?? null;
    const present = PARAGRAPH_SIDES.filter((side) => isLine(borders?.[side]?.style));
    const line = present[0] ? borders?.[present[0]] : undefined;
    const outside = ["top", "bottom", "left", "right"] as const;
    const box =
      present.length === 4 &&
      outside.every((side) => {
        const b = borders?.[side];
        return b?.style === line?.style && b?.size === line?.size && b?.color === line?.color;
      });
    const shading = at?.shading ?? null;
    const hex = (value: string | undefined) =>
      value && value !== "auto" ? `#${value.toLowerCase()}` : "auto";
    return {
      borders,
      setting: (!present.length ? "none" : box ? "box" : "custom") as Setting,
      style: line?.style ?? "single",
      color: hex(line?.color),
      width: line?.size ?? 4,
      sides: Object.fromEntries(
        PARAGRAPH_SIDES.map((side) => [side, present.includes(side)]),
      ) as Record<ParagraphSide, boolean>,
      fill: hex(shading?.fill),
      pattern: shading?.pattern ?? "clear",
      patternColor: hex(shading?.color),
    };
  });
  const [setting, setSetting] = useState<Setting>(initial.setting);
  const [style, setStyle] = useState<string>(initial.style);
  const [color, setColor] = useState(initial.color);
  const [width, setWidth] = useState<number>(initial.width);
  const [sides, setSides] = useState(initial.sides);
  const [fill, setFill] = useState(initial.fill);
  const [pattern, setPattern] = useState<string>(initial.pattern);
  const [patternColor, setPatternColor] = useState(initial.patternColor);
  const [bordersChanged, setBordersChanged] = useState(false);
  const [lineChanged, setLineChanged] = useState(false);
  const [shadingChanged, setShadingChanged] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const rgb = (value: string) => (value === "auto" ? "auto" : value.slice(1).toUpperCase());
  const apply = (event: FormEvent) => {
    event.preventDefault();
    const commands: Command[] = [];
    if (bordersChanged) {
      const line = { style, size: width, space: 1, color: rgb(color) };
      const own = initial.borders;
      const shown =
        setting === "box"
          ? (["top", "bottom", "left", "right"] as const)
          : PARAGRAPH_SIDES.filter((side) => sides[side]);
      // A bar border (the dialog does not show it) stays.
      const bar = own?.bar ? { bar: own.bar } : {};
      commands.push(
        setParagraphBorders(
          setting === "none" || !shown.length
            ? own?.bar
              ? bar
              : null
            : {
                ...bar,
                ...Object.fromEntries(
                  shown.map((side) => {
                    const kept = own?.[side];
                    if (!lineChanged && kept && isLine(kept.style)) return [side, kept];
                    return [
                      side,
                      side === "left" || side === "right" ? { ...line, space: 4 } : line,
                    ];
                  }),
                ),
              },
        ),
      );
    }
    if (shadingChanged)
      commands.push(
        setParagraphShading(
          fill === "auto" && pattern === "clear"
            ? null
            : { pattern, color: pattern === "clear" ? "auto" : rgb(patternColor), fill: rgb(fill) },
        ),
      );
    if (!commands.length) return onClose(false);
    onClose(editor.run(chainCommands(commands)));
  };

  const colorOptions = (value: string, automatic: ToolbarMessage) => (
    <>
      <option value="auto">{t(automatic)}</option>
      {colors.map((c) => (
        <option key={c.name} value={c.color}>
          {t(c.name)}
        </option>
      ))}
      {value !== "auto" && !colors.some((c) => c.color === value) && (
        <option value={value}>{t("Other color {color}", { color: value })}</option>
      )}
    </>
  );
  const borders = () => {
    setBordersChanged(true);
  };
  const lines = () => {
    setBordersChanged(true);
    setLineChanged(true);
  };
  const off = setting === "none";
  return (
    <div
      role="dialog"
      aria-label={t("Borders and Shading")}
      className="foli-link-dialog foli-word-dialog foli-borders-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <div className="foli-dialog-panel">
          <fieldset className="foli-dialog-section">
            <legend>{t("Borders")}</legend>
            {SETTING_NAMES.map(([value, label]) => (
              <div key={value} className="foli-setup-field foli-setup-check">
                <input
                  ref={value === initial.setting ? first : undefined}
                  id={`${id}-setting-${value}`}
                  type="radio"
                  name={`${id}-setting`}
                  checked={setting === value}
                  onChange={() => {
                    setSetting(value);
                    borders();
                  }}
                />
                <label htmlFor={`${id}-setting-${value}`}>{t(label)}</label>
              </div>
            ))}
          </fieldset>
          <fieldset className="foli-dialog-section" disabled={off}>
            <legend>{t("Line")}</legend>
            <Field id={`${id}-style`} label={t("Style")}>
              <select
                id={`${id}-style`}
                value={style}
                onChange={(e) => {
                  setStyle(e.target.value);
                  lines();
                }}
              >
                {!BORDER_STYLE_NAMES.some(([value]) => value === style) && (
                  <option value={style}>{style}</option>
                )}
                {BORDER_STYLE_NAMES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-color`} label={t("Color")}>
              <select
                id={`${id}-color`}
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  lines();
                }}
              >
                {colorOptions(color, "Automatic")}
              </select>
            </Field>
            <Field id={`${id}-width`} label={t("Width")}>
              <select
                id={`${id}-width`}
                value={String(width)}
                onChange={(e) => {
                  setWidth(Number(e.target.value));
                  lines();
                }}
              >
                {!(BORDER_WIDTHS as readonly number[]).includes(width) && (
                  <option value={String(width)}>{`${width / 8} pt`}</option>
                )}
                {BORDER_WIDTHS.map((w) => (
                  <option key={w} value={String(w)}>{`${w / 8} pt`}</option>
                ))}
              </select>
            </Field>
          </fieldset>
          <fieldset className="foli-dialog-section" disabled={off}>
            <legend>{t("Sides")}</legend>
            {PARAGRAPH_SIDES.map((side) => (
              <div key={side} className="foli-setup-field foli-setup-check">
                <input
                  id={`${id}-side-${side}`}
                  type="checkbox"
                  checked={(setting === "box" && side !== "between") || sides[side]}
                  onChange={(e) => {
                    const all = setting === "box";
                    setSides((now) => ({
                      top: all || now.top,
                      bottom: all || now.bottom,
                      left: all || now.left,
                      right: all || now.right,
                      between: now.between,
                      [side]: e.target.checked,
                    }));
                    setSetting("custom");
                    borders();
                  }}
                />
                <label htmlFor={`${id}-side-${side}`}>{t(PARAGRAPH_SIDE_NAMES[side])}</label>
              </div>
            ))}
          </fieldset>
          <fieldset className="foli-dialog-section">
            <legend>{t("Shading")}</legend>
            <Field id={`${id}-fill`} label={t("Fill")}>
              <select
                id={`${id}-fill`}
                value={fill}
                onChange={(e) => {
                  setFill(e.target.value);
                  setShadingChanged(true);
                }}
              >
                {colorOptions(fill, "No Color")}
              </select>
            </Field>
            <Field id={`${id}-pattern`} label={t("Pattern style")}>
              <select
                id={`${id}-pattern`}
                value={pattern}
                onChange={(e) => {
                  setPattern(e.target.value);
                  setShadingChanged(true);
                }}
              >
                {!PATTERN_NAMES.some(([value]) => value === pattern) && (
                  <option value={pattern}>{pattern}</option>
                )}
                {PATTERN_NAMES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-pattern-color`} label={t("Pattern color")}>
              <select
                id={`${id}-pattern-color`}
                value={patternColor}
                disabled={pattern === "clear"}
                onChange={(e) => {
                  setPatternColor(e.target.value);
                  setShadingChanged(true);
                }}
              >
                {colorOptions(patternColor, "Automatic")}
              </select>
            </Field>
          </fieldset>
        </div>
        <div className="foli-dialog-buttons">
          <button type="submit">{t("OK")}</button>
          <button type="button" onClick={() => onClose(false)}>
            {t("Cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
