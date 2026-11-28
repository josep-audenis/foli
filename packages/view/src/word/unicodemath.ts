/**
 * An equation's linear form (35.5): Word's UnicodeMath (its "linear format", what Word's equation
 * box shows before building up) read into OMML as Word writes it, and OMML written back as
 * UnicodeMath for the box. Own parser and writer (no dependency, no editor engine). The subset is
 * what Word's equation gallery and ordinary equations use: fractions (`a/b`), scripts (`x^2`,
 * `a_i`, `x_i^2`), roots (`√x`, `√(n&x)`, `∛x`), n-ary operators with limits (`∑_(k=1)^n▒k`),
 * delimiters (`()`, `[]`, `{}`, `||`, `├ ┤`), binomials (`(n¦k)`), matrices (`■(a&b@c&d)`),
 * functions (`sin⁡x`, `lim_(n→∞)⁡…`), Word's invisible brackets (`〖…〗`) and `\name` symbols.
 */

import { parseOpaque } from "./blocks.js";
import { isMath, mathElement } from "./math.js";

/** `\name` symbols Word's math autocorrect turns into characters (the common ones). */
const SYMBOLS: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  pm: "±",
  mp: "∓",
  times: "×",
  div: "÷",
  cdot: "⋅",
  infty: "∞",
  le: "≤",
  ge: "≥",
  ne: "≠",
  approx: "≈",
  equiv: "≡",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  partial: "∂",
  nabla: "∇",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  cup: "∪",
  cap: "∩",
  forall: "∀",
  exists: "∃",
  sum: "∑",
  prod: "∏",
  int: "∫",
  iint: "∬",
  oint: "∮",
  sqrt: "√",
  cbrt: "∛",
  degree: "°",
  cdots: "⋯",
  ldots: "…",
  matrix: "■",
  eqarray: "█",
  of: "▒",
  atop: "¦",
  funcapply: "⁡",
};

const NARY = new Set(["∑", "∏", "∐", "∫", "∬", "∭", "∮", "∯", "∰", "⋃", "⋂", "⋁", "⋀"]);
/** Integrals keep their limits beside them, as Word's default (`m:limLoc` subSup). */
const INTEGRALS = new Set(["∫", "∬", "∭", "∮", "∯", "∰"]);
const FUNCTIONS = new Set([
  ..."sin cos tan cot sec csc sinh cosh tanh coth arcsin arccos arctan log ln lg exp".split(" "),
  ..."lim max min sup inf det arg deg dim gcd ker Pr".split(" "),
]);
/** Functions whose subscript goes under them (`lim_(n→∞)`): Word's `m:limLow`. */
const UNDER = new Set(["lim", "max", "min", "sup", "inf"]);
const OPEN: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "⟨": "⟩",
  "⌈": "⌉",
  "⌊": "⌋",
  "〖": "〗",
  "├": "┤",
};
const CLOSE = new Set([")", "]", "}", "⟩", "⌉", "⌋", "〗", "┤"]);

// ---------- the tree ----------

type MathNode =
  | { kind: "text"; text: string; plain?: boolean }
  | { kind: "row"; items: MathNode[] }
  | { kind: "frac"; num: MathNode; den: MathNode; bar: boolean }
  | { kind: "script"; base: MathNode; sub: MathNode | null; sup: MathNode | null }
  | { kind: "rad"; deg: MathNode | null; e: MathNode }
  | { kind: "nary"; chr: string; sub: MathNode | null; sup: MathNode | null; e: MathNode }
  | { kind: "delim"; open: string; close: string; items: MathNode[] }
  | { kind: "func"; name: string; under: MathNode | null; sup: MathNode | null; e: MathNode }
  | { kind: "matrix"; rows: MathNode[][] };

const row = (items: MathNode[]): MathNode =>
  items.length === 1 ? (items[0] as MathNode) : { kind: "row", items };

// ---------- reading UnicodeMath ----------

/**
 * Reads Word's linear format into OMML as Word writes it (`<m:oMath>…</m:oMath>`, in an
 * `m:oMathPara` for a display equation): an `equation` node's `xml`.
 */
