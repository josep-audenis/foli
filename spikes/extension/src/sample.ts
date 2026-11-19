/** Documents for the spike's tests and Word round trip, built as JSON as an app would. */
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

/** The custom nodes and the text under custom marks, in order: what must come back. */
export function customs(tree: NodeJSON): unknown[] {
  const found: unknown[] = [];
  const walk = (node: NodeJSON) => {
    const marks = (node.marks ?? []).filter((m) => isCustom(m.type));
    if (isCustom(node.type)) found.push({ node: node.type, attrs: node.attrs, marks });
    else if (marks.length) found.push({ text: node.text, marks });
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
