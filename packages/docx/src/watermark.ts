/**
 * Word's watermarks (Design ▸ Watermark): a VML shape in a header's run, `w:pict` holding a
 * `v:shape` whose id Word gives its text watermarks (`PowerPlusWaterMarkObject…`, WordArt on
 * `v:textpath`) or its picture ones (`WordPictureWatermark…`, a `v:imagedata`). Read into an
 * opaque run's `watermark` (schema 9, ADR-0015) and written back verbatim while it still says
 * that; a new or changed one is written as Word writes it.
 */
import type { ResourceJSON, WatermarkJSON } from "@folijs/core";
import type { Namespaces } from "./export/xmlout.js";
import { escapeAttribute } from "./export/xmlout.js";
import { attr, R } from "./import/ooxml.js";
import type { XmlElement } from "./xml.js";

const V = "urn:schemas-microsoft-com:vml";
const O = "urn:schemas-microsoft-com:office:office";
const W10 = "urn:schemas-microsoft-com:office:word";
const IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const TEXT_ID = "PowerPlusWaterMarkObject";
const PICTURE_ID = "WordPictureWatermark";
/** Word's washout: the picture's contrast and brightness (`gain`, `blacklevel`). */
const WASHOUT = { gain: "19661f", blacklevel: "22938f" };

/** VML's named colors Word writes for watermarks, as RRGGBB. */
const NAMED: Record<string, string> = {
  silver: "C0C0C0",
  black: "000000",
  white: "FFFFFF",
  gray: "808080",
  red: "FF0000",
  maroon: "800000",
  yellow: "FFFF00",
  olive: "808000",
  lime: "00FF00",
  green: "008000",
  aqua: "00FFFF",
  teal: "008080",
  blue: "0000FF",
  navy: "000080",
  fuchsia: "FF00FF",
  purple: "800080",
};

const kids = (el: XmlElement) => el.children.filter((c): c is XmlElement => c.kind === "element");
const plain = (el: XmlElement | undefined, name: string) =>
  el?.attributes.find((a) => a.name === name)?.value;

/** A VML `style` as its properties. */
function styleOf(value: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (value ?? "").split(";")) {
    const at = part.indexOf(":");
    if (at > 0) out.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return out;
}

/** `412.4pt` in twips, undefined for anything not in points. */
function twips(value: string | undefined): number | undefined {
  const match = /^(\d+(?:\.\d+)?)pt$/.exec(value ?? "");
  const n = match ? Math.round(Number(match[1]) * 20) : 0;
  return n > 0 && n <= 31_680 ? n : undefined;
}

