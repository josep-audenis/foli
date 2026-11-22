// Writes the format fixtures (0.x, and 1.x minors that add one), each saved by the release that wrote that schema version, from
// its git tag: `node packages/core/fixtures/formats/generate.mjs` (then `pnpm format`). The
// fixtures stand for documents already saved: run this only to add a format, never to "update"
// one. See README.md here.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const out = import.meta.dirname;
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
const work = mkdtempSync(join(tmpdir(), "foli-formats-"));
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 1 << 28 });

/** A package's `src` at `tag`, compiled to `<dir>/out` (type errors of old code ignored). */
function compile(tag, pkg, dir) {
  for (const file of git("ls-tree", "-r", "--name-only", tag, `packages/${pkg}/src`)
    .toString()
    .split("\n")
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), git("show", `${tag}:${file}`));
  }
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "es2022",
        module: "nodenext",
        moduleResolution: "nodenext",
        outDir: "out",
        rootDir: `packages/${pkg}/src`,
        skipLibCheck: true,
        noEmitOnError: false,
        types: [],
        lib: ["es2023", "dom"],
      },
      include: [`packages/${pkg}/src`],
      exclude: ["**/*.test.ts"],
    }),
  );
  try {
    execFileSync(process.execPath, [tsc, "-p", dir], { stdio: "ignore" });
  } catch {} // old code against today's compiler: errors, but the JavaScript is written
  return pathToFileURL(join(dir, "out", "index.js")).href;
}

/** That release's core, and its docx with that core as `@folijs/core`. */
async function release(version, docx) {
  const core = compile(`@folijs/core@${version}`, "core", join(work, `core-${version}`));
  if (!docx) return { core: await import(core) };
  const dir = join(work, `docx-${version}`);
  const linked = join(dir, "node_modules", "@folijs", "core");
  mkdirSync(linked, { recursive: true });
  cpSync(join(work, `core-${version}`, "out"), linked, { recursive: true });
  writeFileSync(
    join(linked, "package.json"),
    '{"name":"@folijs/core","type":"module","main":"index.js"}',
  );
  const url = compile(`@folijs/docx@${version}`, "docx", dir);
  return { core: await import(core), docx: await import(url) };
}

const save = (name, doc) => {
  writeFileSync(join(out, name), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`${name}: schema ${doc.schemaVersion}`);
};
const t = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });

try {
  // v1 (0.1.0): headings, paragraphs, breaks, four marks.
  {
    const { core } = await release("0.1.0");
    const doc = core.createDocument(
      {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [t("Quarterly notes")] },
          { type: "heading", attrs: { level: 3 }, content: [t("Summary")] },
          {
            type: "paragraph",
            content: [
              t("Plain, "),
              t("bold", [{ type: "bold" }]),
              t(", "),
              t("bold italic", [{ type: "bold" }, { type: "italic" }]),
              t(", "),
              t("underlined", [{ type: "underline" }]),
              t(" and "),
              t("struck", [{ type: "strike" }]),
              { type: "hardBreak" },
              t("after a break; é 😀"),
              { type: "pageBreak", marks: [{ type: "italic" }] },
            ],
          },
          { type: "paragraph" },
          { type: "heading", attrs: { level: 6 }, content: [t("Last")] },
        ],
      },
      { pageSize: { width: 215.9, height: 279.4 } },
    );
    save("v1.json", core.parseDocument(JSON.parse(JSON.stringify(doc))));
  }

  // v2 (0.2.0): alignment, lists, rules, links, colors.
  {
    const { core } = await release("0.2.0");
    const item = (...content) => ({ type: "listItem", content });
    const p = (text, attrs) => ({ type: "paragraph", ...(attrs && { attrs }), content: [t(text)] });
    const doc = core.createDocument(
      {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2, align: "center" }, content: [t("Title")] },
          {
            type: "paragraph",
            attrs: { align: "justify" },
            content: [
              t("a link", [
                { type: "link", attrs: { href: "https://example.com/x" } },
                { type: "bold" },
              ]),
              t(" red on yellow", [
                { type: "underline" },
                { type: "textColor", attrs: { color: "#c00000" } },
                { type: "highlight", attrs: { color: "#fff2cc" } },
              ]),
              { type: "hardBreak" },
              t("mail", [{ type: "link", attrs: { href: "mailto:a@example.com" } }]),
              { type: "pageBreak" },
            ],
          },
          { type: "horizontalRule" },
          {
            type: "orderedList",
            attrs: { start: 3 },
            content: [
              item(
                p("three"),
                p("more of three"),
                {
                  type: "orderedList",
                  content: [item(p("3.a")), item(p("3.b", { align: "end" }))],
                },
                { type: "bulletList", content: [item(p("bullet"), { type: "horizontalRule" })] },
              ),
              item(p("four")),
            ],
          },
          { type: "bulletList", content: [item(p("top bullet"))] },
          p("end", { align: "start" }),
        ],
      },
      {
        pageSize: { width: 297, height: 210 },
        margins: { top: 20, right: 25.4, bottom: 20, left: 25.4 },
      },
    );
    save("v2.json", core.parseDocument(JSON.parse(JSON.stringify(doc))));
  }

  // v3 (0.3.0), v4 (0.5.0), v5 (0.6.0): corpus files as that release's @folijs/docx read them.
  for (const [version, files] of [
    ["0.3.0", ["02-services-agreement-redlined"]],
    ["0.5.0", ["04-board-report"]],
    ["0.6.0", ["09-pump-test-memo", "03-offer-letter-template"]],
  ]) {
    const { core, docx } = await release(version, true);
    for (const file of files) {
      const bytes = new Uint8Array(git("show", `@folijs/core@${version}:corpus/word/${file}.docx`));
      const { document } = await docx.importDocx(bytes);
      const parsed = core.parseDocument(JSON.parse(JSON.stringify(document)));
      save(`v${parsed.schemaVersion}-${file}.json`, parsed);
    }
  }

  // v6 (1.4.0): a picture rotated and cropped by 1.4.0's own commands, saved by its editor.
  {
    const { core } = await release("1.4.0");
    const dot =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
    const editor = core.createEditor({
      document: core.createDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [t("A rotated, cropped picture: ")] }],
      }),
    });
    editor.select(29);
    editor.run(
      core.insertPicture({
        contentType: "image/png",
        data: dot,
        width: 914400,
        height: 457200,
        alt: "A dot",
      }),
    );
    editor.run(core.setPictureRotation(29, 5_400_000));
    editor.run(core.setPictureCrop(29, { left: 10000, top: 5000, right: 10000, bottom: 5000 }));
    save("v6.json", core.parseDocument(JSON.parse(JSON.stringify(editor.getDocument()))));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
