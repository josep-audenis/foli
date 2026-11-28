/**
 * Word's equations (OMML, `m:oMath` and `m:oMathPara`) drawn as MathML (35.4): the browser lays
 * them out, on pages, read-only pages, print and `exportPdf` alike. Elements are read by their
 * local names, so a Strict file's namespace reads the same. Only MathML Core is written (what
 * Chromium, Firefox and WebKit draw): styled letters as Unicode's mathematical alphanumerics, a
 * box or border box as its content. Text a tracked change deleted is not drawn.
 */

const MATHML = "http://www.w3.org/1998/Math/MathML";

/** Word's math font, then the platform's (`math`, CSS Fonts 4). @internal */
export const MATH_FONT = '"Cambria Math", "STIX Two Math", math';

/** Children that are content (not properties, not a tracked deletion). */
const live = (element: Element) =>
  [...element.children].filter(
    (child) =>
      !child.localName.endsWith("Pr") &&
      child.localName !== "del" &&
      child.localName !== "moveFrom",
  );
/** OMML's children of `element` with local name `name` (OMML's, not Word's `w:rPr`). */
const kids = (element: Element, name: string) =>
  [...element.children].filter((child) => child.localName === name && child.prefix !== "w");
const kid = (element: Element, name: string) => kids(element, name)[0] ?? null;
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

/** Letters and marks are identifiers (with these symbols); digits numbers; the rest operators. */
const IDENTIFIER = /^[\p{L}\p{M}∞∅∂ℏ]/u;
/** Integrals keep their limits beside them by default (Word's `m:intLim` subSup). */
const INTEGRALS = new Set([..."∫∬∭∮∯∰∱∲∳⨌"]);
/** Word's accents are combining marks: MathML draws their spacing forms over the base. */
const SPACING: Readonly<Record<string, string>> = {
  "̀": "`",
  "́": "´",
  "̂": "ˆ",
  "̃": "˜",
  "̄": "¯",
  "̅": "¯",
  "̆": "˘",
  "̇": "˙",
  "̈": "¨",
  "̌": "ˇ",
  "⃖": "←",
  "⃗": "→",
  "⃡": "↔",
};

/**
 * Unicode's mathematical alphanumerics for a letter or digit in a style (`m:sty` b, bi, i; `m:scr`
 * double-struck, script, fraktur, sans-serif, monospace): MathML Core draws only those, not
 * `mathvariant`. Null where Unicode has none (the letter then stays as it is).
 */
function styled(char: string, style: string | null, script: string | null): string | null {
  const code = char.codePointAt(0) ?? 0;
  const upper = code >= 65 && code <= 90;
  const lower = code >= 97 && code <= 122;
  const digit = code >= 48 && code <= 57;
  if (!upper && !lower && !digit) return null;
  const bold = style === "b" || style === "bi";
  // Letters' blocks start at A; a block's lower case follows 26 later.
  const letters: Record<string, number> = {
    b: 0x1d400,
    i: 0x1d434,
    bi: 0x1d468,
    script: 0x1d49c,
    "script-b": 0x1d4d0,
    fraktur: 0x1d504,
    "fraktur-b": 0x1d56c,
    "double-struck": 0x1d538,
    "sans-serif": 0x1d5a0,
    "sans-serif-b": 0x1d5d4,
    monospace: 0x1d670,
  };
  const digits: Record<string, number> = {
    b: 0x1d7ce,
    "double-struck": 0x1d7d8,
    "sans-serif": 0x1d7e2,
    "sans-serif-b": 0x1d7ec,
    monospace: 0x1d7f6,
  };
  const key =
    script && script !== "roman"
      ? `${script}${bold && ["script", "fraktur", "sans-serif"].includes(script) ? "-b" : ""}`
      : style;
  if (!key || key === "p") return null;
  if (digit) {
    const start = digits[key === "bi" ? "b" : key];
    return start ? String.fromCodePoint(start + code - 48) : null;
  }
  const start = letters[key];
  if (!start) return null;
  // Letters Unicode had already (ℎ, ℬ, ℭ…) are the holes in these blocks.
  const HOLES: Record<number, string> = {
    119893: "ℎ",
    119965: "ℬ",
    119968: "ℰ",
    119969: "ℱ",
    119971: "ℋ",
    119972: "ℐ",
    119975: "ℒ",
    119976: "ℳ",
    119981: "ℛ",
    119994: "ℯ",
    119996: "ℊ",
    120004: "ℴ",
    120070: "ℭ",
    120075: "ℌ",
    120076: "ℑ",
    120085: "ℜ",
    120093: "ℨ",
    120122: "ℂ",
    120127: "ℍ",
    120133: "ℕ",
    120135: "ℙ",
    120136: "ℚ",
    120137: "ℝ",
    120145: "ℤ",
  };
  const at = start + (upper ? code - 65 : 26 + code - 97);
  return HOLES[at] ?? String.fromCodePoint(at);
}

