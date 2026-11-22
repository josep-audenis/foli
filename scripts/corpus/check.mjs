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

const xmlType = (part) =>
  /\.(xml|rels)$/i.test(part.name) || (/xml$/i.test(part.contentType) && !/\.\w+$/.test(part.name));

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
export function census(source, parseXml, { paraIds = false } = {}) {
  const isVolatile = (a) => volatileAttribute(a) && !(paraIds && a.ns === W14);
  const elements = new Map();
  const values = new Map();
  const texts = new Map();
  /** Each paragraph's text with its formatting, runs of one formatting joined (see `runs`). */
  const formatted = new Map();
  const volatile = new Map();
  let chars = 0;
  const add = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  const attributesOf = (element) =>
    element.attributes.filter((a) => !(a.prefix === "xmlns" || (!a.prefix && a.local === "xmlns")));
  const walk = (element, context = null) => {
    const key = keyOf(element);
    // Word writes these again each time it saves: not content (counted apart).
    if (VOLATILE_ELEMENTS.has(key)) return void add(volatile, shown(key));
    if (key === `${W}|p`) return paragraph(element);
    if (key === `${W}|r` && context) return run(element, context);
    add(elements, key);
    for (const attribute of attributesOf(element)) {
      if (isVolatile(attribute)) {
        add(volatile, `${shown(key)}@${shown(keyOf(attribute))}`);
        continue;
      }
      add(values, `${key}@${keyOf(attribute)}\u0000${attribute.value}`);
    }
    const inner = context ? `${context}/${shown(key)}` : context;
    for (const child of element.children) {
      if (child.kind === "element") walk(child, inner);
      else if (child.kind === "text" && child.text.trim()) {
        add(texts, `${key}\u0000${child.text}`);
        chars += child.text.length;
      }
    }
  };
  /** A paragraph: its properties counted as elements, its runs as formatted text. */
  let pieces = null;
  const paragraphs = [];
  const whole = new Map();
  const paragraph = (element) => {
    const outer = pieces;
    pieces = [];
    add(elements, `${W}|p`);
    for (const attribute of attributesOf(element))
      if (isVolatile(attribute)) add(volatile, `w:p@${shown(keyOf(attribute))}`);
      else add(values, `${W}|p@${keyOf(attribute)}\u0000${attribute.value}`);
    for (const child of element.children) if (child.kind === "element") walk(child, "p");
    // Runs next to each other with the same formatting are one: how many runs a writer made
    // of a text is not content.
    const joined = [];
    for (const piece of pieces) {
      // A run with nothing in it shows nothing (Foli drops it, reported as dropped).
      if (!piece.text) continue;
      const last = joined[joined.length - 1];
      if (last && last.sig === piece.sig) last.text += piece.text;
      else joined.push({ ...piece });
    }
    for (const piece of joined) piece.text = oneKindOnce(piece.text);
    for (const { sig, text } of joined) {
      add(formatted, `${sig}\u0000${text}`);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: the census's own separators
      chars += text.replace(/\u0001[^\u0001]*\u0001|\u0005\w+:/g, "").length;
    }
    // The paragraph whole: a stretch moved to the next paragraph, or two swapped, shows here.
    add(whole, joined.map((p) => `${p.sig}\u0000${p.text}`).join("\u0006"));
    paragraphs.push(joined);
    pieces = outer;
  };
  /** A run: its formatting as a signature, its text, other content (a drawing…) walked. */
  const run = (element, context) => {
    let format = "";
    let text = "";
    for (const child of element.children) {
      if (child.kind !== "element") continue;
      const key = keyOf(child);
      if (key === `${W}|rPr`) format = canonical(child);
      else if (RUN_TEXT.has(key)) {
        // As Word reads it: without `xml:space="preserve"` the spaces around the text go.
        const preserve = child.attributes.some(
          (a) => a.local === "space" && a.ns === XML && a.value === "preserve",
        );
        const raw = child.children.map((c) => c.text ?? "").join("");
        const value = preserve ? raw : raw.trim();
        // Which element holds it: a field code or deleted text becoming text shows. An empty
        // one shows nothing.
        if (value) text += `\u0005${child.local}:${value}`;
      } else if (RUN_MARKS[key] && plainMark(child)) text += `\u0005t:${RUN_MARKS[key]}`;
      else if (VOLATILE_ELEMENTS.has(key)) add(volatile, shown(key));
      else {
        // Content of its own (a drawing, a field character, a note reference): counted as
        // elements, and a mark in the text so that joining runs cannot hide it.
        walk(child, null);
        text += `\u0001${shown(key)}\u0001`;
      }
    }
    pieces.push({ sig: `${context}\u0002${format}`, text });
  };
  walk(parseXml(source).root);
  return { elements, values, texts, formatted, whole, paragraphs, volatile, chars };
}

/**
 * Text with each change of kind marked once (`t`, `delText`, `instrText`…): two `w:delText` of
 * runs joined are one stretch of deleted text, not two.
 */
const oneKindOnce = (text) => {
  let kind = null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the census's own separators
  return text.replace(/\u0005(\w+):/g, (marker, next) => {
    if (next === kind) return "";
    kind = next;
    return marker;
  });
};

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const XML = "http://www.w3.org/XML/1998/namespace";
/** Written anew by Word at each save: spelling marks, where its last layout broke pages. */
const VOLATILE_ELEMENTS = new Set([`${W}|proofErr`, `${W}|lastRenderedPageBreak`]);
/** Revision-session ids and paragraph ids, likewise. */
const volatileAttribute = (a) =>
  (a.ns === W && a.local.startsWith("rsid")) ||
  (a.ns === W14 && (a.local === "paraId" || a.local === "textId"));
