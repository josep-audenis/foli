import { describe, expect, it } from "vitest";
import {
  arrangeNotes,
  type BlockBox,
  type FlowNote,
  type FlowRules,
  type FlowSection,
  flowFrom,
  type NotePiece,
  notePieces,
  pagesOf,
} from "./flow.js";

const note = (id: string, lines: number, height = 10): FlowNote => ({
  id,
  lines: () => Array.from({ length: lines }, (_, i) => (i + 1) * height),
});
const separator = note("sep", 1, 4);
const continuation = note("cont", 1, 6);
const RULES: FlowRules = {
  orphans: 1,
  widows: 1,
  spacing: "word",
  notes: { separator, continuation },
};
/** `lines` lines of 10 px; `notes` by line. */
const block = (lines: number, notes: Record<number, FlowNote> = {}): BlockBox => ({
  height: lines * 10,
  marginTop: 0,
  marginBottom: 0,
  lines: () => Array.from({ length: lines }, (_, i) => (i + 1) * 10),
  notes: Object.keys(notes).length
    ? () => Object.entries(notes).map(([line, n]) => ({ line: Number(line), note: n }))
    : undefined,
});
const one: FlowSection = {
  start: "nextPage",
  columns: 1,
  box: () => ({ height: 100 }),
  samePage: () => true,
};
const inOne = (box: BlockBox): BlockBox => ({ ...box, section: one });
const shown = (pieces: NotePiece[]) =>
  pieces.map((p) => `${p.page}:${p.id}:${p.fromLine}-${p.toLine}`);
const flowed = (boxes: BlockBox[], rules: FlowRules = RULES, height = 100) =>
  flowFrom(boxes, height, rules);

