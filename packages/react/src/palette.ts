/** Word's color grid: the shades under each theme color. */

/** `#rrggbb` as hue (0–1), saturation (0–1), luminance (0–1). */
function hsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v =
      u < 1 / 6
        ? p + (q - p) * 6 * u
        : u < 1 / 2
          ? q
          : u < 2 / 3
            ? p + (q - p) * (2 / 3 - u) * 6
            : p;
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(h + 1 / 3)}${channel(h)}${channel(h - 1 / 3)}`;
}

/**
 * `color` made lighter (`percent` above 0) or darker (below 0), as Word's theme shades: the
 * luminance moved that far towards white or black.
 * @internal
 */
export function shade(color: string, percent: number): string {
  const [h, s, l] = hsl(color);
  const p = Math.abs(percent) / 100;
  return hex(h, s, percent > 0 ? l * (1 - p) + p : l * (1 - p));
}

/** The five shades Word lists under `color`, top to bottom (by how light it is). @internal */
export function shadesOf(color: string): readonly number[] {
  const l = hsl(color)[2];
  if (l === 0) return [50, 35, 25, 15, 5];
  if (l === 1) return [-5, -15, -25, -35, -50];
  if (l < 0.2) return [90, 75, 50, 25, 10];
  if (l > 0.8) return [-10, -25, -50, -75, -90];
  return [80, 60, 40, -25, -50];
}
