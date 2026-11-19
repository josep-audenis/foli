/**
 * Custom nodes and marks in `.docx` (ADR-0008), on the document's JSON: on export a custom node
 * becomes a plain text content control (`w:sdt` with `w:text`, contents locked) showing its text,
 * a custom block node a block one around a paragraph of its text, and each run of a custom mark a
 * rich text control around that run (one per paragraph it crosses). The tag is `foli:` and
 * `{"node"|"mark": type, "attrs": …}` as JSON. Import turns such controls back into the node or
 * mark, whether the app has the extension or not. Generic: no code per type.
 */
import type { ControlJSON, Extension, FoliDocument, MarkJSON, NodeJSON } from "@folijs/core";
import { CUSTOM_TYPE, foreignTextOf, withForeignText } from "@folijs/core/internal";
import { DocxError } from "./package.js";

const PREFIX = "foli:";
/** Word keeps a tag of 255 characters (ADR-0008's spike); `checkControl` takes no more. */
const MAX_TAG = 255;

/** What a tag holds. */
interface Tagged {
  node?: string;
  mark?: string;
  attrs?: Record<string, unknown>;
}

const isCustom = (type: string) => CUSTOM_TYPE.test(type);
const sameMark = (a: MarkJSON, b: MarkJSON) =>
  a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
const withMarks = (node: NodeJSON, marks: readonly MarkJSON[]): NodeJSON => {
  const { marks: _, ...rest } = node;
  return marks.length ? { ...rest, marks: [...marks] } : rest;
};
const marker = (type: "controlStart" | "controlEnd", id: string): NodeJSON => ({
  type,
  attrs: { id },
});

/** Every content tree of a document (body, stories, comments), mapped by `map`. */
function mapTrees(document: FoliDocument, map: (tree: NodeJSON) => NodeJSON): FoliDocument {
  return {
    ...document,
    content: map(document.content),
    comments: document.comments.map((c) => ({
      ...c,
      content: map({ type: "doc", content: c.content }).content ?? [],
    })),
    ...(document.stories && {
      stories: Object.fromEntries(
        Object.entries(document.stories).map(([id, s]) => [id, { ...s, content: map(s.content) }]),
      ),
    }),
  };
}

/**
 * The document with its custom nodes and marks as tagged content controls.
 * @internal
 */
export function customToWord(
  document: FoliDocument,
  extensions: readonly Extension[] = [],
): FoliDocument {
  const texts = new Map<string, (attrs: Record<string, unknown>) => string>();
  for (const e of extensions)
    for (const [name, spec] of Object.entries(e.nodes ?? {})) texts.set(name, spec.text);
  const textOf = (node: NodeJSON) =>
    texts.get(node.type)?.(node.attrs ?? {}) ?? foreignTextOf(node) ?? `[${node.type}]`;
  const controls: Record<string, ControlJSON> = { ...document.controls };
  let next = 0;
  const add = (tagged: Tagged, control: Omit<ControlJSON, "tag">) => {
    const tag = PREFIX + JSON.stringify(tagged);
    if (tag.length > MAX_TAG)
      throw new DocxError(
        `${tagged.node ?? tagged.mark}: its attributes do not fit a content control's tag ` +
          `(${tag.length} > ${MAX_TAG} characters)`,
      );
    let id: string;
    do id = `foli-${++next}`;
    while (Object.hasOwn(controls, id));
    controls[id] = { ...control, tag };
    return id;
  };
  const inlines = (items: readonly NodeJSON[]): NodeJSON[] => {
    const out: NodeJSON[] = [];
    for (let i = 0; i < items.length; ) {
      const item = items[i] as NodeJSON;
      const mark = item.marks?.find((m) => isCustom(m.type));
      if (mark) {
        let j = i;
        while (j < items.length && items[j]?.marks?.some((m) => sameMark(m, mark))) j++;
        const inner = items.slice(i, j).map((n) =>
          withMarks(
            n,
            (n.marks ?? []).filter((m) => !sameMark(m, mark)),
          ),
        );
        const id = add({ mark: mark.type, attrs: mark.attrs ?? {} }, { kind: "richText" });
        out.push(marker("controlStart", id), ...inlines(inner), marker("controlEnd", id));
        i = j;
        continue;
      }
      if (isCustom(item.type)) {
        const id = add(
          { node: item.type, attrs: item.attrs ?? {} },
          { kind: "text", lock: "contentLocked" },
        );
        const text = textOf(item);
        out.push(
          marker("controlStart", id),
          ...(text ? [withMarks({ type: "text", text }, item.marks ?? [])] : []),
          marker("controlEnd", id),
        );
      } else out.push(item);
      i++;
    }
    return out;
  };
  const blocks = (node: NodeJSON): NodeJSON => {
    if (isCustom(node.type)) {
      const id = add(
        { node: node.type, attrs: node.attrs ?? {} },
        { kind: "text", lock: "contentLocked" },
      );
      const text = textOf(node);
      return {
        type: "paragraph",
        attrs: { controls: [id] },
        ...(text ? { content: [{ type: "text", text }] } : {}),
      };
    }
    if (!node.content) return node;
    if (node.type === "paragraph") return { ...node, content: inlines(node.content) };
    return { ...node, content: node.content.map(blocks) };
  };
  const mapped = mapTrees(document, blocks);
  return next ? { ...mapped, controls } : mapped;
}

