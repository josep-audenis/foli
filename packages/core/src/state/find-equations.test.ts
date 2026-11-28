import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { createDocument, SCHEMA_VERSION } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { equationText, findAll } from "./find.js";

const eq = (inner: string): NodeJSON => ({
  type: "opaqueInline",
  attrs: { xml: `<m:oMath>${inner}</m:oMath>`, label: "equation" },
});
const r = (t: string) => `<m:r><m:t>${t}</m:t></m:r>`;
const editorOf = (content: NodeJSON[]) =>
  createEditor({
    document: {
      ...createDocument(),
      schemaVersion: SCHEMA_VERSION,
      content: { type: "doc", content: [{ type: "paragraph", content }] },
    },
  });

describe("find in equations (35.4)", () => {
  it("reads an equation's characters, entities and arrays' alignment marks", () => {
    expect(equationText(`<m:oMath>${r("a&lt;b&#x3b1;&#946;")}</m:oMath>`)).toBe("a<bαβ");
    expect(
      equationText(
        `<m:oMath><m:eqArr><m:e>${r("x&amp;=1")}</m:e></m:eqArr>${r("&amp;")}</m:oMath>`,
      ),
    ).toBe("x=1&");
    // A bad reference is dropped, not thrown.
    expect(equationText(`<m:oMath>${r("&#X41;&#0;")}</m:oMath>`)).toBe("&#X41;");
    const deleted = `<m:oMath>${r("a")}<w:del w:id="1">${r("q")}</w:del></m:oMath>`;
    expect(equationText(deleted)).toBe("aq");
    expect(equationText(deleted, true)).toBe("a");
  });

  it("finds them, and an empty one still parts the words around it", () => {
    const editor = editorOf([
      { type: "text", text: "a" },
      eq(""),
      { type: "text", text: "b " },
      eq(r("x=2")),
    ]);
    expect(findAll(editor, "ab")).toHaveLength(0);
    expect(findAll(editor, "x=2")).toHaveLength(1);
  });
});
