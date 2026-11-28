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
  /** A delimiter: its parts, split by its separators (`(a│b)`). */
  | { kind: "delim"; open: string; close: string; parts: MathNode[][] }
  | {
      kind: "func";
      name: string;
      under: MathNode | null;
      sub: MathNode | null;
      sup: MathNode | null;
      e: MathNode;
    }
  | { kind: "matrix"; rows: MathNode[][] };

const row = (items: MathNode[]): MathNode =>
  items.length === 1 ? (items[0] as MathNode) : { kind: "row", items };

/** A delimiter's separators inside it (Word's linear format writes `│`). */
const SEPARATORS = new Set(["│", "∣"]);
/** Postfix marks that stay with their operand (`1!`, `f′`). */
const POSTFIX = new Set(["!", "′", "″", "'"]);
/** How deep brackets and operators nest at most: deeper input is refused. */
const MAX_DEPTH = 200;

/** Thrown for a linear form too deeply nested to read. */
export class LinearFormError extends Error {}

// ---------- reading UnicodeMath ----------

/**
 * Reads Word's linear format into OMML as Word writes it (`<m:oMath>…</m:oMath>`, in an
 * `m:oMathPara` for a display equation, one `m:oMath` a line): an `equation` node's `xml`.
 * Throws `LinearFormError` for input nested deeper than an equation is.
 */
export function unicodeMathToOmml(source: string, display = true): string {
  const lines = display ? source.split(/\r?\n/).filter((line) => line.trim()) : [source];
  const maths = (lines.length ? lines : [""]).map(
    (line) => `<m:oMath>${joined(read(line))}</m:oMath>`,
  );
  return display ? `<m:oMathPara>${maths.join("")}</m:oMathPara>` : (maths[0] as string);
}

