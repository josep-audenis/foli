/** Line breaking and pagination for the landing page's drawings. The real engine is not used here. */

export type BlockKind = "title" | "heading" | "body";

export interface Word {
  id: number;
  text: string;
  /** Inline style names: "strong", "em", "mark", or a review state set by the scene. */
  marks: string[];
  /** No space before it: punctuation after an inline element. */
  glued: boolean;
  /** Tracked change or comment it belongs to. */
  change?: string;
  kind?: "ins" | "del" | "comment";
}

export interface Block {
  kind: BlockKind;
  words: Word[];
}

export interface BlockStyle {
  size: number;
  line: number;
  before: number;
  after: number;
  keepNext: boolean;
}

export type Styles = Record<BlockKind, BlockStyle>;
export type Measure = (word: Word, kind: BlockKind) => number;

export interface LineWord {
  word: Word;
  x: number;
  width: number;
}

export interface FlowBlock {
  kind: BlockKind;
  lines: LineWord[][];
}

export interface PlacedLine {
  block: number;
  line: number;
  page: number;
  y: number;
}

export type RuleBreak = "widow" | "orphan" | "stranded";

export interface Flag {
  kind: RuleBreak;
  page: number;
  y: number;
}

export interface Rules {
  widows: boolean;
  keepWithNext: boolean;
}

/** Greedy line breaking of the visible words at `width`. */
export function flow(
  blocks: readonly Block[],
  width: number,
  measure: Measure,
  space: (kind: BlockKind) => number,
  visible: (word: Word) => boolean = () => true,
): FlowBlock[] {
  return blocks.map((block) => {
    const gap = space(block.kind);
    const lines: LineWord[][] = [];
    let line: LineWord[] = [];
    let x = 0;
    for (const word of block.words) {
      if (!visible(word)) continue;
      const w = measure(word, block.kind);
      const start = line.length === 0 || word.glued ? x : x + gap;
      if (line.length > 0 && !word.glued && start + w > width) {
        lines.push(line);
        line = [{ word, x: 0, width: w }];
        x = w;
      } else {
        line.push({ word, x: start, width: w });
        x = start + w;
      }
    }
    if (line.length > 0) lines.push(line);
    return { kind: block.kind, lines };
  });
}

/** Cuts flowed blocks into pages of `height`, then reports the rules the result breaks. */
export function paginate(
  blocks: readonly FlowBlock[],
  styles: Styles,
  height: number,
  rules: Rules,
): { lines: PlacedLine[]; pages: number; flags: Flag[] } {
  const lines: PlacedLine[] = [];
  let page = 0;
  let y = 0;
  let empty = true;
  const nextPage = () => {
    page++;
    y = 0;
    empty = true;
  };

  blocks.forEach((block, index) => {
    const style = styles[block.kind];
    const count = block.lines.length;
    if (count === 0) return;
    let done = 0;
    while (done < count) {
      const gap = empty || done > 0 ? 0 : style.before;
      const fit = Math.floor((height - y - gap) / style.line);
      const left = count - done;
      let take = Math.min(left, Math.max(fit, 0));

      if (rules.widows && take < left) {
        // A single line must not be left over for the next page, nor stay alone on this one.
        if (left - take === 1) take--;
        if (take === 1 && done === 0) take = 0;
      }
      if (rules.keepWithNext && style.keepNext && take === left && done === 0 && !empty) {
        const next = blocks[index + 1];
        if (next && next.lines.length > 0) {
          const after = styles[next.kind];
          const need = Math.min(rules.widows ? 2 : 1, next.lines.length) * after.line;
          const bottom = y + gap + left * style.line + style.after + after.before + need;
          if (bottom > height) take = 0;
        }
      }
      if (take <= 0) {
        if (!empty) {
          nextPage();
          continue;
        }
        take = 1; // Taller than a page: it has to go somewhere.
      }

      y += gap;
      for (let i = 0; i < take; i++) {
        lines.push({ block: index, line: done + i, page, y });
        y += style.line;
      }
      empty = false;
      done += take;
      if (done < count) nextPage();
    }
    y += style.after;
  });

  return { lines, pages: page + 1, flags: findBreaks(lines, blocks, styles) };
}

function findBreaks(
  lines: readonly PlacedLine[],
  blocks: readonly FlowBlock[],
  styles: Styles,
): Flag[] {
  const flags: Flag[] = [];
  lines.forEach((line, i) => {
    const block = blocks[line.block];
    if (!block) return;
    const count = block.lines.length;
    const next = lines[i + 1];
    const previous = lines[i - 1];
    const endsPage = !!next && next.page !== line.page;
    const startsPage = !!previous && previous.page !== line.page;
    if (startsPage && count > 1 && line.line === count - 1) {
      flags.push({ kind: "widow", page: line.page, y: line.y });
    }
    if (endsPage && count > 1 && line.line === 0) {
      flags.push({ kind: "orphan", page: line.page, y: line.y });
    }
    if (endsPage && styles[block.kind].keepNext && line.line === count - 1) {
      flags.push({ kind: "stranded", page: line.page, y: line.y });
    }
  });
  return flags;
}
