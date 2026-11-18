import { readdirSync, readFileSync } from "node:fs";
import type { FoliDocument, NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx, readPackage } from "./index.js";
import { docx } from "./testing/package.js";

/** Fields and content controls in `.docx` (11.5, ADR-0007). */

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const names = readdirSync(CORPUS).filter((n) => n.endsWith(".docx"));
const load = (name: string) => importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))));

const read = async (body: string) => importDocx(await docx(body));
const blocksOf = async (body: string) => (await read(body)).document.content.content ?? [];
const types = (p: NodeJSON | undefined) => (p?.content ?? []).map((n) => n.type);
const written = async (document: FoliDocument, pkg: Parameters<typeof exportDocx>[1]) =>
  (await readPackage(await exportDocx(document, pkg))).text("/word/document.xml");
const SDT_PR =
  '<w:sdtPr><w:alias w:val="Name"/><w:tag w:val="name"/><w:id w:val="7"/><w:text/></w:sdtPr>';
const sdt = (inner: string, pr = SDT_PR) =>
  `<w:sdt>${pr}<w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const p = (inner: string) => `<w:p>${inner}</w:p>`;

describe("fields", () => {
  it("reads a complex field as its parts, the result as text", async () => {
    const [block] = await blocksOf(
      p(
        '<w:r><w:fldChar w:fldCharType="begin" w:dirty="1"/></w:r>' +
          '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          run("3") +
          '<w:r><w:fldChar w:fldCharType="end" /></w:r>',
      ),
    );
    expect(types(block)).toEqual(["fieldStart", "fieldCode", "fieldSeparator", "text", "fieldEnd"]);
    expect(block?.content?.[0]?.attrs).toEqual({ dirty: true });
    expect(block?.content?.[1]?.attrs).toEqual({ text: " PAGE " });
  });

  it("keeps a form field's data, nested fields and a field without a separator", async () => {
    const data = '<w:ffData><w:name w:val="f"/></w:ffData>';
    const begin = `<w:r><w:fldChar w:fldCharType="begin">${data}</w:fldChar></w:r>`;
    const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const code = (t: string) => `<w:r><w:instrText>${t}</w:instrText></w:r>`;
    const body = p(begin + code("IF ") + begin + code("MERGEFIELD x") + end + end);
    const { document, package: pkg } = await read(body);
    const nodes = document.content.content?.[0]?.content ?? [];
    expect(nodes.filter((n) => n.type === "fieldStart")).toHaveLength(2);
    expect(nodes.some((n) => n.type === "fieldSeparator")).toBe(false);
    expect(await written(document, pkg)).toContain(data);
  });

  it("writes a simple field back as one, with a changed instruction too", async () => {
    const { document, package: pkg } = await read(
      p(`<w:fldSimple w:instr=" PAGE " w:fldLock="1">${run("3")}</w:fldSimple>`),
    );
    const nodes = document.content.content?.[0]?.content as NodeJSON[];
    expect(nodes.map((n) => n.type)).toEqual([
      "fieldStart",
      "fieldCode",
      "fieldSeparator",
      "text",
      "fieldEnd",
    ]);
    expect(await written(document, pkg)).toContain('<w:fldSimple w:instr=" PAGE " w:fldLock="1">');
    (nodes[1] as { attrs: Record<string, unknown> }).attrs.text = ' DATE "x" ';
    const out = await written(document, pkg);
    expect(out).toMatch(/w:instr=" DATE (&quot;|&#34;)x(&quot;|&#34;) " w:fldLock="1"/);
  });

  it("writes tracked field parts as deleted ones", async () => {
    const { document, package: pkg } = await read(
      p(
        '<w:del w:id="1" w:author="A"><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          '<w:r><w:delInstrText xml:space="preserve"> PAGE </w:delInstrText></w:r>' +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:del>',
      ),
    );
    expect(await written(document, pkg)).toContain("<w:delInstrText");
  });
});

describe("fields and controls as edits leave them", () => {
  const simple = (inner: string) => `<w:fldSimple w:instr=" QUOTE x ">${inner}</w:fldSimple>`;
  const edited = async (body: string, change: (nodes: NodeJSON[]) => void) => {
    const { document, package: pkg } = await read(body);
    change(document.content.content?.[0]?.content as NodeJSON[]);
    return written(document, pkg);
  };

  it("drops a field's code when its end is gone, keeping the text", async () => {
    const out = await edited(
      p(
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>QUOTE x</w:instrText></w:r>' +
          `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("kept")}` +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
      ),
      (nodes) => {
        nodes.pop();
      },
    );
    expect(out).toContain("kept");
    expect(out).not.toContain("instrText");
    expect(out).not.toContain("fldChar");
  });

  it("leaves fields alone where the file itself has them unbalanced or verbatim", async () => {
    const begin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
    const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const code = "<w:r><w:instrText>QUOTE x</w:instrText></w:r>";
    const broken = await read(p(begin + code));
    expect(await written(broken.document, broken.package)).toContain("instrText");
    const locked = '<w:sdtPr><w:lock w:val="contentLocked"/><w:text/></w:sdtPr>';
    const split = await read(p(sdt(begin + code, locked) + end));
    const out = await written(split.document, split.package);
    expect(out.match(/fldCharType="end"/g)).toHaveLength(1);
    expect(out.match(/fldCharType="begin"/g)).toHaveLength(1);
  });

  it("writes a simple field split over paragraphs as a complex one", async () => {
    const { document, package: pkg } = await read(p(simple(run("result"))) + p(""));
    const blocks = document.content.content as NodeJSON[];
    const first = blocks[0] as NodeJSON;
    const nodes = first.content as NodeJSON[];
    const end = nodes.pop() as NodeJSON;
    (blocks[1] as NodeJSON).content = [end];
    const out = await written(document, pkg);
    expect(out).not.toContain("<w:fldSimple");
    expect(out).toContain('w:fldCharType="begin"');
    expect(out).toContain('w:fldCharType="end"');
  });

  it("keeps a tracked or linked element inside its marks, as one", async () => {
    const del = '<w:del w:id="1" w:author="A">';
    const out = await written(
      ...(await (async () => {
        const r = await read(p(`${del}${simple("<w:r><w:delText>x</w:delText></w:r>")}</w:del>`));
        return [r.document, r.package] as const;
      })()),
    );
    expect(out).toMatch(
      /<w:del [^>]*><w:fldSimple[^>]*>.*<w:delText>x<\/w:delText>.*<\/w:fldSimple><\/w:del>/,
    );
    const ins = '<w:ins w:id="2" w:author="A">';
    const second = await read(p(`${ins}${run("a")}${sdt(run("b"))}${run("c")}</w:ins>`));
    const again = await written(second.document, second.package);
    expect(again.match(/<w:ins /g)).toHaveLength(1);
    expect(again).toMatch(/<w:ins [^>]*>.*<w:sdt>.*<\/w:sdt>.*<\/w:ins>/);
  });

  it("keeps a control a split paragraph runs over, one per paragraph", async () => {
    const { document, package: pkg } = await read(p(sdt(run("ab"))) + p(""));
    const blocks = document.content.content as NodeJSON[];
    const nodes = (blocks[0] as NodeJSON).content as NodeJSON[];
    const end = nodes.pop() as NodeJSON;
    (blocks[1] as NodeJSON).content = [{ type: "text", text: "cd" }, end];
    const out = await written(document, pkg);
    expect(out.match(/<w:sdt>/g)).toHaveLength(2);
    expect(out.match(/<w:id w:val="7"\/>/g)).toHaveLength(1);
  });

  it("reads code text as Word does, without added spaces", async () => {
    const [block] = await blocksOf(p("<w:r><w:instrText>  QUOTE </w:instrText></w:r>"));
    expect(block?.content?.[0]?.attrs?.text).toBe("QUOTE");
  });
});

describe("content controls kept verbatim", () => {
  it("one with two contents", async () => {
    const twice = `<w:sdt>${SDT_PR}<w:sdtContent>${run("x")}</w:sdtContent><w:sdtContent>${run("y")}</w:sdtContent></w:sdt>`;
    const { report } = await read(p(twice));
    expect(report.opaque["w:sdt"]).toBe(1);
  });

  it("controls nested deeper than the model holds", async () => {
    let body = p(run("deep"));
    for (let i = 0; i < 70; i++) body = sdt(body);
    const { document } = await read(body + p(""));
    expect(document.content.content?.[0]?.type).toBe("opaqueBlock");
  });

  it("writes a control without properties back", async () => {
    const { document, package: pkg } = await read(p(sdt(run("x"), "")));
    expect(await written(document, pkg)).toContain("<w:sdt><w:sdtContent>");
  });
});

describe("content controls", () => {
  it("reads an inline control's properties and ends", async () => {
    const { document } = await read(p(run("a") + sdt(run("b")) + run("c")));
    const nodes = document.content.content?.[0]?.content as NodeJSON[];
    expect(nodes.map((n) => n.type)).toEqual([
      "text",
      "controlStart",
      "text",
      "controlEnd",
      "text",
    ]);
    const id = nodes[1]?.attrs?.id as string;
    expect(nodes[3]?.attrs?.id).toBe(id);
    expect(document.controls?.[id]).toMatchObject({ kind: "text", tag: "name", alias: "Name" });
  });

  it("reads block, row and cell controls, nested, and writes them back", async () => {
    const cell = `<w:tc>${p(run("x"))}</w:tc>`;
    const table = (rows: string) =>
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;
    const body =
      sdt(sdt(p(run("inner"))) + p(run("outer"))) +
      table(sdt(`<w:tr>${cell}</w:tr>`) + `<w:tr>${sdt(cell)}</w:tr>`) +
      p("");
    const { document, package: pkg } = await read(body);
    const [inner, outer, tableNode] = document.content.content as NodeJSON[];
    const [a, b] = (inner as unknown as { attrs: { controls: string[] } }).attrs.controls;
    expect(outer?.attrs?.controls).toEqual([a]);
    expect(b).toBeDefined();
    expect(tableNode?.content?.[0]?.attrs?.controls).toHaveLength(1);
    expect(tableNode?.content?.[1]?.content?.[0]?.attrs?.controls).toHaveLength(1);
    const again = await importDocx(await exportDocx(document, pkg));
    expect(again.document.content).toEqual(document.content);
    expect(again.document.controls).toEqual(document.controls);
  });

  it("keeps an empty block control verbatim", async () => {
    const blocks = await blocksOf(sdt("") + p(""));
    expect(blocks[0]?.type).toBe("opaqueBlock");
  });

  it("gives the later part of a split control a new id", async () => {
    const { document, package: pkg } = await read(sdt(p(run("a")) + p(run("b"))) + p(""));
    const [first, second, last] = document.content.content as NodeJSON[];
    const split = {
      ...document,
      content: { type: "doc", content: [first, last, second, last] as NodeJSON[] },
    };
    const out = await written(split, pkg);
    expect(out.match(/<w:sdt>/g)).toHaveLength(2);
    expect(out.match(/<w:id w:val="7"\/>/g)).toHaveLength(1);
  });

  it("drops the ends of a control whose partner is gone, keeping its text", async () => {
    const { document, package: pkg } = await read(p(sdt(run("kept"))));
    const nodes = document.content.content?.[0]?.content as NodeJSON[];
    nodes.pop();
    const out = await written(document, pkg);
    expect(out).toContain("kept");
    expect(out).not.toContain("<w:sdt>");
  });

  it("refuses a control without properties", async () => {
    const { document, package: pkg } = await read(p(sdt(run("a"))));
    const { controls: _controls, ...without } = document;
    await expect(exportDocx(without, pkg)).rejects.toThrow(/has no properties/);
  });

  it.each([
    ["bound", '<w:dataBinding w:xpath="/a" w:storeItemID="{1}"/>', { binding: { xpath: "/a" } }],
    ["showing its placeholder", "<w:showingPlcHdr/>", { placeholder: { showing: true } }],
    ["with locked content", '<w:lock w:val="contentLocked"/>', { lock: "contentLocked" }],
  ])("models one %s", async (_name, inner, expected) => {
    const pr = `<w:sdtPr>${inner}<w:text/></w:sdtPr>`;
    const { document, report } = await read(p(sdt(run("x"), pr)));
    expect(Object.values(document.controls ?? {})[0]).toMatchObject(expected);
    expect(report.opaque["w:sdt"]).toBeUndefined();
  });

  type Controls = NonNullable<FoliDocument["controls"]>;
  /** Exports the first control changed as `change` says; what `w:sdtPr` comes out. */
  async function patchedPr(pr: string, change: Partial<Controls[string]>, content = run("a")) {
    const { document, package: pkg } = await read(p(sdt(content, pr)));
    const id = Object.keys(document.controls ?? {})[0] as string;
    const changed = structuredClone(document);
    const controls = changed.controls as Controls;
    controls[id] = { ...(controls[id] as Controls[string]), ...change };
    const out = await written(changed, pkg);
    return /<w:sdtPr[\s\S]*?<\/w:sdtPr>/.exec(out)?.[0];
  }

  it("patches what changed and keeps every other child as it was", async () => {
    const pr =
      '<w:sdtPr><w:rPr><w:b w:val="1"/></w:rPr><w:alias w:val="A"/><w:id w:val="9"/><w:placeholder><w:docPart w:val="P"/></w:placeholder><w:temporary/><w:showingPlcHdr/><w:text/></w:sdtPr>';
    expect(
      await patchedPr(pr, {
        alias: "B",
        tag: "t",
        lock: "sdtLocked",
        placeholder: { docPart: "P", showing: false },
        multiLine: true,
      }),
    ).toBe(
      '<w:sdtPr><w:rPr><w:b w:val="1"/></w:rPr><w:alias w:val="B"/><w:tag w:val="t"/><w:id w:val="9"/><w:lock w:val="sdtLocked"/><w:placeholder><w:docPart w:val="P"/></w:placeholder><w:temporary/><w:text w:multiLine="1"/></w:sdtPr>',
    );
  });

  it("writes showing the placeholder, a date, a check box and a list", async () => {
    expect(
      await patchedPr('<w:sdtPr><w:id w:val="1"/></w:sdtPr>', { placeholder: { showing: true } }),
    ).toBe('<w:sdtPr><w:id w:val="1"/><w:showingPlcHdr/></w:sdtPr>');
    expect(
      await patchedPr(
        '<w:sdtPr><w:date><w:dateFormat w:val="d"/><w:lid w:val="en-GB"/></w:date></w:sdtPr>',
        { date: "2026-03-03T00:00:00Z", dateFormat: "yyyy" },
      ),
    ).toBe(
      '<w:sdtPr><w:date w:fullDate="2026-03-03T00:00:00Z"><w:dateFormat w:val="yyyy"/><w:lid w:val="en-GB"/></w:date></w:sdtPr>',
    );
    expect(
      await patchedPr(
        '<w:sdtPr><w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="X"/></w14:checkbox></w:sdtPr>',
        { checked: true },
      ),
    ).toBe(
      '<w:sdtPr><w14:checkbox><w14:checked w14:val="1"/><w14:checkedState w14:val="2612" w14:font="X"/></w14:checkbox></w:sdtPr>',
    );
    expect(
      await patchedPr("<w:sdtPr><w:comboBox/></w:sdtPr>", {
        items: [{ value: "1", display: "One" }],
      }),
    ).toBe(
      '<w:sdtPr><w:comboBox><w:listItem w:displayText="One" w:value="1"/></w:comboBox></w:sdtPr>',
    );
  });

  it.each([
    ["text", "<w:text/>"],
    ["richText", ""],
    ["dropDown", "<w:dropDownList/>"],
    ["comboBox", "<w:comboBox/>"],
    ["date", "<w:date "],
    ["checkbox", "<w14:checkbox"],
    ["repeating", "<w15:repeatingSection"],
    ["repeatingItem", "<w15:repeatingSectionItem"],
  ] as const)("writes a new %s control, which reads back", async (kind, xml) => {
    const { document, package: pkg } = await read(p(run("x")));
    const control = { kind, tag: "new", alias: "New", checked: true, date: "2026-03-03T00:00:00Z" };
    const block = kind === "repeating" || kind === "repeatingItem";
    const content = structuredClone(document.content);
    const first = content.content?.[0] as NodeJSON;
    if (block) first.attrs = { ...first.attrs, controls: ["n"] };
    else
      first.content = [
        { type: "controlStart", attrs: { id: "n" } },
        ...(first.content ?? []),
        { type: "controlEnd", attrs: { id: "n" } },
      ];
    const out = await written({ ...document, content, controls: { n: control } }, pkg);
    expect(out).toContain(xml);
    expect(out).toMatch(/<w:id w:val="\d+"\/>/);
    const again = await importDocx(
      await exportDocx({ ...document, content, controls: { n: control } }, pkg),
    );
    expect(Object.values(again.document.controls ?? {})[0]).toMatchObject({ kind, tag: "new" });
  });

  it("writes a copy without a w:id", async () => {
    const { document, package: pkg } = await read(p(sdt(run("a")) + sdt(run("b"))));
    const out = await written(document, pkg);
    expect(out.match(/<w:id /g)).toHaveLength(2);
    const [a] = Object.keys(document.controls ?? {}) as [string];
    const controls = structuredClone(document.controls) as Controls;
    controls[a] = {
      ...(controls[a] as Controls[string]),
      ext: String(controls[a]?.ext).replace(/<w:id[^>]*\/>/, ""),
    };
    expect((await written({ ...document, controls }, pkg)).match(/<w:id /g)).toHaveLength(1);
  });

  it.each(names)("%s: keeps its controls through a round trip", async (name) => {
    const { document, package: pkg } = await load(name);
    const again = await importDocx(await exportDocx(document, pkg));
    expect(again.document.controls).toEqual(document.controls);
  });
});
