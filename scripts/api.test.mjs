import { describe, expect, it } from "vitest";
import { declared, internalImports, problems, report } from "./api.mjs";

describe("api report", () => {
  it("joins the .d.ts files in path order without source-map comments", () => {
    const text = report("@folijs/x", [
      { path: "b.d.ts", text: "export declare const b: 1;\r\n//# sourceMappingURL=b.d.ts.map" },
      { path: "a/z.d.ts", text: "export declare const z: 2;\n//# sourceMappingURL=z.d.ts.map\n" },
    ]);
    expect(text).toContain(
      "// a/z.d.ts\nexport declare const z: 2;\n\n// b.d.ts\nexport declare const b: 1;\n",
    );
    expect(text).not.toContain("sourceMappingURL");
    expect(text).not.toContain("\r");
  });

  it("reads declared exports, not re-exports or commented ones", () => {
    const text = [
      "/** export function inComment(): void; */",
      "export declare function f(): void;",
      "export declare function f(x: number): void;",
      "export interface I {}",
      "export type T = 1;",
      "export declare abstract class C {}",
      "export declare const enum E { A }",
      "declare const local = 1;",
      "export { local as renamed };",
      'export { other } from "./other.js";',
    ].join("\n");
    expect(declared(text)).toEqual(["f", "f", "I", "T", "C", "E", "renamed"]);
  });

  it("finds forgotten exports and `export *` in an entry", () => {
    const files = [
      {
        path: "index.d.ts",
        text: 'export { a, type B as Bee } from "./mod.js";\nexport * from "./x.js";',
      },
      { path: "internal.d.ts", text: 'export { c } from "./mod.js";' },
      {
        path: "mod.d.ts",
        text: "export declare const a: 1;\nexport interface B {}\nexport declare const c: 2;\nexport declare const d: 3;",
      },
    ];
    expect(problems(files, ["index.d.ts", "internal.d.ts"])).toEqual([
      "index.d.ts: `export *` in an entry; list the names",
      "mod.d.ts: `d` is exported by its module but by no entry; export it from an entry or tag it @internal",
    ]);
  });

  it("finds public types that import the internal entry, through relative imports", () => {
    const files = [
      { path: "index.d.ts", text: 'export { render, type Options } from "./word/pages.js";' },
      {
        path: "word/pages.d.ts",
        text: 'import type { Options } from "./blocks.js";\nexport declare function render(o: Options): void;',
      },
      {
        path: "word/blocks.d.ts",
        text: 'import type { Resolver } from "@folijs/core/internal";\nexport interface Options { resolver?: Resolver }',
      },
      { path: "clipboard.d.ts", text: 'import type { WordContext } from "@folijs/core/internal";' },
    ];
    expect(internalImports(files, "index.d.ts")).toEqual(["word/blocks.d.ts"]);
  });
});
