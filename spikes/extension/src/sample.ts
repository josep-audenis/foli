/** Documents for the spike's tests and Word round trip, built as JSON as an app would. */
import type { ControlJSON } from "@folijs/core";
import { createDocument, type FoliDocument, type NodeJSON } from "@folijs/core";
import { isCustom } from "./docx.js";
import { MENTION, TOPIC } from "./spec.js";

const text = (value: string, marks?: NodeJSON["marks"]): NodeJSON => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
export const mention = (id: string, label: string, marks?: NodeJSON["marks"]): NodeJSON => ({
  type: MENTION,
  attrs: { id, label },
  ...(marks ? { marks } : {}),
});
const topic = (value: string) => ({ type: TOPIC, attrs: { topic: value } });
const bold = { type: "bold" };

/** A document only an editor with the extension takes: a mention, a topic, both in a cell. */
export function sample(): FoliDocument {
  const cell = (content: NodeJSON[]): NodeJSON => ({
    type: "tableCell",
    content: [{ type: "paragraph", content }],
  });
  return createDocument({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          text("Ask "),
          mention("u-42", "Ada Lovelace"),
          text(" about the "),
          text("budget", [topic("finance")]),
          text(" and "),
          text("plan", [bold, topic("finance")]),
          text("."),
        ],
      },
      {
        type: "table",
        attrs: { grid: [4000, 4000] },
        content: [
          {
            type: "tableRow",
            content: [
              cell([mention("u-7", "Grace", [bold])]),
              cell([text("roadmap", [topic("product-2027")])]),
            ],
          },
        ],
      },
      { type: "paragraph" },
    ],
  });
}

/**
 * The custom nodes and the text under custom marks, in order, with all their marks (bold on a
 * mention too): what must come back.
 */
export function customs(tree: NodeJSON): unknown[] {
  const found: unknown[] = [];
  const walk = (node: NodeJSON) => {
    // `runExt` is the `w:rPr` an import keeps verbatim, not formatting of its own.
    const marks = (node.marks ?? []).filter((m) => m.type !== "runExt");
    if (isCustom(node.type)) found.push({ node: node.type, attrs: node.attrs, marks });
    else if (marks.some((m) => isCustom(m.type))) found.push({ text: node.text, marks });
    node.content?.forEach(walk);
  };
  walk(tree);
  return found;
}

/** A mention whose tag is 255 characters, the most a control's tag holds in Foli. */
export function longTag(): FoliDocument {
  const base = `foli:${JSON.stringify({ node: MENTION, attrs: { id: "u-1", label: "" } })}`;
  const label = "Long label ".repeat(30).slice(0, 255 - base.length);
  return createDocument({
    type: "doc",
    content: [{ type: "paragraph", content: [text("Tag "), mention("u-1", label)] }],
  });
}

/** A document's inline content controls in order, as Word's `ContentControls` reports them. */
export function controlsOf(document: FoliDocument): {
  type: number;
  tag: string | undefined;
  text: string;
  lockContents: boolean;
}[] {
  const controls: Record<string, ControlJSON> = document.controls ?? {};
  const found: ReturnType<typeof controlsOf> = [];
  const open = new Map<string, number>();
  const walk = (node: NodeJSON) => {
    const id = String(node.attrs?.id);
    if (node.type === "controlStart") {
      const control = controls[id];
      open.set(id, found.length);
      found.push({
        // Word's WdContentControlType: 0 rich text, 1 plain text.
        type: control?.kind === "text" ? 1 : 0,
        tag: control?.tag,
        text: "",
        lockContents: control?.lock === "contentLocked" || control?.lock === "sdtContentLocked",
      });
    } else if (node.type === "controlEnd") open.delete(id);
    else if (node.text)
      for (const i of open.values()) (found[i] as { text: string }).text += node.text;
    node.content?.forEach(walk);
  };
  walk(document.content);
  return found;
}
