import type { XmlDocument, XmlNode } from "../xml.js";

/** The source rebuilt from the tree's offsets: equal to the source only if nothing is missed. */
export function rebuild(doc: XmlDocument): string {
  const node = (n: XmlNode): string =>
    n.kind === "element"
      ? doc.source.slice(n.start, n.openEnd) +
        n.children.map(node).join("") +
        doc.source.slice(n.closeStart, n.end)
      : doc.source.slice(n.start, n.end);
  return doc.children.map(node).join("");
}