/**
 * Builds the MathML of an OMML `m:oMath` or `m:oMathPara` (null for anything else): a display
 * equation (`m:oMathPara`, Word's on a line of its own) is a block. Its MathML is what assistive
 * technology reads.
 * @internal
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
  /** A run's text as identifiers, numbers and operators (`inArray`: `&` aligns, not drawn). */
  const runText = (
    value: string,
    plain: boolean,
    style: string | null,
    script: string | null,
    inArray: boolean,
  ): Node[] => {
    if (inArray) value = value.replace(/&/g, "");
    if (plain) return value ? [text("mtext", value)] : [];
    const out: Node[] = [];
    const pieces = value.match(/\d+(?:[.,]\d+)*|\s+|\p{L}\p{M}*|./gsu) ?? [];
    for (let i = 0; i < pieces.length; i++) {
      let piece = pieces[i] as string;
      if (/^\s+$/.test(piece)) {
        out.push(text("mspace", "", { width: "0.25em" }));
        continue;
      }
      const look = (chars: string) => [...chars].map((c) => styled(c, style, script) ?? c).join("");
      if (/^\d/.test(piece)) out.push(text("mn", look(piece)));
      else if (IDENTIFIER.test(piece)) {
        // Upright letters (a function's name, `m:sty` p) read as one word: `sin`, not s i n.
        if (style === "p" && /^\p{L}/u.test(piece))
          while (/^\p{L}/u.test(pieces[i + 1] ?? "")) piece += pieces[++i];
        const shown = look(piece);
        const attrs: Record<string, string> =
          style === "p" || (shown === piece && [...piece].length > 1)
            ? { mathvariant: "normal" }
            : {};
        // A letter in a style Unicode has a letter for is that letter, drawn as it is.
        if (shown !== piece && [...piece].length === 1) attrs.mathvariant = "normal";
        out.push(text("mi", shown, attrs));
      }
      // Word draws a hyphen in an equation as the minus sign, an apostrophe as a prime.
      else out.push(text("mo", piece === "-" ? "−" : piece === "'" ? "′" : piece));
    }
    return out;
  };
  /** The MathML of OMML's argument elements (`m:e`, `m:num`…): their content in a row. */
  const arg = (element: Element | null, inArray = false): Node =>
    row(element ? content(element, inArray) : []);
  const content = (element: Element, inArray = false): Node[] =>
    live(element).flatMap((child) => convert(child, inArray));
  /** A script's or limit's argument, unless hidden or empty. */
  const shown = (element: Element, name: string, hide: string, pr: string): Node | null => {
    const part = kid(element, name);
    return on(element, pr, hide) || !part || !live(part).length ? null : arg(part);
  };
  const stretchy = (value: string) => text("mo", value, { stretchy: "true" });
  function convert(element: Element, inArray = false): Node[] {
    switch (element.localName) {
      case "r": {
        const value = kids(element, "t")
          .map((t) => t.textContent ?? "")
          .join("");
        // `m:nor`: normal text (Word's "abc" in an equation), not math.
        return runText(
          value,
          on(element, "rPr", "nor"),
          prop(element, "rPr", "sty"),
          prop(element, "rPr", "scr"),
          inArray,
        );
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
        const hidden = on(element, "radPr", "degHide") || !degree || !live(degree).length;
        return [
          hidden
            ? make("msqrt", arg(kid(element, "e")))
            : make("mroot", arg(kid(element, "e")), arg(degree)),
        ];
      }
      case "nary": {
        const chr = prop(element, "naryPr", "chr") || "∫";
        const op = text("mo", chr, { largeop: "true", movablelimits: "false" });
        const sub = shown(element, "sub", "subHide", "naryPr");
        const sup = shown(element, "sup", "supHide", "naryPr");
        const under =
          (prop(element, "naryPr", "limLoc") ?? (INTEGRALS.has(chr) ? "subSup" : "undOvr")) ===
          "undOvr";
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
        if (begin) parts.push(stretchy(begin));
        kids(element, "e").forEach((e, i) => {
          if (i) parts.push(text("mo", separator));
          parts.push(arg(e));
        });
        if (end) parts.push(stretchy(end));
        return [make("mrow", ...parts)];
      }
      case "func":
        return [arg(kid(element, "fName")), text("mo", "⁡"), arg(kid(element, "e"))];
      case "limLow":
        return [make("munder", arg(kid(element, "e")), arg(kid(element, "lim")))];
      case "limUpp":
        return [make("mover", arg(kid(element, "e")), arg(kid(element, "lim")))];
      case "acc": {
        const chr = prop(element, "accPr", "chr") || "̂";
        const over = make("mover", arg(kid(element, "e")), stretchy(SPACING[chr] ?? chr));
        over.setAttribute("accent", "true");
        return [over];
      }
      case "bar": {
        const top = prop(element, "barPr", "pos") === "top";
        const bar = make(top ? "mover" : "munder", arg(kid(element, "e")), stretchy("¯"));
        bar.setAttribute(top ? "accent" : "accentunder", "true");
        return [bar];
      }
      case "groupChr": {
        const chr = prop(element, "groupChrPr", "chr") || "⏟";
        const top = prop(element, "groupChrPr", "pos") === "top";
        return [make(top ? "mover" : "munder", arg(kid(element, "e")), stretchy(chr))];
      }
      case "m": {
        const table = make("mtable");
        for (const mr of kids(element, "mr"))
          table.append(make("mtr", ...kids(mr, "e").map((e) => make("mtd", arg(e)))));
        return [table];
      }
      case "eqArr": {
        // Word's alignment marks (`&`) are not drawn; each line starts at the left.
        const table = make("mtable");
        for (const e of kids(element, "e")) {
          const cell = make("mtd", arg(e, true));
          cell.setAttribute("style", "text-align: left");
          table.append(make("mtr", cell));
        }
        return [table];
      }
      case "phant": {
        const e = arg(kid(element, "e"));
        if (prop(element, "phantPr", "show") !== null && !on(element, "phantPr", "show"))
          return [make("mphantom", e)];
        const zero = (name: string) => on(element, "phantPr", name);
        if (!zero("zeroWid") && !zero("zeroAsc") && !zero("zeroDesc")) return [e];
        const padded = make("mpadded", e);
        if (zero("zeroWid")) padded.setAttribute("width", "0");
        if (zero("zeroAsc")) padded.setAttribute("height", "0");
        if (zero("zeroDesc")) padded.setAttribute("depth", "0");
        return [padded];
      }
      case "box":
      case "borderBox":
        return [arg(kid(element, "e"), inArray)];
      default:
        return content(element, inArray);
    }
  }
  const math = make("math");
  // Drawn, not text to type in: a press goes to the equation's span, which the editor places.
  math.setAttribute("style", "pointer-events: none; user-select: none");
  if (name === "oMathPara") {
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

/** Whether opaque XML is one of Word's equations. @internal */
export const isMath = (element: Element | null): element is Element =>
  element?.localName === "oMath" || element?.localName === "oMathPara";
