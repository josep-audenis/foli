import type { FoliDocument } from "../document.js";
import type { MarkJSON, NodeJSON } from "../model/index.js";
import type { BlockJSON, InlineJSON, MarkNameJSON } from "../schema.js";
import type {
  AbstractNumberingJSON,
  FoliDocumentV3,
  NumberingInstanceJSON,
  SectionJSON,
  StyleJSON,
} from "./document.js";
import { mmToTwips } from "./units.js";

/**
 * Schema v2 → v3 (ADR-0005): the content keeps every character, mark and break; its structure
 * becomes Word's.
 * - Headings become paragraphs styled `Heading1`–`Heading6`.
 * - Lists become numbered paragraphs (style `ListParagraph`, `numbering` id and level): one
 *   numbering instance per list, a nested list of the same kind continuing its parent's at the
 *   next level; further blocks of an item are indented to its text. Levels past Word's 9 stay at
 *   the ninth.
 * - A horizontal rule becomes an empty paragraph with a bottom border.
 * - Alignment becomes justification; text color `color`; highlight (any color) `shading`, as
 *   Word records a background color that is not one of its highlight colors.
 * - `settings` becomes the section, in twips (rounded to the twip: under 0.02 mm).
 * The styles and numbering definitions the result references are added.
 */
export function migrateToV3(doc: FoliDocument): FoliDocumentV3 {
  const instances: NumberingInstanceJSON[] = [];
  const content = blocks(doc.content.content, { instances });
  return {
    schemaVersion: 3,
    section: section(doc.settings),
    // The default stylesheet's look (11 pt Georgia), rather than Word's empty-defaults 10 pt.
    defaults: {
      run: [
        { type: "font", attrs: { ascii: "Georgia", hAnsi: "Georgia", cs: "Georgia" } },
        { type: "fontSize", attrs: { value: 22, complexScript: 22 } },
      ],
    },
    // Copies: no two documents share an object.
    styles: structuredClone(STYLES),
    numbering: { abstracts: structuredClone([BULLETS, NUMBERS]), instances },
    comments: [],
    content: { type: "doc", content },
  };
}

interface Context {
  readonly instances: NumberingInstanceJSON[];
}

type Kind = "bullet" | "number";

const INDENT = 720; // twips per list level: 0.5 inch, Word's
const HANGING = 360;

/** Millimetres to twips within Word's limits (22 inches: v2 allowed any size). */
function twips(mm: number): number {
  return Math.min(mmToTwips(mm), 31_680);
}

function section(settings: FoliDocument["settings"]): SectionJSON {
  const { width, height } = settings.pageSize;
  const { top, right, bottom, left } = settings.margins;
  return {
    pageSize: {
      width: Math.max(twips(width), 1),
      height: Math.max(twips(height), 1),
      ...(width > height ? { orientation: "landscape" as const } : {}),
    },
    margins: {
      top: twips(top),
      right: twips(right),
      bottom: twips(bottom),
      left: twips(left),
    },
  };
}

function blocks(list: readonly BlockJSON[], context: Context): NodeJSON[] {
  const out: NodeJSON[] = [];
  for (const block of list) {
    if (block.type === "bulletList" || block.type === "orderedList") {
      listBlocks(block, 0, undefined, context, out);
    } else {
      out.push(paragraph(block, {}));
    }
  }
  return out;
}