/** A VML color (`silver`, `#c00000`, `#4472c4 [3204]`) as RRGGBB. */
function colorOf(value: string | undefined): string | undefined {
  const name = (value ?? "").split(/\s/)[0]?.toLowerCase() ?? "";
  if (/^#[0-9a-f]{6}$/.test(name)) return name.slice(1).toUpperCase();
  return NAMED[name];
}

/**
 * What a watermark run's `w:pict` reading needs of its part.
 * @internal
 */
export interface WatermarkContext {
  relationship(id: string): { type: string; external: boolean; partName?: string } | undefined;
  partOf(name: string): { contentType: string; data: Uint8Array } | undefined;
}

/**
 * The watermark `pict` (a `w:pict`) is, undefined when it is not one of Word's the model holds:
 * its picture's resource pushed to `resource`.
 * @internal
 */
export function readWatermark(
  pict: XmlElement,
  context: WatermarkContext,
  resource: [string?, ResourceJSON?] = [],
): WatermarkJSON | undefined {
  const shapes = kids(pict).filter((c) => c.ns === V && c.local === "shape");
  if (shapes.length !== 1) return undefined;
  const shape = shapes[0] as XmlElement;
  const id = plain(shape, "id") ?? "";
  const style = styleOf(plain(shape, "style"));
  const width = twips(style.get("width"));
  const height = twips(style.get("height"));
  if (!width || !height) return undefined;
  const rotation = Number(style.get("rotation") ?? 0);
  if (id.startsWith(TEXT_ID)) {
    const path = kids(shape).find((c) => c.ns === V && c.local === "textpath");
    const text = plain(path, "string");
    const color = colorOf(plain(shape, "fillcolor") ?? "white");
    if (text === undefined || !color || !Number.isInteger(rotation)) return undefined;
    const font = styleOf(plain(path, "style")).get("font-family")?.replace(/^"|"$/g, "");
    const fill = kids(shape).find((c) => c.ns === V && c.local === "fill");
    return {
      kind: "text",
      text,
      ...(font ? { font } : {}),
      color,
      ...(plain(fill, "opacity") !== undefined ? { semitransparent: true } : {}),
      ...(rotation ? { rotation: ((rotation % 360) + 360) % 360 } : {}),
      width,
      height,
    };
  }
  if (!id.startsWith(PICTURE_ID) || rotation) return undefined;
  const data = kids(shape).find((c) => c.ns === V && c.local === "imagedata");
  const rid = data && attr(data, "id", R);
  const relationship = rid === undefined ? undefined : context.relationship(rid);
  if (!relationship || relationship.type !== IMAGE || relationship.external) return undefined;
  const name = relationship.partName;
  const part = name ? context.partOf(name) : undefined;
  if (!name || !part?.contentType.startsWith("image/")) return undefined;
  const key = name.replace(/^\//, "");
  resource.push(key, { contentType: part.contentType, size: part.data.length, part: key });
  const washout =
    plain(data, "gain") === WASHOUT.gain && plain(data, "blacklevel") === WASHOUT.blacklevel;
  return { kind: "picture", picture: key, ...(washout ? { washout: true } : {}), width, height };
}

/** A fill color as Word writes it: its own gray by name. */
const fill = (color = "C0C0C0") =>
  color.toUpperCase() === "C0C0C0" ? "silver" : `#${color.toLowerCase()}`;

/** Points as VML writes them: `412.4pt`. */
const pt = (twipsValue: number) => `${Number((twipsValue / 20).toFixed(2))}pt`;

/** A shape id of `stem` no other watermark of the output has. */
let next = 0;
const shapeNumber = () => 2049 + (next++ % 30_000);

/** Word's WordArt shape type for text on a path (`_x0000_t136`). */
const TEXT_TYPE =
  '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';
/** Word's picture frame shape type (`_x0000_t75`). */
const PICTURE_TYPE =
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';
/** Where Word puts a watermark: centered on the margins, behind the text. */
const PLACE =
  "z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin";

/**
 * `watermark` as Word writes it (a `w:pict`), the VML namespaces the part does not declare
 * declared on it; `image(key)` relates a picture's image part and gives its id.
 * @internal
 */
export function watermarkXml(
  watermark: WatermarkJSON,
  namespaces: Namespaces,
  image: (key: string) => string,
): string {
  const declare = Object.entries({ v: V, o: O, w10: W10 })
    .filter(([prefix]) => !namespaces.prefixes.has(prefix))
    .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
    .join("");
  const n = shapeNumber();
  const size = `width:${pt(watermark.width)};height:${pt(watermark.height)}`;
  if (watermark.kind === "picture") {
    const id = image(String(watermark.picture));
    const washout = watermark.washout
      ? ` gain="${WASHOUT.gain}" blacklevel="${WASHOUT.blacklevel}"`
      : "";
    return `<w:pict${declare}>${PICTURE_TYPE}<v:shape id="${PICTURE_ID}${n}" o:spid="_x0000_s${n}" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;${size};${PLACE}" o:allowincell="f"><v:imagedata r:id="${escapeAttribute(id)}" o:title=""${washout}/></v:shape></w:pict>`;
  }
  const rotation = watermark.rotation ? `;rotation:${watermark.rotation}` : "";
  const font = (watermark.font ?? "Calibri").replace(/"/g, "");
  const opacity = watermark.semitransparent ? '<v:fill opacity=".5"/>' : "";
  return `<w:pict${declare}>${TEXT_TYPE}<v:shape id="${TEXT_ID}${n}" o:spid="_x0000_s${n}" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;${size}${rotation};${PLACE}" o:allowincell="f" fillcolor="${fill(watermark.color)}" stroked="f">${opacity}<v:textpath style="${escapeAttribute(`font-family:"${font}";font-size:1pt`)}" string="${escapeAttribute(watermark.text ?? "")}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict>`;
}
