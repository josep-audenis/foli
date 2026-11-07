// @vitest-environment node
import { createDocument } from "@folijs/core";
import { useEffect } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsomorphicLayoutEffect } from "./editor.js";
import { FoliCanvas, FoliEditor, FoliEditorProvider, FoliToolbar, useFoliEditor } from "./index.js";

const doc = createDocument({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
});

function Composed() {
  const editor = useFoliEditor({ initialContent: doc });
  return (
    <FoliEditorProvider editor={editor}>
      <FoliToolbar />
      <FoliCanvas label="Body" />
    </FoliEditorProvider>
  );
}

describe("server rendering (Node, no DOM)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs layout effects as plain effects: React 18 warns about layout effects on the server", () => {
    expect(useIsomorphicLayoutEffect).toBe(useEffect);
  });

  it("imports and renders FoliEditor to a string without warnings", () => {
    expect(typeof document).toBe("undefined");
    const warnings = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const html = renderToString(<FoliEditor initialContent={doc} label="Notes" />);
    // The shell: the toolbar and an empty editable area, filled by the view on hydration.
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('role="textbox"');
    expect(html).toContain('aria-label="Notes"');
    expect(html).not.toContain("Hello");
    expect(renderToString(<Composed />)).toContain('aria-label="Body"');
    for (const spy of warnings) expect(spy).not.toHaveBeenCalled();
  });
});