/** A v2 list's items as numbered paragraphs, appended to `out`. */
function listBlocks(
  list: Extract<BlockJSON, { type: "bulletList" | "orderedList" }>,
  depth: number,
  parent: { id: number; kind: Kind; item: { continued: boolean } } | undefined,
  context: Context,
  out: NodeJSON[],
): void {
  const level = Math.min(depth, 8);
  const kind: Kind = list.type === "bulletList" ? "bullet" : "number";
  const start = list.type === "orderedList" ? (list.attrs?.start ?? 1) : 1;
  // A nested list of the same kind starting at 1 continues its parent's numbering one level
  // down: Word restarts the deeper level after each item, as v2 numbered it. Only the item's
  // first such list (a second one would continue the first's count) and only while the level
  // goes down (past the ninth, it would continue the parent's).
  const continues =
    parent !== undefined &&
    parent.kind === kind &&
    start === 1 &&
    depth <= 8 &&
    !parent.item.continued;
  let id: number | undefined;
  if (continues) {
    id = parent.id;
    parent.item.continued = true;
  }
  if (id === undefined) {
    id = context.instances.length + 1;
    context.instances.push({
      id,
      abstract: kind === "bullet" ? BULLETS.id : NUMBERS.id,
      // An explicit start restarts the numbering, whatever instances share the definition.
      ...(kind === "number" ? { overrides: [{ level, start }] } : {}),
    });
  }
  for (const item of list.content) {
    const [first, ...rest] = item.content;
    const state = { continued: false };
    out.push(paragraph(first, { style: "ListParagraph", numbering: { id, level } }));
    for (const block of rest) {
      if (block.type === "bulletList" || block.type === "orderedList") {
        listBlocks(block, depth + 1, { id, kind, item: state }, context, out);
      } else {
        // More of the item: aligned with its text.
        const style =
          block.type === "paragraph" || block.type === "horizontalRule"
            ? { style: "ListParagraph" }
            : {};
        out.push(paragraph(block, { ...style, indent: { left: INDENT * (level + 1) } }));
      }
    }
  }
}

function paragraph(
  block: Exclude<BlockJSON, { type: "bulletList" | "orderedList" }>,
  extra: Record<string, unknown>,
): NodeJSON {
  if (block.type === "horizontalRule") {
    return {
      type: "paragraph",
      attrs: {
        ...extra,
        borders: { bottom: { style: "single", size: 6, space: 1, color: "auto" } },
      },
    };
  }
  const attrs: Record<string, unknown> = { ...extra };
  if (block.type === "heading") attrs.style = `Heading${block.attrs.level}`;
  const align = block.attrs?.align;
  if (align && align !== "start") attrs.justification = JUSTIFY[align];
  return {
    type: "paragraph",
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(block.content?.length ? { content: block.content.map(inline) } : {}),
  };
}

const JUSTIFY = { center: "center", end: "right", justify: "both" } as const;

function inline(node: InlineJSON): NodeJSON {
  const marks = node.marks?.map(mark);
  return { ...node, ...(marks?.length ? { marks } : {}) } as NodeJSON;
}

function mark(m: MarkNameJSON): MarkJSON {
  switch (m.type) {
    case "link":
      return { type: "link", attrs: { href: m.attrs.href } };
    case "textColor":
      return { type: "color", attrs: { value: m.attrs.color.slice(1).toUpperCase() } };
    case "highlight":
      return {
        type: "shading",
        attrs: { pattern: "clear", fill: m.attrs.color.slice(1).toUpperCase() },
      };
    default:
      return { type: m.type };
  }
}

/** The styles migrated documents use, as Word names them. */
const HEADING_SIZES = [32, 28, 26, 24, 22, 22]; // half-points

const STYLES: StyleJSON[] = [
  { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
  ...HEADING_SIZES.map(
    (size, i): StyleJSON => ({
      id: `Heading${i + 1}`,
      type: "paragraph",
      name: `heading ${i + 1}`,
      basedOn: "Normal",
      next: "Normal",
      paragraph: {
        keepNext: true,
        keepLines: true,
        outlineLevel: i,
        spacing: { before: 240, after: 120 },
      },
      run: [{ type: "bold" }, { type: "fontSize", attrs: { value: size } }],
    }),
  ),
  {
    id: "ListParagraph",
    type: "paragraph",
    name: "List Paragraph",
    basedOn: "Normal",
    paragraph: { indent: { left: INDENT }, contextualSpacing: true },
  },
  {
    id: "DefaultParagraphFont",
    type: "character",
    name: "Default Paragraph Font",
    isDefault: true,
  },
];

function levels(kind: Kind): AbstractNumberingJSON["levels"] {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    start: 1,
    // v2 showed nested numbers as decimal at every level (the browser's default).
    format: kind === "bullet" ? "bullet" : "decimal",
    text: kind === "bullet" ? (["•", "◦", "▪"][level % 3] as string) : `%${level + 1}.`,
    justification: "left",
    paragraph: { indent: { left: INDENT * (level + 1), hanging: HANGING } },
  }));
}

const BULLETS: AbstractNumberingJSON = {
  id: 0,
  multiLevelType: "hybridMultilevel",
  levels: levels("bullet"),
};
const NUMBERS: AbstractNumberingJSON = {
  id: 1,
  multiLevelType: "hybridMultilevel",
  levels: levels("number"),
};
