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
  // How often each control id is used: one used twice (a control split by an edit) stays.
  const uses = new Map<string, number>();
  const count = (node: NodeJSON) => {
    const ids =
      node.type === "controlStart"
        ? [node.attrs?.id]
        : ((node.attrs?.controls as unknown[] | null | undefined) ?? []);
    for (const id of ids) if (typeof id === "string") uses.set(id, (uses.get(id) ?? 0) + 1);
    node.content?.forEach(count);
  };
  mapTrees(document, (tree) => {
    count(tree);
    return tree;
  });
  const read = (id: unknown, kind: ControlJSON["kind"]): Tagged | null => {
    if (typeof id !== "string" || !Object.hasOwn(controls, id) || uses.get(id) !== 1) return null;
    const control = controls[id] as ControlJSON;
    if (control.kind !== kind || control.placeholder?.showing || !control.tag?.startsWith(PREFIX))
      return null;
    try {
      const value = JSON.parse(control.tag.slice(PREFIX.length)) as Tagged;
      const type = kind === "text" ? value.node : value.mark;
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
  const nodeOf = (value: Tagged, text: string, marks: readonly MarkJSON[] = []) =>
    withForeignText(
      withMarks(
        { type: value.node as string, ...(value.attrs ? { attrs: value.attrs } : {}) },
        marks,
      ),
      text,
    );
  /** Text runs alone, all formatted alike: what a node's control holds when nothing else is in it. */
  const plainText = (items: readonly NodeJSON[]) =>
    items.every(
      (n) => n.type === "text" && JSON.stringify(n.marks) === JSON.stringify(items[0]?.marks),
    );
  const inlines = (items: readonly NodeJSON[]): NodeJSON[] => {
    const out: NodeJSON[] = [];
    // Where each control ends, found once: scanning (or copying) the rest of a paragraph per
    // node took minutes on a long one (12.11).
    const ends = new Map<unknown, number[]>();
    items.forEach((n, j) => {
      if (n.type !== "controlEnd") return;
      const list = ends.get(n.attrs?.id);
      if (list) list.push(j);
      else ends.set(n.attrs?.id, [j]);
    });
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as NodeJSON;
      const id = item.type === "controlStart" ? item.attrs?.id : undefined;
      const end = id ? (ends.get(id)?.find((j) => j > i) ?? -1) : -1;
      const inner = end > 0 ? items.slice(i + 1, end) : [];
      // A node's control with text runs only, or a mark's around something: anything else (a
      // bookmark or a field in a node's control, an empty control) stays the control it is.
      const node = end > 0 && plainText(inner) ? read(id, "text") : null;
      const mark = end > 0 && !node && inner.length ? read(id, "richText") : null;
      if (node) {
        out.push(nodeOf(node, inner.map((n) => n.text ?? "").join(""), inner[0]?.marks));
      } else if (mark) {
        const type: MarkJSON = {
          type: mark.mark as string,
          ...(mark.attrs && { attrs: mark.attrs }),
        };
        out.push(...inlines(inner).map((n) => withMarks(n, [...(n.marks ?? []), type])));
      } else {
        out.push(item);
        continue;
      }
      used.add(id as string);
      i = end;
    }
    return out;
  };
  const blocks = (node: NodeJSON): NodeJSON => {
    const own = node.attrs?.controls as string[] | null | undefined;
    // A block node's control holds one paragraph of plain text and nothing of its own: no other
    // control around it, no properties, section or tracked change (Word's ids aside).
    const { controls: _, attributes, ...rest } = (node.attrs ?? {}) as Record<string, unknown>;
    const value =
      node.type === "paragraph" &&
      own?.length === 1 &&
      Object.values(rest).every((v) => v === null || v === undefined) &&
      Object.keys((attributes as object | null) ?? {}).every((k) => WORD_IDS.test(k)) &&
      (node.content ?? []).every((n) => n.type === "text" && !n.marks?.length)
        ? read(own[0], "text")
        : null;
    if (value?.node) {
      used.add(own?.[0] as string);
      return nodeOf(value, (node.content ?? []).map((n) => n.text ?? "").join(""));
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

/** A paragraph's attributes Word sets on every paragraph it saves: ids that say nothing of it. */
const WORD_IDS = /^(w14:paraId|w14:textId|w:rsid\w*)$/;
