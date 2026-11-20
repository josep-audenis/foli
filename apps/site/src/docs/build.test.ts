import { describe, expect, it } from "vitest";
import { GITHUB, markdown, parseReport, resolveImage, resolveLink, slug } from "./build.js";

describe("docs build", () => {
  it("makes GitHub's heading ids, numbering repeats", () => {
    const seen = new Map<string, number>();
    expect(slug("Editing engine (`@folijs/core`)".replace(/`/g, ""), seen)).toBe(
      "editing-engine-folijscore",
    );
    expect(slug("Gate G4: passed provisionally (2026-11-07)", seen)).toBe(
      "gate-g4-passed-provisionally-2026-11-07",
    );
    expect(slug("Word pages (packages/view/src/word, 8.6b)", seen)).toBe(
      "word-pages-packagesviewsrcword-86b",
    );
    expect(slug("Install", seen)).toBe("install");
    expect(slug("Install", seen)).toBe("install-1");
  });

  it("links a page of the site there, any other file to GitHub, and the web as it is", () => {
    const urls = new Map([
      ["docs/limitations.md", "/docs/limitations/"],
      [
        "docs/decisions/ADR-0002-own-editing-engine.md",
        "/docs/decisions/ADR-0002-own-editing-engine/",
      ],
    ]);
    const from = "docs/decisions/ADR-0005-word-compatible-model.md";
    expect(resolveLink("../limitations.md#pictures", from, urls)).toEqual({
      href: "/docs/limitations/#pictures",
      page: "/docs/limitations/",
      hash: "pictures",
    });
    expect(resolveLink("ADR-0002-own-editing-engine.md", from, urls)?.href).toBe(
      "/docs/decisions/ADR-0002-own-editing-engine/",
    );
    expect(resolveLink("../../packages/docx/README.md", from, urls)?.href).toBe(
      `${GITHUB}packages/docx/README.md`,
    );
    expect(resolveLink("https://example.com/a.md", from, urls)?.href).toBe(
      "https://example.com/a.md",
    );
    expect(resolveLink("#top", from, urls)).toEqual({ href: "#top", hash: "top" });
    expect(resolveLink("mailto:a@example.com", from, urls)?.href).toBe("mailto:a@example.com");
    expect(resolveLink("JavaScript:alert(1)", from, urls)).toBeNull();
    expect(resolveLink("data:text/html,<b>x</b>", from, urls)).toBeNull();
    expect(() => resolveLink("%E0%A4%A.md", from, urls)).toThrow(/ADR-0005.*malformed/);
  });

  it("renders headings with ids, rewrites links, and shows raw HTML as text", () => {
    const ctx = {
      from: "docs/api.md",
      url: "/docs/api/",
      urls: new Map([["docs/keyboard.md", "/docs/keyboard/"]]),
      headings: [],
      anchors: [],
      seen: new Map(),
    };
    const html = markdown(
      "# Keys\n\nSee [keys](keyboard.md#reserved).\n\n<script>alert(1)</script>\n",
      ctx,
    );
    expect(html).toContain('<h1 id="keys">Keys</h1>');
    expect(html).toContain('<a href="/docs/keyboard/#reserved">keys</a>');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(ctx.anchors).toEqual([{ from: "/docs/api/", url: "/docs/keyboard/", hash: "reserved" }]);
  });

  it("shows links and images with unsafe URLs as text; relative images come from GitHub", () => {
    const ctx = {
      from: "docs/styling.md",
      url: "/docs/styling/",
      urls: new Map(),
      headings: [],
      anchors: [],
      seen: new Map(),
    };
    const html = markdown(
      "[x](javascript:alert(1)) <javascript:alert(2)> [d](data:text/html,hi) " +
        "![i](javascript:alert(3)) ![shot](../corpus/a.png) ![web](https://example.com/b.png)",
      ctx,
    );
    expect(html).not.toMatch(/href="(javascript|data):|src="javascript:/i);
    expect(html).toContain(">x ");
    expect(html).toContain("javascript:alert(2)");
    expect(html).toContain(
      '<img src="https://raw.githubusercontent.com/josep-audenis/foli/main/corpus/a.png" alt="shot" />',
    );
    expect(html).toContain('<img src="https://example.com/b.png" alt="web" />');
    expect(resolveImage("data:image/png;base64,AAAA", "docs/a.md")).toBeNull();
  });

  it("gives a heading with inline HTML GitHub's id", () => {
    const ctx = {
      from: "docs/a.md",
      url: "/docs/a/",
      urls: new Map(),
      headings: [],
      anchors: [],
      seen: new Map(),
    };
    expect(markdown("## Pages <br> and notes", ctx)).toContain('id="pages--and-notes"');
  });

  it("splits an API report into declarations with their docs, overloads together", () => {
    const report = [
      "// API report of @folijs/x: generated.",
      "",
      "// a.d.ts",
      'import type { Y } from "./y.js";',
      "/** What X is. */",
      "export interface X {",
      "    /** A member. */",
      "    a: number;",
      "}",
      "/**",
      " * Makes one.",
      " */",
      "export declare function make(): X;",
      "export declare function make(n: number): X;",
      "interface Local {",
      "}",
      "export type U = {",
      "    k: 1;",
      "} | {",
      "    k: 2;",
      "};",
      "",
      "// index.d.ts",
      'export { make, type U, type X } from "./a.js";',
    ].join("\n");
    const { declarations, entries } = parseReport(report);
    expect(declarations.map((d) => [d.name, d.doc])).toEqual([
      ["X", "What X is."],
      ["make", "Makes one."],
      ["Local", ""],
      ["U", ""],
    ]);
    expect(declarations[0]?.code).toBe(
      "export interface X {\n    /** A member. */\n    a: number;\n}",
    );
    expect(declarations[1]?.code.split("\n")).toHaveLength(2);
    expect(declarations[3]?.code).toContain("} | {");
    expect(entries.get("index.d.ts")).toEqual(["make", "U", "X"]);
  });
});
