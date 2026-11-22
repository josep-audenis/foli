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
const errorOf = (error) => ({
  name: error?.name ?? "Error",
  message: String(error?.message ?? error)
    .split("\n")[0]
    .slice(0, 200),
  // Where a crash happened: the first frame in Foli's code.
  at:
    String(error?.stack ?? "")
      .split("\n")
      .find((line) => line.includes("packages"))
      ?.match(/packages[\\/][^\s)]+/)?.[0]
      .replaceAll("\\", "/") ?? "(no frame)",
});

const xmlType = (part) => /xml$/i.test(part.contentType) || /\.(xml|rels)$/i.test(part.name);

/** Prefixes for the namespaces a report names most (others: the URI's last segment). */
const PREFIXES = {
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main": "w",
  "http://schemas.openxmlformats.org/drawingml/2006/main": "a",
  "http://schemas.openxmlformats.org/drawingml/2006/picture": "pic",
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing": "wp",
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships": "r",
  "http://schemas.openxmlformats.org/package/2006/relationships": "rel",
  "http://schemas.openxmlformats.org/package/2006/content-types": "ct",
  "http://schemas.openxmlformats.org/markup-compatibility/2006": "mc",
  "http://schemas.microsoft.com/office/word/2010/wordml": "w14",
  "http://schemas.microsoft.com/office/word/2012/wordml": "w15",
  "http://www.w3.org/XML/1998/namespace": "xml",
  "urn:schemas-microsoft-com:vml": "v",
  "urn:schemas-microsoft-com:office:office": "o",
};
/** The key of an element or attribute: its full namespace and name (prefixes aside). */
const keyOf = (node) => `${node.ns}|${node.local}`;
/** That key as a report shows it. */
const shown = (key) => {
  const [ns, local] = key.split("|");
  return `${PREFIXES[ns] ?? (ns ? ns.split(/[/:]/).pop() : "")}:${local}`;
};

/**
 * What an XML part holds, prefix and order aside: how many of each element, how many of each
 * attribute value per element, and each element's text exactly (spaces included), counted, the
 * values and the text never reported. Whitespace-only text between elements is not counted.
 * shortcut: values swapped between two elements of one name read as no difference.
 */
function census(source, parseXml) {
  const elements = new Map();
  const values = new Map();
  const texts = new Map();
  let chars = 0;
  const add = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  const walk = (element) => {
    const key = keyOf(element);
    add(elements, key);
    for (const attribute of element.attributes) {
      if (attribute.prefix === "xmlns" || (!attribute.prefix && attribute.local === "xmlns"))
        continue;
      add(values, `${key}@${keyOf(attribute)}\u0000${attribute.value}`);
    }
    for (const child of element.children) {
      if (child.kind === "element") walk(child);
      else if (child.kind === "text" && child.text.trim()) {
        add(texts, `${key}\u0000${child.text}`);
        chars += child.text.length;
      }
    }
  };
  walk(parseXml(source).root);
  return { elements, values, texts, chars };
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
  for (const [key, n] of a.elements) if ((b.elements.get(key) ?? 0) < n) lost.push(shown(key));
  for (const [key, n] of b.elements) if ((a.elements.get(key) ?? 0) < n) added.push(shown(key));
  const differs = (x, y, into) => {
    for (const [key, n] of x)
      if ((y.get(key) ?? 0) !== n) {
        const [element, attribute] = key.split("\u0000")[0].split("@");
        into.add(attribute ? `${shown(element)}@${shown(attribute)}` : shown(element));
      }
  };
  const changed = new Set();
  differs(a.values, b.values, changed);
  differs(b.values, a.values, changed);
  // Text that is not the same, by element (a lost space, a word replaced, text moved).
  const text = new Set();
  differs(a.texts, b.texts, text);
  differs(b.texts, a.texts, text);
  if (!lost.length && !added.length && !changed.size && !text.size) return { kind: "equivalent" };
  return {
    kind: "content",
    lost,
    added,
    changed: [...changed],
    text: [...text],
    textLost: Math.max(a.chars - b.chars, 0),
    textAdded: Math.max(b.chars - a.chars, 0),
  };
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

/** The checks of one file: every failure of Foli's is in the result. */
export async function checkFile(bytes) {
  const { createEditor, exportDocx, importDocx, parseXml, readPackage, Selection } = await built();
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
    // The model refusing what the importer built is Foli's bug, not the file's.
    const modelRejected = error?.cause?.name === "FoliDocumentError";
    result.import = REFUSALS.has(error?.name) && !modelRejected ? "refused" : "crash";
    result.error = errorOf(modelRejected ? error.cause : error);
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
      try {
        const diff = compareXml(before.text(part.name), after.text(part.name), parseXml);
        if (diff) parts.changed.push({ part: part.name, ...diff });
      } catch (error) {
        // A part this comparison cannot read (the export may still be fine).
        parts.changed.push({ part: part.name, kind: "unreadable", error: errorOf(error) });
      }
    }
    result.export = parts;
  } catch (error) {
    result.export = { crash: errorOf(error) };
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
    result.reimport = { crash: errorOf(error) };
  }

  // An edit (a character typed at the document's start) then an export that reads back.
  try {
    await timed("edit", async () => {
      const editor = createEditor({ document });
      editor.dispatch(editor.state.tr.setSelection(Selection.atStart(editor.state.doc)));
      const before = editor.state.doc.textContent.length;
      editor.commands.insertText("x");
      // Typed where the document starts (a picture or opaque content there takes none).
      const typed = editor.state.doc.textContent.length === before + 1;
      const out = await exportDocx(editor.getDocument(), imported.package);
      const back = (await importDocx(out)).document;
      if (typed && JSON.stringify(back.content).length <= JSON.stringify(document.content).length)
        throw new Error("the typed character was not in the export");
      result.edit = typed ? "ok" : "not typed";
    });
  } catch (error) {
    result.edit = { crash: errorOf(error) };
  }
  return result;
}
