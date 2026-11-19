/**
 * Office's cloud fonts for the corpus runs. Chromium uses the fonts installed on the machine;
 * Office's cloud fonts (Aptos, the default since 2023) are not installed system-wide: they are
 * served to the page from Office's font cache (`FOLI_FONT_DIR`, default the Windows cache) when
 * present, for this run only, never copied or committed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

const FONT_DIR =
  process.env.FOLI_FONT_DIR ??
  join(process.env.LOCALAPPDATA ?? "", "Microsoft", "FontCache", "4", "CloudFonts");
const FAMILIES = (process.env.FOLI_FONTS ?? "Aptos,Aptos Display").split(",");
const FONT_PATH = "/__foli-word-fonts/";

export interface Face {
  family: string;
  file: string;
  weight: number;
  italic: boolean;
}

/** A TrueType font's weight and italic flag, from its OS/2 table. */
function faceOf(bytes: Buffer): { weight: number; italic: boolean } | null {
  if (bytes.length < 12) return null;
  const tables = bytes.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (record + 16 > bytes.length) return null;
    if (bytes.toString("latin1", record, record + 4) !== "OS/2") continue;
    const offset = bytes.readUInt32BE(record + 8);
    if (offset + 64 > bytes.length) return null;
    return {
      weight: bytes.readUInt16BE(offset + 4),
      italic: (bytes.readUInt16BE(offset + 62) & 1) === 1,
    };
  }
  return null;
}

/** The faces of the cloud font families found in the font cache. */
export function cloudFaces(): Face[] {
  const faces: Face[] = [];
  for (const family of FAMILIES) {
    const dir = join(FONT_DIR, family);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".ttf"))) {
      const face = faceOf(readFileSync(join(dir, file)));
      if (face) faces.push({ family, file: join(dir, file), ...face });
    }
  }
  return faces;
}

/** Serves `faces` to `page` and gives their `@font-face` rules. */
async function fontFaces(page: Page, faces: Face[]): Promise<string> {
  if (!faces.length) return "";
  await page.route(`**${FONT_PATH}*`, (route) => {
    const index = Number(new URL(route.request().url()).pathname.slice(FONT_PATH.length));
    const face = faces[index];
    if (!face) return route.abort();
    return route.fulfill({ contentType: "font/ttf", body: readFileSync(face.file) });
  });
  return faces
    .map(
      (f, i) =>
        `@font-face { font-family: "${f.family}"; src: url("${FONT_PATH}${i}") format("truetype"); font-weight: ${f.weight}; font-style: ${f.italic ? "italic" : "normal"}; font-display: block; }`,
    )
    .join("\n");
}

/** `@font-face` rules for `faces` with their files as `data:` URLs (`exportPdf`'s `styles`). */
export function inlineFontFaces(faces: Face[]): string {
  return faces
    .map(
      (f) =>
        `@font-face { font-family: "${f.family}"; src: url("data:font/ttf;base64,${readFileSync(f.file).toString("base64")}") format("truetype"); font-weight: ${f.weight}; font-style: ${f.italic ? "italic" : "normal"}; }`,
    )
    .join("\n");
}

/** Serves `faces` to `page`, which is open, and waits until they are loaded. */
export async function loadFonts(page: Page, faces: Face[]): Promise<void> {
  if (!faces.length) return;
  await page.addStyleTag({ content: await fontFaces(page, faces) });
  await page.evaluate(
    (all) =>
      Promise.all(
        all.map((f) =>
          document.fonts.load(`${f.italic ? "italic" : "normal"} ${f.weight} 16px "${f.family}"`),
        ),
      ).then(() => {}),
    faces,
  );
}
