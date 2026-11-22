import type { BlockJSON, FoliDocumentV2, InlineJSON } from "@folijs/core";

type ParagraphJSON = Extract<BlockJSON, { type: "paragraph" }>;
type ListItemJSON = Extract<BlockJSON, { type: "bulletList" }>["content"][number];

const t = (text: string, ...marks: ("bold" | "italic")[]): InlineJSON =>
  marks.length
    ? { type: "text", text, marks: marks.map((type) => ({ type })) }
    : { type: "text", text };
const p = (...content: InlineJSON[]): ParagraphJSON => ({ type: "paragraph", content });
const h = (level: 1 | 2, text: string): BlockJSON => ({
  type: "heading",
  attrs: { level },
  content: [t(text)],
});
const li = (...content: InlineJSON[]): ListItemJSON => ({
  type: "listItem",
  content: [p(...content)],
});

/**
 * The hero's document: A5 pages so several fit on screen and the text visibly flows from one
 * to the next. Written as schema v2 (0.2.0), migrated to Word's model on load like a saved one.
 */
export const sample: FoliDocumentV2 = {
  schemaVersion: 2,
  settings: {
    pageSize: { width: 148, height: 210 },
    margins: { top: 18, right: 18, bottom: 18, left: 18 },
  },
  content: {
    type: "doc",
    content: [
      h(1, "On pages"),
      p(
        t(
          "A web page scrolls forever. A document does not: it has a size, margins, and a last line before the next page begins. Foli lays out the second kind, in the browser, ",
        ),
        {
          type: "text",
          text: "as you type",
          marks: [{ type: "highlight", attrs: { color: "#fff59d" } }],
        },
        t("."),
      ),
      h(2, "Try it"),
      {
        type: "bulletList",
        content: [
          li(t("Type at the end of this page and watch its last line move to the next one.")),
          li(
            t("Select a word and press "),
            t("Ctrl+B", "bold"),
            t(", or "),
            t("Cmd+B", "bold"),
            t(" on a Mac."),
          ),
          li(
            t("Turn on "),
            t("Track changes", "italic"),
            t(" in the toolbar, then delete a sentence."),
          ),
        ],
      },
      p(
        t(
          "Every page here is A5: 148 by 210 millimetres, with 18 mm margins. The size lives in the document, not in a stylesheet, so it is the same on screen, in print and in the .docx you export.",
        ),
      ),
      h(2, "Rules typesetters care about"),
      p(
        t("A paragraph may break across pages at a line, never inside one. "),
        t("Widow and orphan control", "bold"),
        t(" keeps a single line from being stranded at the top or bottom of a page. "),
        t("Keep with next", "bold"),
        t(" holds a heading together with the paragraph after it, and "),
        t("keep lines together", "bold"),
        t(" moves a whole paragraph instead of splitting it."),
      ),
      {
        type: "paragraph",
        attrs: { align: "justify" },
        content: [
          t(
            "These are Word's rules, applied the way Word applies them, because most documents people edit are Word documents. Foli reads a .docx into a model shaped like Word's own: paragraph styles, numbering, runs with their formatting. What it does not model yet is kept as it was and written back on export.",
          ),
        ],
      },
      h(2, "Under the hood"),
      p(
        t(
          "There is no third-party editor engine underneath. Foli has its own document model, transactions with undo, a view that maps the screen back to positions, and a layout engine that measures real line boxes. When a line moves to the next page, the engine moved it.",
        ),
      ),
      p(t("This is the end of the sample. Keep typing: the pages keep coming.", "italic")),
    ],
  },
};
