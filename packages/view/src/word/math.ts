/**
 * Word's equations (OMML, `m:oMath` and `m:oMathPara`) drawn as MathML (35.4): the browser lays
 * them out, on pages, read-only pages, print and `exportPdf` alike. Elements are read by their
 * local names, so a Strict file's namespace reads the same. What MathML Core has no element for
 * (a box, a border box, a phantom) is drawn as its content.
 */

const MATHML = "http://www.w3.org/1998/Math/MathML";

/** Word's math font, then the platform's (`math`, CSS Fonts 4). */
export const MATH_FONT = '"Cambria Math", "STIX Two Math", math';

/** OMML's children of `element` with local name `name`. */
const kids = (element: Element, name: string) =>
  [...element.children].filter((child) => child.localName === name);
const kid = (element: Element, name: string) =>
  [...element.children].find((child) => child.localName === name) ?? null;
/** A property's `m:val` (`m:chr m:val="∑"`), by local name. */
function prop(element: Element, pr: string, name: string): string | null {
  const props = kid(element, pr);
  const found = props && kid(props, name);
  if (!found) return null;
  for (const attribute of found.attributes)
    if (attribute.localName === "val") return attribute.value;
  return "";
}
/** An on/off property: on when present without a value, or with one that is not off. */
function on(element: Element, pr: string, name: string): boolean {
  const value = prop(element, pr, name);
  return value !== null && !["0", "off", "false"].includes(value);
}

/** Operators MathML stretches or spaces as operators. */
const OPERATOR = /[+\-−±∓×÷·∙=≠≈≡≤≥<>∝∼≪≫⊂⊃⊆⊇∈∉∋∪∩∧∨¬→←↔⇒⇐⇔↦∀∃∂∇∑∏∫∮(){}[\]|‖,;:!/\\⟨⟩⌈⌉⌊⌋…⋯]/u;

/**
 * Builds the MathML of an OMML `m:oMath` or `m:oMathPara` (null for anything else). `display`
 * comes from `m:oMathPara` (Word's display equation, on a line of its own) unless given.
 */
