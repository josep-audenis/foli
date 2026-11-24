/**
 * How much an open document weighs: about the characters of its JSON, the body's, the
 * stories' and the comments', formatting and attributes included. What one call may make of
 * a document is held by this, whatever the call is: four reviews of code mode each found
 * another way for a short call to make a document far larger than it was (a replacement
 * times its places, a merge value times its fields, a picture, a reference copying its
 * bookmark's formatting), and each was a way of adding weight that a count of characters or
 * positions did not see.
 *
 * Cached per node and per mark: a document is a tree of values that an edit replaces along
 * one path, so weighing it again after a call costs what the call changed.
 */
import type { Session } from "@folijs/agent";
import type { Mark, Node } from "@folijs/core";
import { wordContext } from "@folijs/core/internal";

const nodes = new WeakMap<Node, number>();
const marks = new WeakMap<Mark, number>();
const objects = new WeakMap<object, number>();

const json = (value: unknown) => JSON.stringify(value)?.length ?? 0;

function markWeight(mark: Mark): number {
  let w = marks.get(mark);
  if (w === undefined) {
    w = json(mark.toJSON());
    marks.set(mark, w);
  }
  return w;
}

function nodeWeight(node: Node): number {
  let w = nodes.get(node);
  if (w !== undefined) return w;
  w = node.type.name.length + json(node.attrs) + (node.text?.length ?? 0);
  for (const mark of node.marks) w += markWeight(mark);
  let children = 0;
  node.forEach((child) => {
    children += nodeWeight(child);
  });
  w += children;
  nodes.set(node, w);
  return w;
}

function objectWeight(value: object): number {
  let w = objects.get(value);
  if (w === undefined) {
    w = json(value);
    objects.set(value, w);
  }
  return w;
}

/** @internal The document's weight now. */
export function weight(session: Session): number {
  const { state } = session.editor;
  let w = nodeWeight(state.doc);
  const word = wordContext(state);
  if (word) {
    for (const story of word.stories.values()) w += nodeWeight(story.doc);
    w += objectWeight(word.envelope.comments);
    // Pictures' bytes, as data URLs: what an inserted picture adds (23.6).
    for (const resource of Object.values(word.envelope.resources ?? {}))
      w += (resource as { data?: string }).data?.length ?? 0;
  }
  return w;
}

/**
 * @internal
 * How much heavier a document may become than it was when opened. Its own size bounds what
 * it starts at (64 MB unpacked); this bounds what the edits of a session can add to it, and so
 * the memory a save needs.
 */
export const MAX_GROWTH = 16_000_000;