export function unicodeMathToOmml(source: string, display = true): string {
  const tokens = tokenize(source);
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];

  /** A sequence up to one of `stops` (not consumed). */
  function sequence(stops: ReadonlySet<string>): MathNode[] {
    const items: MathNode[] = [];
    while (at < tokens.length && !stops.has(peek() as string)) {
      const token = peek() as string;
      if (token === " ") {
        next();
        continue;
      }
      if (token === "/" && items.length) {
        next();
        const num = items.pop() as MathNode;
        const den = scripted(operand());
        items.push({ kind: "frac", num, den, bar: true });
        continue;
      }
      const item = primary();
      if (item) items.push(scripted(item));
    }
    return items;
  }

  /** Subscripts and superscripts after `base`. */
  function scripted(base: MathNode): MathNode {
    let sub: MathNode | null = null;
    let sup: MathNode | null = null;
    while (peek() === "_" || peek() === "^") {
      const mark = next();
      const value = operand();
      if (mark === "_") sub = value;
      else sup = value;
    }
    return sub || sup ? { kind: "script", base, sub, sup } : base;
  }

  /** An operator's argument: a bracketed group without its brackets, or one primary. */
  function operand(): MathNode {
    while (peek() === " ") next();
    const token = peek();
    if (token === "(" || token === "〖") {
      next();
      const inner = sequence(new Set([OPEN[token] as string]));
      next();
      return row(inner);
    }
    return primary() ?? { kind: "row", items: [] };
  }

  function primary(): MathNode | null {
    const token = next();
    if (token === undefined) return null;
    if (token in OPEN) {
      const close = OPEN[token] as string;
      const inner = sequence(new Set([close, "¦", "┤"]));
      if (peek() === "¦") {
        next();
        const den = sequence(new Set([close, "┤"]));
        next();
        return {
          kind: "delim",
          open: token,
          close,
          items: [{ kind: "frac", num: row(inner), den: row(den), bar: false }],
        };
      }
      const end = next() ?? close;
      if (token === "〖") return row(inner);
      return {
        kind: "delim",
        open: token === "├" ? "" : token,
        close: end === "┤" ? "" : end,
        items: inner,
      };
    }
    if (token === "|" || token === "‖") {
      const inner = sequence(new Set([token]));
      next();
      return { kind: "delim", open: token, close: token, items: inner };
    }
    if (token === "√" || token === "∛" || token === "∜") {
      if (token === "√" && peek() === "(") {
        // √(n&x): a degree before `&`.
        next();
        const first = sequence(new Set([")", "&"]));
        if (peek() === "&") {
          next();
          const e = sequence(new Set([")"]));
          next();
          return { kind: "rad", deg: row(first), e: row(e) };
        }
        next();
        return { kind: "rad", deg: null, e: row(first) };
      }
      const e = operand();
      const deg = token === "∛" ? "3" : token === "∜" ? "4" : null;
      return { kind: "rad", deg: deg ? { kind: "text", text: deg } : null, e };
    }
    if (NARY.has(token)) {
      let sub: MathNode | null = null;
      let sup: MathNode | null = null;
      while (peek() === "_" || peek() === "^") {
        const mark = next();
        const value = operand();
        if (mark === "_") sub = value;
        else sup = value;
      }
      if (peek() === "▒") next();
      return { kind: "nary", chr: token, sub, sup, e: scripted(operand()) };
    }
    if (token === "■" || token === "█") {
      // ■(a&b@c&d): rows by @, cells by &.
      if (peek() !== "(") return { kind: "text", text: token };
      next();
      const rows: MathNode[][] = [[]];
      for (;;) {
        const cell = sequence(new Set(["&", "@", ")"]));
        (rows[rows.length - 1] as MathNode[]).push(row(cell));
        const sep = next();
        if (sep === "@") rows.push([]);
        else if (sep !== "&") break;
      }
      return { kind: "matrix", rows };
    }
    if (FUNCTIONS.has(token)) {
      let under: MathNode | null = null;
      let sup: MathNode | null = null;
      while (peek() === "_" || peek() === "^") {
        const mark = next();
        const value = operand();
        if (mark === "_") under = value;
        else sup = value;
      }
      if (peek() === "⁡") next();
      const e = scripted(operand());
      // sin^2⁡θ: the power on the name; lim_(n→∞): the limit under it (Word's `m:limLow`).
      return { kind: "func", name: token, under: UNDER.has(token) ? under : null, sup, e };
    }
    if (token === "⁡") return null;
    return { kind: "text", text: token };
  }

  const items = sequence(new Set());
  const math = `<m:oMath>${joined(items)}</m:oMath>`;
  return display ? `<m:oMathPara>${math}</m:oMathPara>` : math;
}

