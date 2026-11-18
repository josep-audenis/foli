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

  it("refuses a changed control, for now, and one without properties", async () => {
    const { document, package: pkg } = await read(p(sdt(run("a"))));
    const id = Object.keys(document.controls ?? {})[0] as string;
    const changed = structuredClone(document);
    (changed.controls as NonNullable<FoliDocument["controls"]>)[id] = {
      ...(document.controls?.[id] as NonNullable<FoliDocument["controls"]>[string]),
      tag: "other",
    };
    await expect(exportDocx(changed, pkg)).rejects.toThrow(/changed content control/);
    const { controls: _controls, ...without } = document;
    await expect(exportDocx(without, pkg)).rejects.toThrow(/has no properties/);
  });

  it.each(names)("%s: keeps its controls through a round trip", async (name) => {
    const { document, package: pkg } = await load(name);
    const again = await importDocx(await exportDocx(document, pkg));
    expect(again.document.controls).toEqual(document.controls);
  });
});