/** A run's text elements (`xml:space` aside: the text itself is compared). */
const RUN_TEXT = new Set([`${W}|t`, `${W}|delText`, `${W}|instrText`, `${W}|delInstrText`]);
/** A run's characters that are elements. */
const RUN_MARKS = {
  [`${W}|tab`]: "\t",
  [`${W}|br`]: "\n",
  [`${W}|cr`]: "\n",
  [`${W}|noBreakHyphen`]: "‑",
  [`${W}|softHyphen`]: "­",
};
/**
 * A mark element with nothing Word reads beyond what it is (a `w:br` of the default type is a
 * line break; a page or column break, or one with `w:clear`, is content of its own).
 */
const plainMark = (element) =>
  element.attributes.every(
    (a) =>
      a.prefix === "xmlns" ||
      (!a.prefix && a.local === "xmlns") ||
      (a.local === "type" && a.value === "textWrapping"),
  );

/** An element as a string its order of attributes and children does not change. */
function canonical(element) {
  const attributes = element.attributes
    .filter((a) => !(a.prefix === "xmlns" || (!a.prefix && a.local === "xmlns")))
    .filter((a) => !volatileAttribute(a))
    .map((a) => `${keyOf(a)}=${a.value}`)
    .sort();
  const children = element.children
    .filter((c) => c.kind === "element")
    .map(canonical)
    .sort();
  return `<${keyOf(element)} ${attributes.join(" ")}>${children.join("")}</>`;
}

/**
 * How an exported XML part differs from the original's: elements lost or added (by name),
 * attributes whose values changed (by element and attribute name), characters of text lost.
 */
export function compareXml(original, exported, parseXml, options = {}) {
  if (original === exported) return null;
  const a = census(original, parseXml, options);
  const b = census(exported, parseXml, options);
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
  // A paragraph's text or a stretch's formatting not the same (joined runs aside).
  const same = (x, y) => [...x].every(([key, n]) => y.get(key) === n) && x.size === y.size;
  const runs = !same(a.formatted, b.formatted) || !same(a.whole, b.whole);
  if (!lost.length && !added.length && !changed.size && !text.size && !runs)
    return { kind: "equivalent" };
  return {
    kind: "content",
    lost,
    added,
    changed: [...changed],
    text: [...text],
    // How many stretches of text with one formatting are the original's and not the export's,
    // and what of them changed: their text, or (the same text) which run properties.
    runs: runs ? [...a.formatted].filter(([k, n]) => (b.formatted.get(k) ?? 0) < n).length : 0,
    ...(runs ? paragraphChanges(a.paragraphs, b.paragraphs) : {}),
    textLost: Math.max(a.chars - b.chars, 0),
    textAdded: Math.max(b.chars - a.chars, 0),
  };
}

/**
 * Paragraphs of `a` matched with `b`'s by their text: how many have no paragraph of the same text
 * in `b` (text changed), and, for those that do but are formatted otherwise, the run properties
 * or the surroundings (a hyperlink, a tracked change) that differ, by name. The text matches
 * paragraphs; it is never reported.
 */
function paragraphChanges(a, b) {
  const textOf = (pieces) => oneKindOnce(pieces.map((p) => p.text).join(""));
  const free = new Map();
  for (const pieces of b) {
    const text = textOf(pieces);
    free.set(text, [...(free.get(text) ?? []), pieces]);
  }
  // Each character's formatting: where two paragraphs of one text split their runs apart.
  // (Kind markers aside: the two texts are equal once those are said once.)
  const perChar = (pieces) =>
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the census's own separators
    pieces.flatMap((p) => Array.from(p.text.replace(/\w+:/g, ""), () => p.sig));
  const tokens = (format) => new Set(format.match(/<[^>]*>/g) ?? []);
  const names = (list) => list.map((t) => shown(t.slice(1).split(" ")[0]));
  let textChanged = 0;
  let formatChanged = 0;
  const properties = new Set();
  const around = new Set();
  for (const pieces of a) {
    const text = textOf(pieces);
    const twin = free.get(text)?.shift();
    if (!twin) {
      // An empty paragraph lost shows as `w:p` lost; it holds no text to change.
      if (text) textChanged++;
      continue;
    }
    const x = perChar(pieces);
    const y = perChar(twin);
    const pairs = new Set();
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) pairs.add(`${x[i]}\u0003${y[i]}`);
    if (pairs.size) formatChanged++;
    for (const pair of pairs) {
      const [sig, other] = pair.split("\u0003");
      const [context, format] = sig.split("\u0002");
      const [otherContext, otherFormat] = other.split("\u0002");
      if (context !== otherContext) around.add(`${context} → ${otherContext}`);
      const p = tokens(format);
      const q = tokens(otherFormat);
      for (const name of names([...p].filter((t) => !q.has(t)))) properties.add(name);
      for (const name of names([...q].filter((t) => !p.has(t)))) properties.add(name);
    }
  }
  return { textChanged, formatChanged, properties: [...properties], around: [...around] };
}

/** How many characters of text a JSON tree holds (its text nodes). */
const textLength = (node) =>
  (node.text?.length ?? 0) + (node.content ?? []).reduce((n, child) => n + textLength(child), 0);

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
        const diff = compareXml(before.text(part.name), after.text(part.name), parseXml, {
          paraIds: /comments/i.test(part.name),
        });
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
      // Every character of the document's text and the typed one, read back from the file.
      const plain = (await importDocx(exported)).document;
      result.edit = !typed
        ? "not typed"
        : textLength(back.content) === textLength(plain.content) + 1
          ? "ok"
          : { lost: "the typed character is not in the export" };
    });
  } catch (error) {
    result.edit = { crash: errorOf(error) };
  }
  return result;
}