/**
 * The document with controls tagged by `customToWord` back as custom nodes and marks.
 * @internal
 */
export function customFromWord(document: FoliDocument): FoliDocument {
  const controls = { ...document.controls };
  const read = (id: unknown): Tagged | null => {
    const tag = typeof id === "string" && Object.hasOwn(controls, id) ? controls[id]?.tag : null;
    if (!tag?.startsWith(PREFIX)) return null;
    try {
      const value = JSON.parse(tag.slice(PREFIX.length)) as Tagged;
      const type = value.node ?? value.mark;
      const attrs = value.attrs;
      const plain =
        attrs === undefined ||
        (typeof attrs === "object" && attrs !== null && !Array.isArray(attrs));
      return typeof type === "string" && isCustom(type) && plain ? value : null;
    } catch {
      return null; // Not ours after all: kept as the control it is.
    }
  };
  const used = new Set<string>();
  const inlines = (items: readonly NodeJSON[]): NodeJSON[] => {
    const out: NodeJSON[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as NodeJSON;
      const id = item.type === "controlStart" ? item.attrs?.id : undefined;
      const value = read(id);
      const end = value
        ? items.findIndex((n, j) => j > i && n.type === "controlEnd" && n.attrs?.id === id)
        : -1;
      if (!value || end < 0) {
        out.push(item);
        continue;
      }
      used.add(id as string);
      const inner = inlines(items.slice(i + 1, end));
      if (value.node) {
        const text = inner.map((n) => n.text ?? "").join("");
        const node = withMarks(
          { type: value.node, ...(value.attrs ? { attrs: value.attrs } : {}) },
          inner[0]?.marks ?? [],
        );
        out.push(withForeignText(node, text));
      } else {
        const mark: MarkJSON = {
          type: value.mark as string,
          ...(value.attrs && { attrs: value.attrs }),
        };
        out.push(...inner.map((n) => withMarks(n, [...(n.marks ?? []), mark])));
      }
      i = end;
    }
    return out;
  };
  const blocks = (node: NodeJSON): NodeJSON => {
    const own = (node.attrs?.controls as string[] | undefined)?.at(-1);
    const value = node.type === "paragraph" ? read(own) : null;
    if (value?.node) {
      used.add(own as string);
      const text = (node.content ?? []).map((n) => n.text ?? "").join("");
      return withForeignText(
        { type: value.node, ...(value.attrs ? { attrs: value.attrs } : {}) },
        text,
      );
    }
    if (!node.content) return node;
    if (node.type === "paragraph") return { ...node, content: inlines(node.content) };
    return { ...node, content: node.content.map(blocks) };
  };
  const mapped = mapTrees(document, blocks);
  if (!used.size) return document;
  for (const id of used) delete controls[id];
  const { controls: _, ...rest } = mapped;
  return Object.keys(controls).length ? { ...rest, controls } : rest;
}
