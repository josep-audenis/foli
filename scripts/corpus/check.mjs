// One file through the corpus run's checks (Phase 20, ADR-0011), in Node: import, export without
// edits compared part by part, a second import, an edit then an export. What it returns holds
// counts, element and attribute names, never document text. Runs on the built packages
// (`pnpm build`): the published code.

// Loaded when a file is checked (tests of the comparison run before `pnpm build`).
const built = async () => ({
  ...(await import("../../packages/core/dist/index.js")),
  ...(await import("../../packages/docx/dist/index.js")),
});

/** Errors that say a file is refused (damaged, not a .docx, over a limit), not a bug. */
const REFUSALS = new Set(["DocxError", "ZipError", "XmlError", "XmlLimitError"]);

/** An error as a result: its class and the first line of its message, capped. */
const describe = (error) => ({
  name: error?.name ?? "Error",
  message: String(error?.message ?? error)
    .split("\n")[0]
    .slice(0, 200),
  // Where a crash happened: the first frame in Foli's code.
  at: String(error?.stack ?? "")
    .split("\n")
    .find((line) => line.includes("packages"))
    ?.trim()
    .replace(/^at /, "")
    .replace(/.*[\\/]packages[\\/]/, "packages/"),
});

const xmlType = (part) => /xml$/i.test(part.contentType) || /\.(xml|rels)$/i.test(part.name);

/** An element's or attribute's name for a report: the namespace's last segment and its name. */
const nameOf = (node) => `${node.ns ? (node.ns.split("/").pop() ?? node.ns) : ""}:${node.local}`;

/**
 * What an XML part holds, prefix and order aside: how many of each element, how many of each
 * attribute value per element (the values counted, never reported), and how many characters of
 * text (whitespace-only text between elements is not counted).
 */
function census(source, parseXml) {
  const elements = new Map();
  const values = new Map();
  let text = 0;
  const add = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  const walk = (element) => {
    const name = nameOf(element);
    add(elements, name);
    for (const attribute of element.attributes) {
      if (attribute.prefix === "xmlns" || (!attribute.prefix && attribute.local === "xmlns"))
        continue;
      add(values, `${name}@${nameOf(attribute)}\u0000${attribute.value}`);
    }
    for (const child of element.children) {
      if (child.kind === "element") walk(child);
      else if (child.kind === "text" && child.text.trim()) text += child.text.trim().length;
    }
  };
  walk(parseXml(source).root);
  return { elements, values, text };
}

/**
 * How an exported XML part differs from the original's: elements lost or added (by name),
 * attributes whose values changed (by element and attribute name), characters of text lost.
 */
export function compareXml(original, exported, parseXml) {
  if (original === exported) return null;
  const a = census(original, parseXml);
  const b = census(exported, parseXml);
  const lost = [];
  const added = [];
  for (const [name, n] of a.elements) if ((b.elements.get(name) ?? 0) < n) lost.push(name);
  for (const [name, n] of b.elements) if ((a.elements.get(name) ?? 0) < n) added.push(name);
  const changed = new Set();
  for (const [key, n] of a.values)
    if ((b.values.get(key) ?? 0) !== n) changed.add(key.split("\u0000")[0]);
  for (const [key, n] of b.values)
    if ((a.values.get(key) ?? 0) !== n) changed.add(key.split("\u0000")[0]);
  const textLost = Math.max(a.text - b.text, 0);
  const textAdded = Math.max(b.text - a.text, 0);
  if (!lost.length && !added.length && !changed.size && !textLost && !textAdded)
    return { kind: "order" };
  return { kind: "content", lost, added, changed: [...changed], textLost, textAdded };
}

/** The first key path where two JSON values differ (keys and indexes only, never values). */
export function firstDifference(a, b, path = "") {
  if (a === b) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return path || "(root)";
  if (Array.isArray(a) !== Array.isArray(b)) return path || "(root)";
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const found = firstDifference(a[key], b[key], `${path}/${key}`);
    if (found) return found;
  }
  return null;
}

/** The checks of one file. Never throws: every failure is in the result. */
export async function checkFile(bytes) {
  const { createEditor, exportDocx, importDocx, parseDocument, parseXml, readPackage, Selection } =
    await built();
  const result = { size: bytes.length, times: {} };
  const timed = async (step, run) => {
    const start = performance.now();
    try {
      return await run();
    } finally {
      result.times[step] = Math.round(performance.now() - start);
    }
  };

  let imported;
  try {
    imported = await timed("import", () => importDocx(bytes));
  } catch (error) {
    result.import = REFUSALS.has(error?.name) ? "refused" : "crash";
    result.error = describe(error);
    return result;
  }
  result.import = "ok";
  const { document, report } = imported;
  result.opaque = report.opaque;
  result.dropped = report.dropped;
  result.unmodeled = report.unmodeledCount;
  result.schemaVersion = document.schemaVersion;

  // Export without edits, compared part by part with the file.
  let exported;
  try {
    exported = await timed("export", () => exportDocx(document, imported.package));
    const before = imported.package;
    const after = await readPackage(exported);
    const names = new Set(after.parts.map((p) => p.name));
    const kept = new Set(before.parts.map((p) => p.name));
    const parts = {
      lost: before.parts.filter((p) => !names.has(p.name)).map((p) => p.name),
      added: after.parts.filter((p) => !kept.has(p.name)).map((p) => p.name),
      changed: [],
    };
    for (const part of before.parts) {
      const other = after.part(part.name);
      if (!other) continue;
      if (!xmlType(part)) {
        if (Buffer.compare(Buffer.from(part.data), Buffer.from(other.data)))
          parts.changed.push({ part: part.name, kind: "bytes" });
        continue;
      }
      const diff = compareXml(before.text(part.name), after.text(part.name), parseXml);
      if (diff) parts.changed.push({ part: part.name, ...diff });
    }
    result.export = parts;
  } catch (error) {
    result.export = { crash: describe(error) };
    return result;
  }

  // A second import of the export: the same document.
  try {
    const again = await timed("reimport", () => importDocx(exported));
    const difference = firstDifference(
      JSON.parse(JSON.stringify(document)),
      JSON.parse(JSON.stringify(again.document)),
    );
    result.reimport = difference ? { differs: difference } : "same";
  } catch (error) {
    result.reimport = { crash: describe(error) };
  }

  // An edit (a character typed at the document's start) then an export that reads back.
  try {
    await timed("edit", async () => {
      const editor = createEditor({ document });
      editor.dispatch(editor.state.tr.setSelection(Selection.atStart(editor.state.doc)));
      editor.commands.insertText("x");
      const out = await exportDocx(editor.getDocument(), imported.package);
      parseDocument((await importDocx(out)).document);
    });
    result.edit = "ok";
  } catch (error) {
    result.edit = { crash: describe(error) };
  }
  return result;
}
