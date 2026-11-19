import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

const spec = fileURLToPath(new URL("./src/spec.ts", import.meta.url)).replaceAll("\\", "/");

/**
 * The spike's stand-in for what 12.3 and 12.4 build, patched into the packages' source as it is
 * served (the files on disk do not change): the Word schema with the extension's types added,
 * and the editing renderer asking `globalThis.__foliSpikeViews` how to draw a custom node or
 * mark. A patch whose anchor is gone fails loudly instead of running the packages unpatched.
 */
const PATCHES: { file: string; edits: [RegExp, string][]; append?: string }[] = [
  {
    file: "/packages/core/src/v3/schema.ts",
    edits: [[/export const schema = new Schema\(\{/, "const wordSchema = new Schema({"]],
    append: `
import { extension as __extension } from ${JSON.stringify(spec)};
export const schema = new Schema({
  nodes: { ...wordSchema.spec.nodes, ...__extension.nodes },
  marks: { ...wordSchema.spec.marks, ...__extension.marks },
});
`,
  },
  {
    file: "/packages/view/src/word/edit.ts",
    edits: [
      [
        /(styleRun\(span, run, line\(run\)\);\n)(\s+return span;)/,
        "$1    for (const m of marks) (globalThis as any).__foliSpikeViews?.marks?.[m.type.name]?.(m.attrs, span);\n$2",
      ],
      [
        /(\n\s+default: \{\n)(\s+\/\/ A field's code and braces)/,
        `$1          const draw = (globalThis as any).__foliSpikeViews?.nodes?.[name];
          if (draw) {
            const span = this.#run(run, child.marks, line);
            draw(child.attrs, span);
            span.setAttribute("contenteditable", "false");
            leafElement(span);
            return;
          }
$2`,
      ],
    ],
  },
];

const patch: Plugin = {
  name: "foli-spike-extension",
  enforce: "pre",
  transform(code, id) {
    const target = PATCHES.find((p) => id.replaceAll("\\", "/").endsWith(p.file));
    if (!target) return null;
    let out = code;
    for (const [anchor, replacement] of target.edits) {
      if (!anchor.test(out)) throw new Error(`spike patch: ${anchor} not found in ${target.file}`);
      out = out.replace(anchor, replacement);
    }
    return out + (target.append ?? "");
  },
};

export default defineConfig({
  plugins: [patch],
  resolve: { conditions: ["@folijs/source", ...defaultClientConditions] },
});