/** Tokens: alphanumeric runs (a function's name alone), `\name` symbols, single characters. */
function tokenize(source: string): string[] {
  const out: string[] = [];
  const chars = [...source.normalize("NFC")];
  for (let i = 0; i < chars.length; ) {
    const c = chars[i] as string;
    if (c === "\\") {
      let name = "";
      let j = i + 1;
      while (j < chars.length && /[A-Za-z]/.test(chars[j] as string)) name += chars[j++];
      const symbol = SYMBOLS[name];
      if (symbol) {
        out.push(symbol);
        i = j;
        // A space ending the name is the name's, as in Word.
        if (chars[i] === " ") i++;
        continue;
      }
      out.push(c);
      i++;
      continue;
    }
    if (/[\p{L}\p{N}.]/u.test(c) && !/[∑∏∫√∛∜]/.test(c)) {
      let word = "";
      let j = i;
      while (j < chars.length && /[\p{L}\p{N}.]/u.test(chars[j] as string)) word += chars[j++];
      // A function's name stands alone (`2sin` is `2` then `sin`); letters after digits are one run.
      const fn = [...FUNCTIONS].find((f) => word.endsWith(f) && word.length >= f.length);
      if (fn && word !== fn && FUNCTIONS.has(fn)) {
        const before = word.slice(0, word.length - fn.length);
        if (before) out.push(before);
        out.push(fn);
      } else out.push(word);
      i = j;
      continue;
    }
    out.push(c === "\t" || c === "\n" ? " " : c);
    i++;
  }
  return out;
}

// ---------- writing OMML ----------

const MATH_FONT = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const run = (text: string, plain = false) =>
  `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ""}${MATH_FONT}<m:t>${escapeXml(text)}</m:t></m:r>`;
const arg = (tag: string, node: MathNode | null) =>
  node ? `<m:${tag}>${omml(node)}</m:${tag}>` : `<m:${tag}/>`;

/** A sequence's OMML, neighbouring characters in one run as Word writes them (`-4ac`). */
function joined(items: readonly MathNode[]): string {
  let out = "";
  let text = "";
  for (const item of items) {
    if (item.kind === "text" && !item.plain) {
      text += item.text;
      continue;
    }
    if (text) out += run(text);
    text = "";
    out += omml(item);
  }
  return text ? out + run(text) : out;
}

