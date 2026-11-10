import { describe, expect, it } from "vitest";
import { rebuild } from "./testing/rebuild.js";
import { parseXml, type XmlElement, XmlError, type XmlNode } from "./xml.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const elements = (n: XmlElement): XmlElement[] =>
  n.children.filter((c): c is XmlElement => c.kind === "element");

const SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
<!-- top -->
<w:document xmlns:w="${W}" xmlns="urn:default" xmlns:mc="urn:mc" mc:Ignorable="w14">\r
  <w:body>
    <w:p w:rsidR="00AB"><w:r><w:t xml:space="preserve"> a &amp; b &lt;c&gt; &#x41;&#66; </w:t></w:r></w:p>
    <plain attr = 'single "quoted"'/>
    <?mso-application progid="Word.Document"?>
    <w:p><![CDATA[<raw> & ]]></w:p>
  </w:body>
</w:document>
`;

describe("parseXml", () => {
  it("keeps every character of the source in the tree", () => {
    const doc = parseXml(SAMPLE);
    expect(rebuild(doc)).toBe(SAMPLE);
    expect(doc.children.map((n) => n.kind)).toEqual([
      "declaration",
      "text",
      "comment",
      "text",
      "element",
      "text",
    ]);
  });

  it("records each element's exact source", () => {
    const doc = parseXml(SAMPLE);
    const body = elements(doc.root)[0] as XmlElement;
    const [p, plain, p2] = elements(body) as [XmlElement, XmlElement, XmlElement];
    expect(doc.source.slice(p.start, p.end)).toBe(
      '<w:p w:rsidR="00AB"><w:r><w:t xml:space="preserve"> a &amp; b &lt;c&gt; &#x41;&#66; </w:t></w:r></w:p>',
    );
    expect(doc.source.slice(p.start, p.openEnd)).toBe('<w:p w:rsidR="00AB">');
    expect(doc.source.slice(p.closeStart, p.end)).toBe("</w:p>");
    expect(doc.source.slice(plain.start, plain.end)).toBe(`<plain attr = 'single "quoted"'/>`);
    expect([plain.openEnd, plain.closeStart]).toEqual([plain.end, plain.end]);
    expect(plain.children).toEqual([]);
    expect(p2.children[0]).toMatchObject({ kind: "text", cdata: true, text: "<raw> & " });
    const instruction = body.children.find((c) => c.kind === "instruction") as XmlNode;
    expect(doc.source.slice(instruction.start, instruction.end)).toBe(
      '<?mso-application progid="Word.Document"?>',
    );
  });

  it("resolves names and namespaces", () => {
    const doc = parseXml(SAMPLE);
    expect(doc.root).toMatchObject({ name: "w:document", prefix: "w", local: "document", ns: W });
    const body = elements(doc.root)[0] as XmlElement;
    const [p, plain] = elements(body) as [XmlElement, XmlElement];
    expect(plain).toMatchObject({ prefix: "", local: "plain", ns: "urn:default" });
    expect(plain.attributes[0]).toMatchObject({ name: "attr", ns: "", value: 'single "quoted"' });
    expect(p.attributes[0]).toMatchObject({ local: "rsidR", ns: W, value: "00AB" });
    const t = elements(elements(p)[0] as XmlElement)[0] as XmlElement;
    expect(t.attributes[0]).toMatchObject({
      prefix: "xml",
      local: "space",
      ns: "http://www.w3.org/XML/1998/namespace",
    });
    expect(doc.root.attributes[0]).toMatchObject({
      name: "xmlns:w",
      ns: "http://www.w3.org/2000/xmlns/",
      value: W,
    });
    // A prefix declared on an element is in scope for its descendants only.
    const scoped = parseXml('<a><b xmlns:x="urn:x"><x:c/></b></a>');
    expect(elements(elements(scoped.root)[0] as XmlElement)[0]?.ns).toBe("urn:x");
    expect(() => parseXml('<a><b xmlns:x="urn:x"/><x:c/></a>')).toThrow(
      /Unbound namespace prefix x/,
    );
    // A default namespace can be undeclared.
    expect(elements(parseXml('<a xmlns="urn:a"><b xmlns=""/></a>').root)[0]?.ns).toBe("");
  });

  it("decodes references and normalizes line ends", () => {
    const t = (xml: string) => (parseXml(xml).root.children[0] as { text: string }).text;
    expect(t("<a> a &amp; b &lt;c&gt; &quot;&apos; &#x41;&#66;&#x1F600;</a>")).toBe(
      " a & b <c> \"' AB😀",
    );
    expect(t("<a>x\r\ny\rz</a>")).toBe("x\ny\nz");
    const value = (xml: string) => parseXml(xml).root.attributes[0]?.value;
    expect(value('<a v="x\ty\r\nz\nw"/>')).toBe("x y z w");
    expect(value('<a v="x&#10;y&#9;z"/>')).toBe("x\ny\tz");
    expect(value('<a v="&lt;&amp;&gt;"/>')).toBe("<&>");
  });

  it("rejects what is not well-formed", () => {
    const cases: [string, RegExp][] = [
      ["", /No root element/],
      ["<a>", /Unclosed element <a>/],
      ["<a></b>", /End tag <\/b> does not match <a>/],
      ["</a>", /End tag <\/a> without a start tag/],
      ["<a/><b/>", /More than one root element/],
      ["x<a/>", /Text outside the root element/],
      ["<a/>x", /Text outside the root element/],
      ["<![CDATA[x]]><a/>", /CDATA outside the root element/],
      ['<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>', /Document type declarations are not allowed/],
      ["<a>&e;</a>", /Unknown entity &e;/],
      ["<a>a & b</a>", /"&" without a reference/],
      ["<a>&#0;</a>", /illegal character/],
      ["<a>&#xFFFE;</a>", /illegal character/],
      ['<a x="1" x="2"/>', /Duplicate attribute x/],
      ['<a xmlns:p="urn:1" xmlns:q="urn:1" p:x="1" q:x="2"/>', /Duplicate attribute q:x/],
      ['<a p:x="1"/>', /Unbound namespace prefix p/],
      ["<p:a/>", /Unbound namespace prefix p/],
      ['<a xmlns:p=""><p:b/></a>', /Unbound namespace prefix p/],
      ["<a x=1/>", /Unquoted attribute x/],
      ['<a x="1/>', /Unclosed attribute x/],
      ['<a x="<"/>', /"<" in attribute x/],
      ["<a x/>", /Attribute x without a value/],
      ['<a x="1"y="2"/>', /Malformed start tag <a>/],
      ["<a =/>", /Malformed attribute in <a>/],
      ["< a/>", /Malformed start tag/],
      ["<a></a >x", /Text outside the root element/],
      ["<a></a b>", /Malformed end tag/],
      ["<a:b:c/>", /Malformed qualified name a:b:c/],
      ["<:a/>", /Malformed qualified name/],
      [' <?xml version="1.0"?><a/>', /XML declaration not at the start/],
      ['<?XML version="1.0"?><a/>', /XML declaration not at the start/],
      ["<a><? ?></a>", /Processing instruction without a target/],
      ["<a><?pi</a>", /Unclosed processing instruction/],
      ["<a><!-- x</a>", /Unclosed comment/],
      ["<a><![CDATA[x</a>", /Unclosed CDATA section/],
    ];
    for (const [source, message] of cases) {
      expect(() => parseXml(source), source).toThrow(message);
    }
    const error = (() => {
      try {
        parseXml("<a>\n  <b></c></a>");
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(XmlError);
    expect((error as XmlError).offset).toBe(9);
  });
});
