/**
 * Word's Design tab dialogs (Phase 32), opened by the toolbar as its other built-in dialogs:
 * filled from the caret's section, applied in one transaction (one undo step).
 */

import { type Editor, sectionAt, setPageBorders } from "@folijs/core";
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
  const first = useRef<HTMLInputElement>(null);
  const distanceBox = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const apply = (event: FormEvent) => {
    event.preventDefault();
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
    const borders =
      setting === "none" || !shown.length
        ? null
        : {
            ...(from === "page" ? { offsetFrom: "page" as const } : {}),
            ...(applyTo === "firstPage" || applyTo === "notFirstPage" ? { display: applyTo } : {}),
            ...Object.fromEntries(shown.map((side) => [side, line])),
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
      <form onSubmit={apply} noValidate>
        <div className="foli-dialog-panel">
          <fieldset className="foli-dialog-section">
            <legend>{t("Setting")}</legend>
            {SETTING_NAMES.map(([value, label]) => settingRadio(value, label))}
          </fieldset>
          <fieldset className="foli-dialog-section" disabled={off}>
            <legend>{t("Line")}</legend>
            <Field id={`${id}-style`} label={t("Style")}>
              <select id={`${id}-style`} value={style} onChange={(e) => setStyle(e.target.value)}>
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
              <select id={`${id}-color`} value={color} onChange={(e) => setColor(e.target.value)}>
                <option value="auto">{t("Automatic")}</option>
                {colors.map((c) => (
                  <option key={c.color} value={c.color}>
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
                onChange={(e) => setWidth(Number(e.target.value))}
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
          <fieldset className="foli-dialog-section" disabled={off}>
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
              <select id={`${id}-from`} value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="page">{t("Edge of page")}</option>
                <option value="text">{t("Text")}</option>
              </select>
            </Field>
            <Field id={`${id}-distance`} label={t("Distance (pt)")}>
              <input
                ref={distanceBox}
                id={`${id}-distance`}
                type="text"
                inputMode="numeric"
                value={distance}
                aria-invalid={error || undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e) => {
                  setDistance(e.target.value);
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
