/** Toy model: plain-text paragraphs. Throwaway — the real model is Phase 2/3 work. */

export interface Pos {
  p: number;
  o: number;
}

export interface Sel {
  anchor: Pos;
  head: Pos;
}

export const cmp = (a: Pos, b: Pos): number => a.p - b.p || a.o - b.o;

export function ordered(sel: Sel): [Pos, Pos] {
  return cmp(sel.anchor, sel.head) <= 0 ? [sel.anchor, sel.head] : [sel.head, sel.anchor];
}

/** Replace [from, to) with text; "\n" in text splits paragraphs. Returns new paragraphs and caret. */
export function replace(
  paras: readonly string[],
  from: Pos,
  to: Pos,
  text: string,
): { paras: string[]; caret: Pos } {
  const before = (paras[from.p] ?? "").slice(0, from.o);
  const after = (paras[to.p] ?? "").slice(to.o);
  const lines = text.split("\n");
  const last = lines.length - 1;
  const inserted = lines.map(
    (line, i) => (i === 0 ? before : "") + line + (i === last ? after : ""),
  );
  const next = [...paras.slice(0, from.p), ...inserted, ...paras.slice(to.p + 1)];
  const caret = {
    p: from.p + last,
    o: (last === 0 ? before.length : 0) + (lines[last] ?? "").length,
  };
  return { paras: next, caret };
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Range covering one character before/after pos, crossing paragraph boundaries. Null at doc edges. */
export function charRange(paras: readonly string[], pos: Pos, dir: -1 | 1): [Pos, Pos] | null {
  const text = paras[pos.p] ?? "";
  if (dir < 0) {
    if (pos.o > 0) {
      const step = isLowSurrogate(text.charCodeAt(pos.o - 1)) && pos.o > 1 ? 2 : 1;
      return [{ p: pos.p, o: pos.o - step }, pos];
    }
    return pos.p > 0 ? [{ p: pos.p - 1, o: (paras[pos.p - 1] ?? "").length }, pos] : null;
  }
  if (pos.o < text.length) {
    const step = isLowSurrogate(text.charCodeAt(pos.o + 1)) ? 2 : 1;
    return [pos, { p: pos.p, o: pos.o + step }];
  }
  return pos.p < paras.length - 1 ? [pos, { p: pos.p + 1, o: 0 }] : null;
}
