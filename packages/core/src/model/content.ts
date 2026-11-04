import type { Fragment } from "./fragment.js";
import type { NodeType } from "./schema.js";

/**
 * Content expressions, a deliberately small subset: a space-separated sequence of terms; a term
 * is a node name or group, or a choice `(a | b)`, optionally followed by `*`, `+` or `?`.
 * Examples: `block+`, `inline*`, `heading paragraph*`, `(paragraph | heading)+`.
 * Compiled to an NFA whose state sets are interned, so matching allocates nothing once warm.
 */

interface Element {
  readonly types: readonly NodeType[];
  readonly optional: boolean;
  readonly repeat: boolean;
}

class Program {
  readonly matches = new Map<string, ContentMatch>();
  constructor(
    readonly expr: string,
    readonly elements: readonly Element[],
  ) {}

  /** The interned match for a state set (sorted, epsilon-closed). */
  match(states: number[]): ContentMatch {
    const key = states.join(",");
    let match = this.matches.get(key);
    if (!match) {
      match = new ContentMatch(this, states);
      this.matches.set(key, match);
    }
    return match;
  }

  /** Adds the states reachable by skipping optional elements; returns them sorted. */
  close(states: Iterable<number>): number[] {
    const out = new Set<number>();
    for (let state of states) {
      out.add(state);
      while (state < this.elements.length && this.elements[state]?.optional) out.add(++state);
    }
    return [...out].sort((a, b) => a - b);
  }
}

/** A position inside a content expression: which node types may come next, and whether it may end. */
export class ContentMatch {
  private readonly next = new Map<NodeType, ContentMatch | null>();
  /** True when the content may end here. */
  readonly validEnd: boolean;

  /** @internal Use NodeType.contentMatch. */
  constructor(
    private readonly program: Program,
    private readonly states: readonly number[],
  ) {
    this.validEnd = states.includes(program.elements.length);
  }

  /** The match after a node of `type`, or null if `type` is not allowed here. */
  matchType(type: NodeType): ContentMatch | null {
    let result = this.next.get(type);
    if (result === undefined) {
      const reached: number[] = [];
      for (const state of this.states) {
        const element = this.program.elements[state];
        if (element?.types.includes(type)) reached.push(element.repeat ? state : state + 1);
      }
      result = reached.length ? this.program.match(this.program.close(reached)) : null;
      this.next.set(type, result);
    }
    return result;
  }

  /** Matches `fragment.child(start)` up to `end`; null as soon as a child is not allowed. */
  matchFragment(fragment: Fragment, start = 0, end = fragment.childCount): ContentMatch | null {
    let match: ContentMatch | null = this;
    for (let i = start; match && i < end; i++) match = match.matchType(fragment.child(i).type);
    return match;
  }

  /** True when the expression's node types are inline (all are, or none are). */
  get inlineContent(): boolean {
    return this.program.elements[0]?.types[0]?.isInline ?? false;
  }

  toString(): string {
    return this.program.expr;
  }

  static compile(expr: string, types: readonly NodeType[]): ContentMatch {
    const program = new Program(expr, parse(expr, types));
    const inline = program.elements.flatMap((e) => e.types).map((t) => t.isInline);
    if (inline.some((value) => value !== inline[0])) {
      throw new Error(`Content expression "${expr}" mixes inline and block nodes`);
    }
    return program.match(program.close([0]));
  }
}

function parse(expr: string, types: readonly NodeType[]): Element[] {
  const tokens = expr.match(/\w+|[()|*+?]|\S/g) ?? [];
  const elements: Element[] = [];
  let pos = 0;
  const error = (message: string): never => {
    throw new Error(`Invalid content expression "${expr}": ${message}`);
  };
  const resolve = (name: string | undefined): NodeType[] => {
    if (name === undefined || !/^\w+$/.test(name)) return error(`expected a name, got ${name}`);
    const found = types.filter((t) => t.name === name);
    const matched = found.length ? found : types.filter((t) => t.groups.includes(name));
    return matched.length ? matched : error(`no node type or group "${name}"`);
  };
  while (pos < tokens.length) {
    let choice: NodeType[];
    if (tokens[pos] === "(") {
      pos++;
      choice = resolve(tokens[pos++]);
      while (tokens[pos] === "|") {
        pos++;
        choice = choice.concat(resolve(tokens[pos++]));
      }
      if (tokens[pos++] !== ")") error('expected ")"');
    } else {
      choice = resolve(tokens[pos++]);
    }
    const quantifier = tokens[pos];
    if (quantifier === "*" || quantifier === "+" || quantifier === "?") pos++;
    if (quantifier === "+") elements.push({ types: choice, optional: false, repeat: false });
    elements.push({
      types: choice,
      optional: quantifier === "*" || quantifier === "+" || quantifier === "?",
      repeat: quantifier === "*" || quantifier === "+",
    });
  }
  return elements;
}
