/** A length unit Word's dialogs show: inches or centimetres (`FoliToolbarProps.units`). */
export type LengthUnit = "in" | "cm";

/** Twips per unit a box takes typed after a number (Word's: `2 cm`, `1"`, `12 pt`). */
const TWIPS: Readonly<Record<string, number>> = {
  in: 1440,
  '"': 1440,
  cm: 1440 / 2.54,
  mm: 144 / 2.54,
  pt: 20,
};

/**
 * `twips` in `unit`, as Word shows it: `0.5"`, `1.27 cm`, `6 pt` (two decimals at most; `round`
 * "up" or "down" for a limit that must stay in range when typed back). @internal
 */
export function formatLength(
  twips: number,
  unit: LengthUnit | "pt",
  round: "near" | "up" | "down" = "near",
): string {
  const exact = (twips / (TWIPS[unit] as number)) * 100;
  const value =
    (round === "up" ? Math.ceil(exact) : round === "down" ? Math.floor(exact) : Math.round(exact)) /
    100;
  return unit === "in" ? `${value}"` : `${value} ${unit}`;
}

/**
 * A length typed in a box as twips: a number (a decimal comma too) in `unit`, or with a unit of
 * its own after it (`in`, `"`, `cm`, `mm`, `pt`). Null when it is none.
 * @internal
 */
export function parseLength(text: string, unit: LengthUnit | "pt"): number | null {
  const match = /^(-?\d*(?:[.,]\d+)?)\s*(in|"|cm|mm|pt)?$/i.exec(text.trim());
  const number = match?.[1];
  if (!match || !number || number === "-") return null;
  const value = Number(number.replace(",", "."));
  const per = TWIPS[(match[2] ?? unit).toLowerCase()] as number;
  return Number.isFinite(value) ? Math.round(value * per) : null;
}

/** Regions that measure in inches (Word's rule: the locale's measurement system). */
const INCH_REGIONS = new Set(["US", "LR", "MM"]);

/**
 * The unit of `locale` (default: the browser's language): inches in the United States, Liberia
 * and Myanmar, centimetres elsewhere and on the server. @internal
 */
export function defaultUnit(
  locale: string | undefined = typeof navigator === "undefined" ? undefined : navigator.language,
): LengthUnit {
  try {
    const region = locale ? new Intl.Locale(locale).maximize().region : undefined;
    return region && INCH_REGIONS.has(region) ? "in" : "cm";
  } catch {
    return "cm";
  }
}