function omml(node: MathNode): string {
  switch (node.kind) {
    case "text":
      return run(node.text, node.plain);
    case "row":
      return joined(node.items);
    case "frac":
      return `<m:f>${node.bar ? "" : '<m:fPr><m:type m:val="noBar"/></m:fPr>'}${arg("num", node.num)}${arg("den", node.den)}</m:f>`;
    case "script": {
      const base = arg("e", node.base);
      if (node.sub && node.sup)
        return `<m:sSubSup>${base}${arg("sub", node.sub)}${arg("sup", node.sup)}</m:sSubSup>`;
      return node.sub
        ? `<m:sSub>${base}${arg("sub", node.sub)}</m:sSub>`
        : `<m:sSup>${base}${arg("sup", node.sup)}</m:sSup>`;
    }
    case "rad":
      return node.deg
        ? `<m:rad>${arg("deg", node.deg)}${arg("e", node.e)}</m:rad>`
        : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${arg("e", node.e)}</m:rad>`;
    case "nary": {
      const props = [
        node.chr === "∫" ? "" : `<m:chr m:val="${escapeXml(node.chr)}"/>`,
        INTEGRALS.has(node.chr) ? "" : '<m:limLoc m:val="undOvr"/>',
        node.sub ? "" : '<m:subHide m:val="1"/>',
        node.sup ? "" : '<m:supHide m:val="1"/>',
      ].join("");
      return `<m:nary>${props ? `<m:naryPr>${props}</m:naryPr>` : ""}${arg("sub", node.sub)}${arg("sup", node.sup)}${arg("e", node.e)}</m:nary>`;
    }
    case "delim": {
      const props = [
        node.open === "(" ? "" : `<m:begChr m:val="${escapeXml(node.open)}"/>`,
        node.close === ")" ? "" : `<m:endChr m:val="${escapeXml(node.close)}"/>`,
      ].join("");
      return `<m:d>${props ? `<m:dPr>${props}</m:dPr>` : ""}${arg("e", row(node.items))}</m:d>`;
    }
    case "func": {
      const name = run(node.name, true);
      const fName = node.under
        ? `<m:limLow><m:e>${name}</m:e>${arg("lim", node.under)}</m:limLow>`
        : node.sup
          ? `<m:sSup><m:e>${name}</m:e>${arg("sup", node.sup)}</m:sSup>`
          : name;
      return `<m:func><m:fName>${fName}</m:fName>${arg("e", node.e)}</m:func>`;
    }
    case "matrix":
      return `<m:m>${node.rows.map((cells) => `<m:mr>${cells.map((c) => arg("e", c)).join("")}</m:mr>`).join("")}</m:m>`;
  }
}

// ---------- writing UnicodeMath ----------

const kid = (element: Element, name: string) =>
  [...element.children].find((child) => child.localName === name) ?? null;
function prop(element: Element, pr: string, name: string): string | null {
  const props = kid(element, pr);
  const found = props && kid(props, name);
  if (!found) return null;
  for (const attribute of found.attributes)
    if (attribute.localName === "val") return attribute.value;
  return "";
}
const on = (element: Element, pr: string, name: string) => {
  const value = prop(element, pr, name);
  return value !== null && !["0", "off", "false"].includes(value);
};

/** Whether `text` stands as one operand without brackets. */
const simple = (text: string) =>
  /^[\p{L}\p{N}.]*$/u.test(text) && text.length > 0
    ? true
    : [...text].length === 1 || (/^[([{|〖├].*[)\]}|〗┤]$/u.test(text) && balanced(text));
function balanced(text: string): boolean {
  let depth = 0;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] as string;
    if (c in OPEN) depth++;
    else if (CLOSE.has(c)) depth--;
    if (depth === 0 && i < chars.length - 1) return false;
  }
  return depth === 0;
}
/** What binds tighter than a fraction's `/` in the linear form. */
const TIGHT = new Set(["sSup", "sSub", "sSubSup", "rad", "d", "m"]);
const wrap = (text: string) => (simple(text) ? text : `(${text})`);

/**
 * An equation's OMML (`m:oMath` or `m:oMathPara`, as an `equation` node's `xml`) as Word's linear
 * format, for its box; "" for XML that is not an equation.
 */
export function ommlToUnicodeMath(xml: string, doc: Document = document): string {
  const omml = parseOpaque(xml, doc);
  return isMath(omml) ? writeLinear(omml) : "";
}

/** An equation's OMML drawn as MathML (as the pages draw it), or null for other XML. */
export function equationElement(xml: string, doc: Document = document): Element | null {
  const omml = parseOpaque(xml, doc);
  return isMath(omml) ? mathElement(omml, doc) : null;
}

function writeLinear(omml: Element): string {
  /** Its children's forms, a space where two would read as one operand (`x^k a`, `a_n cos`). */
  const content = (element: Element | null): string => {
    let out = "";
    let last: Element | null = null;
    for (const child of element ? element.children : []) {
      const piece = write(child);
      if (!piece) continue;
      const structural = (e: Element | null) => !!e && e.localName !== "r";
      if (
        /[\p{L}\p{N}.)\]}]$/u.test(out) &&
        /^[\p{L}\p{N}.]/u.test(piece) &&
        (structural(last) || structural(child))
      )
        out += " ";
      out += piece;
      last = child;
    }
    return out;
  };
  function write(element: Element): string {
    switch (element.localName) {
      case "r": {
        let text = "";
        for (const t of element.children) if (t.localName === "t") text += t.textContent ?? "";
        return text;
      }
      case "f": {
        const num = content(kid(element, "num"));
        const den = content(kid(element, "den"));
        const type = prop(element, "fPr", "type");
        if (type === "noBar") return `${num}¦${den}`;
        // A lone script, root or bracket binds tighter than `/`: no brackets around it.
        const side = (part: string, name: string) => {
          const kids = [...(kid(element, name)?.children ?? [])].filter(
            (c) => !c.localName.endsWith("Pr"),
          );
          const lone = kids.length === 1 && TIGHT.has((kids[0] as Element).localName);
          return lone ? part : wrap(part);
        };
        if (type === "lin") return `${side(num, "num")}∕${side(den, "den")}`;
        return `${side(num, "num")}/${side(den, "den")}`;
      }
      case "sSup":
        return `${wrap(content(kid(element, "e")))}^${wrap(content(kid(element, "sup")))}`;
      case "sSub":
        return `${wrap(content(kid(element, "e")))}_${wrap(content(kid(element, "sub")))}`;
      case "sSubSup":
        return `${wrap(content(kid(element, "e")))}_${wrap(content(kid(element, "sub")))}^${wrap(content(kid(element, "sup")))}`;
      case "sPre":
        return `〖_${wrap(content(kid(element, "sub")))}^${wrap(content(kid(element, "sup")))}〗${wrap(content(kid(element, "e")))}`;
      case "rad": {
        const deg = content(kid(element, "deg"));
        const e = content(kid(element, "e"));
        return deg && !on(element, "radPr", "degHide") ? `√(${deg}&${e})` : `√${wrap(e)}`;
      }
      case "nary": {
        const chr = prop(element, "naryPr", "chr") ?? "∫";
        const sub = on(element, "naryPr", "subHide") ? "" : content(kid(element, "sub"));
        const sup = on(element, "naryPr", "supHide") ? "" : content(kid(element, "sup"));
        return `${chr}${sub ? `_${wrap(sub)}` : ""}${sup ? `^${wrap(sup)}` : ""}▒${wrap(content(kid(element, "e")))}`;
      }
      case "d": {
        const begin = prop(element, "dPr", "begChr") ?? "(";
        const end = prop(element, "dPr", "endChr") ?? ")";
        const separator = prop(element, "dPr", "sepChr") ?? "|";
        const parts = [...element.children]
          .filter((c) => c.localName === "e")
          .map((e) => content(e));
        return `${begin || "├"}${parts.join(separator)}${end || "┤"}`;
      }
      case "func":
        return `${content(kid(element, "fName"))}⁡${wrap(content(kid(element, "e")))}`;
      case "limLow":
        return `${content(kid(element, "e"))}_${wrap(content(kid(element, "lim")))}`;
      case "limUpp":
        return `${content(kid(element, "e"))}^${wrap(content(kid(element, "lim")))}`;
      case "m":
        return `■(${[...element.children]
          .filter((c) => c.localName === "mr")
          .map((mr) =>
            [...mr.children]
              .filter((c) => c.localName === "e")
              .map((e) => content(e))
              .join("&"),
          )
          .join("@")})`;
      case "eqArr":
        return `█(${[...element.children]
          .filter((c) => c.localName === "e")
          .map((e) => content(e))
          .join("@")})`;
      case "acc":
        return `${wrap(content(kid(element, "e")))}${prop(element, "accPr", "chr") ?? "̂"}`;
      case "bar":
        return `${wrap(content(kid(element, "e")))}̅`;
      case "oMath":
        return content(element);
      default:
        return element.localName.endsWith("Pr") ? "" : content(element);
    }
  }
  if (omml.localName === "oMathPara")
    return [...omml.children]
      .filter((c) => c.localName === "oMath")
      .map(write)
      .join("\n");
  return write(omml);
}
