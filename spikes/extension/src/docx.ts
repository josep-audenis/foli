/**
 * Custom nodes and marks in `.docx` (ADR-0008), on the document's JSON so that the packages need
 * no change: before `exportDocx`, each custom node becomes an inline plain text content control
 * (`w:sdt` with `w:text`, contents locked) showing its text, and each run of a custom mark a rich
 * text control around that text; the tag is `foli:` and the type and attributes as JSON. After
 * `importDocx`, controls tagged so become the node or mark again. Generic: no code per type but
 * the text a node shows. A file read without this keeps the controls: nothing is lost.
 */
import type { ControlJSON, FoliDocument, MarkJSON, NodeJSON } from "@folijs/core";

/** Names with a namespace (`acme:mention`) are custom; Word's types never have one. */
export const isCustom = (type: string): boolean => type.includes(":");
const PREFIX = "foli:";
/** `ControlJSON.tag` holds at most 255 characters (`checkControl`). */
const MAX_TAG = 255;

/** What a tag holds: a node's or a mark's type, and its attributes. */
interface Tagged {
  node?: string;
  mark?: string;
  attrs?: Record<string, unknown>;
}

function tagOf(value: Tagged): string {
  const tag = PREFIX + JSON.stringify(value);
  if (tag.length > MAX_TAG)
    throw new RangeError(
      `${value.node ?? value.mark}: its attributes do not fit a tag (${tag.length} > ${MAX_TAG})`,
    );
  return tag;
}

const sameMark = (a: MarkJSON, b: MarkJSON) =>
  a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
const withMarks = (node: NodeJSON, marks: MarkJSON[]): NodeJSON => {
  const { marks: _, ...rest } = node;
  return marks.length ? { ...rest, marks } : rest;
};

/** Every content tree of a document: the body, the stories, the comments' blocks. */
function mapTrees(document: FoliDocument, map: (tree: NodeJSON) => NodeJSON): FoliDocument {
  return {
    ...document,
    content: map(document.content),
    comments: document.comments.map((c) => ({
      ...c,
      content: (map({ type: "doc", content: c.content }).content ?? []) as typeof c.content,
    })),
    ...(document.stories
      ? {
          stories: Object.fromEntries(
            Object.entries(document.stories).map(([id, s]) => [
              id,
              { ...s, content: map(s.content) },
            ]),
          ),
        }
      : {}),
  };
}

/** The document with its custom nodes and marks as tagged content controls. */
export function toWord(document: FoliDocument, text: (node: NodeJSON) => string): FoliDocument {
  const controls: Record<string, ControlJSON> = { ...document.controls };
  let next = 0;
  const add = (control: ControlJSON) => {
    let id: string;
    do id = `foli-${++next}`;
    while (Object.hasOwn(controls, id));
    controls[id] = control;
    return id;
  };
  const inlines = (items: NodeJSON[]): NodeJSON[] => {
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
        const id = add({
          kind: "richText",
          tag: tagOf({ mark: mark.type, attrs: mark.attrs ?? {} }),
        });
        out.push(marker("controlStart", id), ...inlines(inner), marker("controlEnd", id));
        i = j;
        continue;
      }
      if (isCustom(item.type)) {
        const id = add({
          kind: "text",
          tag: tagOf({ node: item.type, attrs: item.attrs ?? {} }),
          lock: "contentLocked",
        });
        out.push(
          marker("controlStart", id),
          withMarks({ type: "text", text: text(item) }, item.marks ?? []),
          marker("controlEnd", id),
        );
      } else out.push(item.content ? { ...item, content: inlines(item.content) } : item);
      i++;
    }
    return out;
  };
  const mapped = mapTrees(document, (tree) => ({ ...tree, content: inlines(tree.content ?? []) }));
  return next ? { ...mapped, controls } : mapped;
}

const marker = (type: "controlStart" | "controlEnd", id: string): NodeJSON => ({
  type,
  attrs: { id },
});

/** The document with controls tagged by `toWord` back as custom nodes and marks. */
export function fromWord(document: FoliDocument): FoliDocument {
  const controls = { ...document.controls };
  const tagged = (node: NodeJSON | undefined): [string, Tagged] | null => {
    if (node?.type !== "controlStart") return null;
    const id = String(node.attrs?.id);
    const tag = controls[id]?.tag;
    if (!tag?.startsWith(PREFIX)) return null;
    try {
      return [id, JSON.parse(tag.slice(PREFIX.length)) as Tagged];
    } catch {
      return null; // Not ours after all: kept as the control it is.
    }
  };
  const inlines = (items: NodeJSON[]): NodeJSON[] => {
    const out: NodeJSON[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as NodeJSON;
      const found = tagged(item);
      const end = found
        ? items.findIndex((n, j) => j > i && n.type === "controlEnd" && n.attrs?.id === found[0])
        : -1;
      if (!found || end < 0) {
        out.push(item.content ? { ...item, content: inlines(item.content) } : item);
        continue;
      }
      const [id, value] = found;
      delete controls[id];
      const inner = inlines(items.slice(i + 1, end));
      if (value.node) {
        out.push(withMarks({ type: value.node, attrs: value.attrs ?? {} }, inner[0]?.marks ?? []));
      } else {
        const mark: MarkJSON = { type: String(value.mark), attrs: value.attrs ?? {} };
        out.push(...inner.map((n) => withMarks(n, [...(n.marks ?? []), mark])));
      }
      i = end;
    }
    return out;
  };
  const mapped = mapTrees(document, (tree) => ({ ...tree, content: inlines(tree.content ?? []) }));
  return { ...mapped, controls };
}
