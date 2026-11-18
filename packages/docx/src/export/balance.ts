/**
 * Fields and inline content controls as an edit can leave them, made writable (ADR-0007). A field
 * part without its partner is dropped, with the code of a field that lost its end, so the code
 * never becomes text; the result stays. An inline control a paragraph split runs over becomes one
 * control per paragraph, as `w:sdt` cannot cross a paragraph; ends without a partner are dropped
 * when written.
 */
import type { FoliDocument, NodeJSON } from "@folijs/core";
import type { DocxPackage } from "../package.js";

function paragraphsOf(nodes: readonly NodeJSON[], out: NodeJSON[] = []): NodeJSON[] {
  for (const node of nodes) {
    if (node.type === "paragraph") out.push(node);
    else if (node.content) paragraphsOf(node.content, out);
  }
  return out;
}

function balanceFields(paragraphs: readonly NodeJSON[]): void {
  const drop = new Set<NodeJSON>();
  const open: NodeJSON[][] = [];
  for (const paragraph of paragraphs) {
    for (const node of paragraph.content ?? []) {
      if (node.type === "fieldStart") open.push([node]);
      else if (node.type === "fieldCode" || node.type === "fieldSeparator") {
        const field = open.at(-1);
        if (field) field.push(node);
        else drop.add(node);
      } else if (node.type === "fieldEnd" && !open.pop()) drop.add(node);
    }
  }
  for (const field of open) for (const node of field) drop.add(node);
  if (!drop.size) return;
  for (const paragraph of paragraphs)
    if (paragraph.content) paragraph.content = paragraph.content.filter((n) => !drop.has(n));
}

function balanceControls(paragraphs: readonly NodeJSON[]): void {
  const endsLeft = new Map<unknown, number>();
  const ends = (paragraph: NodeJSON) =>
    (paragraph.content ?? []).filter((n) => n.type === "controlEnd");
  for (const paragraph of paragraphs)
    for (const end of ends(paragraph))
      endsLeft.set(end.attrs?.id, (endsLeft.get(end.attrs?.id) ?? 0) + 1);
  if (!endsLeft.size) return;
  let open: unknown[] = [];
  for (const paragraph of paragraphs) {
    const content: NodeJSON[] = open.map(
      (id) => ({ type: "controlStart", attrs: { id } }) as NodeJSON,
    );
    const here = [...open];
    for (const node of paragraph.content ?? []) {
      content.push(node);
      const id = node.attrs?.id;
      if (node.type === "controlStart") here.push(id);
      else if (node.type === "controlEnd") {
        endsLeft.set(id, (endsLeft.get(id) as number) - 1);
        const at = here.lastIndexOf(id);
        if (at >= 0) here.splice(at, 1);
      }
    }
    // Innermost first; a control with no end further on has lost it, and its start is dropped.
    open = here.filter((id) => (endsLeft.get(id) ?? 0) > 0);
    for (const id of [...open].reverse())
      content.push({ type: "controlEnd", attrs: { id } } as NodeJSON);
    if (content.length) paragraph.content = content;
  }
}

/** Whether the field characters of a part's XML open and close properly. */
function fieldsWhole(xml: string): boolean {
  let depth = 0;
  for (const [, type] of xml.matchAll(/fldCharType\s*=\s*["'](begin|separate|end)["']/g)) {
    if (type === "begin") depth++;
    else if (depth === 0) return false;
    else if (type === "end") depth--;
  }
  return depth === 0;
}

/** Whether content kept verbatim among `nodes` holds field characters. */
function holdsVerbatimField(nodes: readonly NodeJSON[]): boolean {
  return nodes.some(
    (node) =>
      (typeof node.attrs?.xml === "string" && node.attrs.xml.includes("fldChar")) ||
      holdsVerbatimField(node.content ?? []),
  );
}

/**
 * `doc` (a validated copy, changed in place) with its fields and inline controls writable. Field
 * parts are only repaired where an edit can be what broke them: not in a package holding broken
 * fields of its own (Word reads those in its way), nor where verbatim content holds field
 * characters, whose partners the model cannot see.
 */
export function balanced(doc: FoliDocument, original?: DocxPackage): FoliDocument {
  const packageWhole =
    !original ||
    original.parts
      .filter((part) => /^\/word\/[^/]+\.xml$/.test(part.name))
      .every((part) => fieldsWhole(original.text(part.name)));
  const trees = [
    doc.content.content ?? [],
    ...doc.comments.map((c) => c.content),
    ...Object.values(doc.stories ?? {}).map((s) => s.content.content ?? []),
  ];
  for (const tree of trees) {
    const paragraphs = paragraphsOf(tree);
    if (packageWhole && !holdsVerbatimField(tree)) balanceFields(paragraphs);
    balanceControls(paragraphs);
  }
  return doc;
}