export function mathElement(omml: Element, doc: Document): Element | null {
  const name = omml.localName;
  if (name !== "oMath" && name !== "oMathPara") return null;
  const make = (tag: string, ...children: (Node | null)[]) => {
    const element = doc.createElementNS(MATHML, tag);
    for (const c of children) if (c) element.append(c);
    return element;
  };
  const text = (tag: string, value: string, attrs: Record<string, string> = {}) => {
    const element = make(tag);
    element.textContent = value;
    for (const [k, v] of Object.entries(attrs)) element.setAttribute(k, v);
    return element;
  };
  const row = (children: Node[]) =>
    children.length === 1 ? (children[0] as Node) : make("mrow", ...children);
  /** Text of a run split into identifiers, numbers and operators. */
  const runText = (value: string, plain: boolean, style: string | null): Node[] => {
    const out: Node[] = [];
    const variant =
      style === "b" ? "bold" : style === "bi" ? "bold-italic" : style === "i" ? "italic" : null;
    if (plain) return [text("mtext", value)];
    for (const piece of value.match(/\d+(?:[.,]\d+)*|\s+|./gsu) ?? []) {
      if (/^\s+$/.test(piece)) {
        out.push(text("mspace", "", { width: "0.25em" }));
        continue;
      }
      if (/^\d/.test(piece))
        out.push(text("mn", piece, variant === "bold" ? { mathvariant: "bold" } : {}));
      // Word draws a hyphen in an equation as the minus sign.
      else if (OPERATOR.test(piece)) out.push(text("mo", piece === "-" ? "−" : piece));
      else {
        const attrs: Record<string, string> = {};
        // Word's math italic for single letters unless the style is plain (`m:sty m:val="p"`).
        if (style === "p") attrs.mathvariant = "normal";
        else if (variant && variant !== "italic") attrs.mathvariant = variant;
        out.push(text("mi", piece, attrs));
      }
    }
    return out;
  };
  /** The MathML of OMML's argument elements (`m:e`, `m:num`…): their content in a row. */
  const arg = (element: Element | null): Node => row(element ? content(element) : []);
  const content = (element: Element): Node[] => [...element.children].flatMap(convert);
  const fence = (value: string) => text("mo", value, { fence: "true", stretchy: "true" });
  function convert(element: Element): Node[] {
    switch (element.localName) {
      case "r": {
        const value = kids(element, "t")
          .map((t) => t.textContent ?? "")
          .join("");
        // `m:nor`: normal text (Word's "abc" in an equation), not math.
        return runText(value, on(element, "rPr", "nor"), prop(element, "rPr", "sty"));
      }
      case "f": {
        const type = prop(element, "fPr", "type");
        const num = arg(kid(element, "num"));
        const den = arg(kid(element, "den"));
        if (type === "lin" || type === "skw") return [num, text("mo", "/"), den];
        const frac = make("mfrac", num, den);
        if (type === "noBar") frac.setAttribute("linethickness", "0");
        return [frac];
      }
      case "sSup":
        return [make("msup", arg(kid(element, "e")), arg(kid(element, "sup")))];
      case "sSub":
        return [make("msub", arg(kid(element, "e")), arg(kid(element, "sub")))];
      case "sSubSup":
        return [
          make(
            "msubsup",
            arg(kid(element, "e")),
            arg(kid(element, "sub")),
            arg(kid(element, "sup")),
          ),
        ];
      case "sPre":
        return [
          make(
            "mmultiscripts",
            arg(kid(element, "e")),
            make("mprescripts"),
            arg(kid(element, "sub")),
            arg(kid(element, "sup")),
          ),
        ];
      case "rad": {
        const degree = kid(element, "deg");
        const hidden = on(element, "radPr", "degHide") || !degree || !degree.children.length;
        return [
          hidden
            ? make("msqrt", arg(kid(element, "e")))
            : make("mroot", arg(kid(element, "e")), arg(degree)),
        ];
      }
      case "nary": {
        const chr = prop(element, "naryPr", "chr") ?? "∫";
        const op = text("mo", chr, { largeop: "true", movablelimits: "false" });
        const sub = on(element, "naryPr", "subHide") ? null : arg(kid(element, "sub"));
        const sup = on(element, "naryPr", "supHide") ? null : arg(kid(element, "sup"));
        // Integrals keep their limits beside them unless the file says under and over.
        const under =
          (prop(element, "naryPr", "limLoc") ?? (chr === "∫" ? "subSup" : "undOvr")) === "undOvr";
        let base: Node = op;
        if (sub && sup) base = make(under ? "munderover" : "msubsup", op, sub, sup);
        else if (sub) base = make(under ? "munder" : "msub", op, sub);
        else if (sup) base = make(under ? "mover" : "msup", op, sup);
        return [base, arg(kid(element, "e"))];
      }
      case "d": {
        const begin = prop(element, "dPr", "begChr") ?? "(";
        const end = prop(element, "dPr", "endChr") ?? ")";
        const separator = prop(element, "dPr", "sepChr") ?? "|";
        const parts: Node[] = [];
        if (begin) parts.push(fence(begin));
        kids(element, "e").forEach((e, i) => {
          if (i) parts.push(text("mo", separator, { separator: "true" }));
          parts.push(arg(e));
        });
        if (end) parts.push(fence(end));
        return [make("mrow", ...parts)];
      }
      case "func":
        return [arg(kid(element, "fName")), text("mo", "⁡"), arg(kid(element, "e"))];
      case "limLow":
        return [make("munder", arg(kid(element, "e")), arg(kid(element, "lim")))];
      case "limUpp":
        return [make("mover", arg(kid(element, "e")), arg(kid(element, "lim")))];
      case "acc": {
        const chr = prop(element, "accPr", "chr") ?? "̂";
        return [make("mover", arg(kid(element, "e")), text("mo", chr, { stretchy: "true" }))];
      }
      case "bar": {
        const top = prop(element, "barPr", "pos") === "top";
        const line = text("mo", "‾", { stretchy: "true" });
        if (!top) line.textContent = "_";
        return [make(top ? "mover" : "munder", arg(kid(element, "e")), line)];
      }
      case "groupChr": {
        const chr = prop(element, "groupChrPr", "chr") ?? "⏟";
        const top = prop(element, "groupChrPr", "pos") === "top";
        return [
          make(
            top ? "mover" : "munder",
            arg(kid(element, "e")),
            text("mo", chr, { stretchy: "true" }),
          ),
        ];
      }
      case "m": {
        const table = make("mtable");
        for (const mr of kids(element, "mr"))
          table.append(make("mtr", ...kids(mr, "e").map((e) => make("mtd", arg(e)))));
        return [table];
      }
      case "eqArr": {
        const table = make("mtable");
        table.setAttribute("columnalign", "left");
        for (const e of kids(element, "e")) table.append(make("mtr", make("mtd", arg(e))));
        return [table];
      }
      case "box":
      case "borderBox":
      case "phant":
        return [arg(kid(element, "e"))];
      case "oMath":
        return content(element);
      // Properties, control properties and Word's run properties draw nothing.
      default:
        return element.localName.endsWith("Pr") ? [] : content(element);
    }
  }
  const math = make("math");
  math.setAttribute("alttext", mathText(omml));
  const display = name === "oMathPara";
  if (display) {
    math.setAttribute("display", "block");
    const equations = kids(omml, "oMath");
    if (equations.length > 1) {
      const table = make("mtable");
      for (const e of equations) table.append(make("mtr", make("mtd", row(convert(e)))));
      math.append(table);
    } else for (const e of equations) math.append(...convert(e));
  } else math.append(...convert(omml));
  return math;
}

/** An equation's characters (its runs' text, structure left out): for find and its `alttext`. */
export function mathText(omml: Element): string {
  let out = "";
  for (const t of omml.getElementsByTagName("*"))
    if (t.localName === "t") out += t.textContent ?? "";
  return out;
}

/** Whether opaque XML is one of Word's equations. */
export const isMath = (element: Element | null): element is Element =>
  element?.localName === "oMath" || element?.localName === "oMathPara";