describe("flow: footnotes", () => {
  it("puts a note at the foot of its reference's page and takes its room from the text", () => {
    const result = flowed([block(5, { 2: note("a", 2) }), block(8)]);
    expect(shown(notePieces(result))).toEqual(["0:sep:0-1", "0:a:0-2"]);
    // 100 - 4 - 20 = 76: seven lines stay after the five.
    expect(result.fragments[1]?.map((f) => [f.page, f.fromLine, f.toLine])).toEqual([
      [0, 0, 2],
      [1, 2, 8],
    ]);
  });

  it("moves a line whose note's first line does not fit, with what comes after it", () => {
    const result = flowed([block(9), block(1, { 0: note("a", 3) })]);
    // 90 + 10 for the line leaves nothing for the separator and a line.
    expect(result.fragments[1]?.[0]?.page).toBe(1);
    expect(shown(notePieces(result))).toEqual(["1:sep:0-1", "1:a:0-3"]);
  });

  it("carries the rest of a long note to the next page, under the continuation separator", () => {
    const result = flowed([block(1, { 0: note("a", 30) }), block(3)]);
    expect(shown(notePieces(result))).toEqual([
      "0:sep:0-1",
      "0:a:0-8",
      "1:cont:0-1",
      "1:a:8-16",
      "2:cont:0-1",
      "2:a:16-24",
      "3:cont:0-1",
      "3:a:24-30",
    ]);
    // The note fills its page, so the next block waits; a line of text is left on each after it.
    expect(result.fragments[1]?.map((f) => f.page)).toEqual([1, 2, 3]);
    expect(pagesOf([inOne(block(1)), inOne(block(3))], result).length).toBe(4);
  });

  it("goes on to pages of its own after the last block", () => {
    const result = flowed([block(1, { 0: note("a", 25) })]);
    const pages = notePieces(result).filter((p) => p.id === "a");
    expect(pages.map((p) => p.page)).toEqual([0, 1, 2]);
    expect(pages.at(-1)?.tail).toBe(true);
    const facts = pagesOf([inOne(block(1))], result);
    expect(facts.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("gives back a note with a line a widow rule takes back", () => {
    const rules = { ...RULES, orphans: 2, widows: 2 };
    // Line 8 would be left alone on the next page: lines 7 and 8 go together, its note with them.
    const result = flowed([block(9, { 7: note("a", 1) })], rules);
    expect(result.fragments[0]?.map((f) => [f.page, f.fromLine, f.toLine])).toEqual([
      [0, 0, 7],
      [1, 7, 9],
    ]);
    expect(shown(notePieces(result))).toEqual(["1:sep:0-1", "1:a:0-1"]);
  });

  it("puts a line on an empty page however tall its note is, first line in", () => {
    const tall = note("a", 2, 200);
    const result = flowed([block(1, { 0: tall })]);
    expect(result.fragments[0]?.[0]?.page).toBe(0);
    expect(notePieces(result).filter((p) => p.id === "a")[0]).toMatchObject({ toLine: 1 });
  });

  it("sets the notes of a section with columns across the foot of its columns", () => {
    const two = {
      start: "nextPage",
      columns: 2,
      box: () => ({ height: 100 }),
      samePage: () => true,
    } as const;
    const boxes = [
      { ...block(1, { 0: note("a", 1) }), section: two },
      { ...block(12, { 11: note("b", 1) }), section: two },
    ];
    const result = flowFrom(boxes, 100, RULES);
    // One separator; the notes belong to the band, not to a column.
    expect(notePieces(result).map((p) => [p.id, p.page, p.column ?? 0])).toEqual([
      ["sep", 0, 0],
      ["a", 0, 0],
      ["b", 0, 0],
    ]);
    // The second column's reference makes the first column's text end above the notes too.
    const tall = [
      { ...block(9), section: two },
      { ...block(9, { 8: note("b", 2) }), section: two },
    ];
    const kept = flowFrom(tall, 100, RULES);
    // 4 + 20 kept at the foot: seven lines of 76 in each column.
    expect(kept.fragments[0]?.map((f) => [f.column ?? 0, f.fromLine])).toEqual([
      [0, 0],
      [1, 7],
    ]);
    // Its reference's line went on with the text: the note is on the line's page.
    const refLine = kept.fragments[1]?.at(-1);
    expect(notePieces(kept).map((p) => p.page)).toEqual([refLine?.page, refLine?.page]);
    expect(arrangeNotes([20, 10], 2)).toEqual({ height: 20, columnOf: [0, 1] });
    expect(arrangeNotes([10, 10, 10], 2)).toEqual({ height: 20, columnOf: [0, 0, 1] });
    expect(arrangeNotes([10, 30], 1).height).toBe(40);
  });
});

describe("flow: endnotes", () => {
  const end = (...notes: FlowNote[]): BlockBox => ({ ...block(1), endnotes: notes });

  it("follow the block they end, and go on over the page", () => {
    const result = flowed([block(5), end(separator, note("x", 2), note("y", 8))]);
    const pieces = notePieces(result);
    expect(pieces.every((p) => p.end)).toBe(true);
    expect(shown(pieces)).toEqual(["0:sep:0-1", "0:x:0-2", "0:y:0-1", "1:y:1-8"]);
  });

  it("share a page with a footnote carried to it", () => {
    const result = flowed([block(1, { 0: note("a", 12) }), end(separator, note("x", 1))]);
    const onLast = notePieces(result).filter((p) => p.page === 1);
    expect(onLast.map((p) => p.id)).toEqual(["cont", "a", "sep", "x"]);
    expect(onLast.map((p) => !!p.end)).toEqual([false, false, true, true]);
  });
});

describe("flow: notes and incremental reflow", () => {
  const random = (seed: number) => {
    let x = seed;
    return (n: number) => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return x % n;
    };
  };

  it("gives what a full flow gives, whatever changes", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = random(seed);
      const make = (i: number): BlockBox => {
        const lines = 1 + r(6);
        return block(lines, r(3) ? {} : { [r(lines)]: note(`n${i}`, 1 + r(16)) });
      };
      let boxes = Array.from({ length: 24 }, (_, i) => make(i));
      let previous = flowFrom(boxes, 100, RULES);
      for (let edit = 0; edit < 12; edit++) {
        const at = r(boxes.length);
        const after = [...boxes];
        after[at] = make(100 + edit);
        const incremental = flowFrom(after, 100, RULES, {
          previous,
          from: at,
          previousIndex: (i) => (i > at ? i : -1),
        });
        expect(incremental).toEqual(flowFrom(after, 100, RULES));
        boxes = after;
        previous = incremental;
      }
    }
  });
});