function read(source: string): MathNode[] {
  const tokens = tokenize(source);
  let at = 0;
  let depth = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const deeper = <T>(work: () => T): T => {
    if (++depth > MAX_DEPTH) throw new LinearFormError("The equation is nested too deeply");
    try {
      return work();
    } finally {
      depth--;
    }
  };

  /** A sequence up to one of `stops` (not consumed). */
  function sequence(stops: ReadonlySet<string>): MathNode[] {
    return deeper(() => {
      const items: MathNode[] = [];
      while (at < tokens.length && !stops.has(peek() as string)) {
        const token = peek() as string;
        if (token === " ") {
          next();
          continue;
        }
        if (token === "/" && items.length) {
          next();
          const num = unwrap(items.pop() as MathNode);
          const den = postfix(scripted(operand()));
          items.push({ kind: "frac", num, den, bar: true });
          continue;
        }
        const item = primary();
        if (item) items.push(...scriptedItems(item));
      }
      return items;
    });
  }

  /** A bracketed group's content, its brackets left out (an argument's or a fraction's). */
  const unwrap = (node: MathNode): MathNode =>
    node.kind === "delim" &&
    node.open === "(" &&
    node.close === ")" &&
    node.parts.length === 1 &&
    // A binomial keeps its brackets: (n¦k).
    !(node.parts[0]?.length === 1 && node.parts[0][0]?.kind === "frac" && !node.parts[0][0].bar)
      ? row(node.parts[0] as MathNode[])
      : node;

  /** `node` with the postfix marks after it (`1!`). */
  function postfix(node: MathNode): MathNode {
    const items = [node];
    while (POSTFIX.has(peek() as string)) {
      const mark = next() as string;
      items.push({ kind: "text", text: mark === "'" ? "′" : mark });
    }
    return row(items);
  }

  /**
   * An item with its scripts: on a run's last letter (`πr^2`, `4ac^2`), or its trailing digits.
   */
  function scriptedItems(item: MathNode): MathNode[] {
    if (peek() !== "_" && peek() !== "^") return [item];
    if (item.kind === "text" && !item.plain && [...item.text].length > 1) {
      const chars = [...item.text];
      const digits = /\d+$/.exec(item.text)?.[0] ?? "";
      const tail = digits && digits !== item.text ? digits : (chars.at(-1) as string);
      const head = item.text.slice(0, item.text.length - tail.length);
      if (head) return [{ kind: "text", text: head }, scripted({ kind: "text", text: tail })];
    }
    return [scripted(item)];
  }

  /** Subscripts and superscripts after `base`; a second of a kind nests (`x^2^3`). */
  function scripted(base: MathNode): MathNode {
    let sub: MathNode | null = null;
    let sup: MathNode | null = null;
    while (peek() === "_" || peek() === "^") {
      const mark = next();
      if ((mark === "_" && sub) || (mark === "^" && sup)) {
        // The script already there takes this one: x^2^3 is x^(2^3).
        const nested = scriptOn((mark === "_" ? sub : sup) as MathNode, mark, postfix(operand()));
        if (mark === "_") sub = nested;
        else sup = nested;
        continue;
      }
      const value = postfix(operand());
      if (mark === "_") sub = value;
      else sup = value;
    }
    return sub || sup ? { kind: "script", base, sub, sup } : base;
  }
  const scriptOn = (base: MathNode, mark: string, value: MathNode): MathNode => ({
    kind: "script",
    base,
    sub: mark === "_" ? value : null,
    sup: mark === "^" ? value : null,
  });

  /** An operator's argument: a bracketed group without its brackets, or one primary. */
  function operand(): MathNode {
    while (peek() === " ") next();
    const token = peek();
    if (token === "〖") {
      next();
      const inner = sequence(new Set(["〗"]));
      next();
      return row(inner);
    }
    if (token === "(") return unwrap(primary() as MathNode);
    return primary() ?? { kind: "row", items: [] };
  }

  /** The parts of a bracket's content up to any closing bracket, and the one that closed it. */
  function group(open: string): { parts: MathNode[][]; close: string; binomial: MathNode | null } {
    const stops = new Set([...CLOSE, "¦", ...SEPARATORS]);
    const parts: MathNode[][] = [sequence(stops)];
    let binomial: MathNode | null = null;
    while (SEPARATORS.has(peek() as string) || peek() === "¦") {
      if (next() === "¦") {
        const den = sequence(new Set([...CLOSE, ...SEPARATORS]));
        binomial = { kind: "frac", num: row(parts.pop() as MathNode[]), den: row(den), bar: false };
        parts.push([binomial]);
      } else parts.push(sequence(stops));
    }
    // Any closing bracket ends it (`[0,1)`); none at the end of the text: its own.
    const close = CLOSE.has(peek() as string) ? (next() as string) : (OPEN[open] as string);
    return { parts, close, binomial };
  }

  function primary(): MathNode | null {
    return deeper(() => {
      const token = next();
      if (token === undefined) return null;
      if (token in OPEN) {
        const { parts, close } = group(token);
        if (token === "〖") return row(parts.flat());
        return {
          kind: "delim",
          open: token === "├" ? "" : token,
          close: close === "┤" ? "" : close,
          parts,
        };
      }
      if (token === "|" || token === "‖") {
        const inner = sequence(new Set([token]));
        next();
        return { kind: "delim", open: token, close: token, parts: [inner] };
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
        let sub: MathNode | null = null;
        let sup: MathNode | null = null;
        while (peek() === "_" || peek() === "^") {
          const mark = next();
          const value = operand();
          if (mark === "_") sub = value;
          else sup = value;
        }
        if (peek() === "⁡") next();
        const e = scripted(operand());
        // lim_(n→∞): the limit under it (Word's `m:limLow`); log_2, sin^2: scripts on the name.
        const under = UNDER.has(token) ? sub : null;
        return { kind: "func", name: token, under, sub: under ? null : sub, sup, e };
      }
      if (token === "⁡") return null;
      return { kind: "text", text: token };
    });
  }

  return sequence(new Set());
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
      const parts = node.parts.map((part) => `<m:e>${joined(part)}</m:e>`).join("");
      return `<m:d>${props ? `<m:dPr>${props}</m:dPr>` : ""}${parts}</m:d>`;
    }
    case "func": {
      const name = run(node.name, true);
      const e = `<m:e>${name}</m:e>`;
      const fName = node.under
        ? `<m:limLow>${e}${arg("lim", node.under)}</m:limLow>`
        : node.sub && node.sup
          ? `<m:sSubSup>${e}${arg("sub", node.sub)}${arg("sup", node.sup)}</m:sSubSup>`
          : node.sub
            ? `<m:sSub>${e}${arg("sub", node.sub)}</m:sSub>`
            : node.sup
              ? `<m:sSup>${e}${arg("sup", node.sup)}</m:sSup>`
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
  // A run, its postfix marks with it (`1!`).
  /^[\p{L}\p{N}.]+[!′″]*$/u.test(text)
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
const TIGHT = new Set(["sSup", "sSub", "sSubSup", "rad", "m"]);
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
        // After a script or other structure; before one, its base is the run's last letter.
        structural(last)
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
        // Word's linear format separates a delimiter's parts with `│`, whatever it draws.
        const separator = "│";
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
