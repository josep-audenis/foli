// Word on a sample of the corpus run (Phase 20.6). Two steps around word-reference.ps1:
//
// After `pnpm build` (the export uses packages/docx/dist):
//
//   node scripts/corpus/word-sample.mjs export <run>.jsonl <dir> [per-project = 30]
//     copies the first files (by SHA-256) of each project that imported, exported and read back
//     to <dir>/orig, and Foli's export of each (no edit) to <dir>/export;
//   powershell -File scripts/corpus/word-reference.ps1 -In <dir>\orig -Out <dir>\ref-orig
//   powershell -File scripts/corpus/word-reference.ps1 -In <dir>\export -Out <dir>\ref-export
//   (into new, empty ref-* folders: word-reference.ps1 keeps an earlier JSON when it fails)
//   node scripts/corpus/word-sample.mjs compare <dir>
//     prints, for each file, what Word measured differently in the export (field names and
//     indices, no text), then the counts.
//
// <dir> must be outside the repository: the measurements hold the documents' text, and the
// output names the files.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [mode, ...args] = process.argv.slice(2);
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (mode === "export") {
  const [results, dir, perProject = "30"] = args;
  const { exportDocx, importDocx } = await import("../../packages/docx/dist/index.js");
  const lines = readFileSync(results, "utf8").trim().split("\n").map(JSON.parse);
  const byProject = new Map();
  for (const line of lines
    .filter((l) => l.import === "ok" && l.export && l.reimport)
    .sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1))) {
    const project = line.names[0].split("/")[0];
    byProject.set(project, [...(byProject.get(project) ?? []), line]);
  }
  mkdirSync(join(dir, "orig"), { recursive: true });
  mkdirSync(join(dir, "export"), { recursive: true });
  const index = [];
  for (const [project, list] of byProject) {
    for (const line of list.slice(0, Number(perProject))) {
      const id = `${project}-${line.sha256.slice(0, 8)}`;
      copyFileSync(line.path, join(dir, "orig", `${id}.docx`));
      const imported = await importDocx(new Uint8Array(readFileSync(line.path)));
      writeFileSync(
        join(dir, "export", `${id}.docx`),
        await exportDocx(imported.document, imported.package),
      );
      index.push({ id, name: line.names[0] });
    }
  }
  writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 1));
  console.log(`${index.length} files in ${dir}`);
} else if (mode === "compare") {
  const [dir] = args;
  const count = {
    compared: 0,
    same: 0,
    differ: 0,
    bothRefused: 0,
    onlyExportRefused: 0,
    onlyOriginalRefused: 0,
    notMeasured: 0,
  };
  const keys = {};
  for (const { id, name } of json(join(dir, "index.json"))) {
    const paths = ["ref-orig", "ref-export"].map((sub) => join(dir, sub, `${id}.json`));
    if (!paths.every(existsSync)) {
      count.notMeasured++;
      console.log("not measured", id, name);
      continue;
    }
    const [a, b] = paths.map(json);
    if (a.opened !== true || b.opened !== true) {
      const key =
        a.opened === b.opened
          ? "bothRefused"
          : a.opened === true
            ? "onlyExportRefused"
            : "onlyOriginalRefused";
      count[key]++;
      if (key !== "bothRefused") console.log(key, id, name);
      continue;
    }
    count.compared++;
    const diffs = [];
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (same(a[key], b[key])) continue;
      keys[key] = (keys[key] ?? 0) + 1;
      const [x, y] = [a[key], b[key]];
      if (Array.isArray(x) && Array.isArray(y)) {
        const differs = x.findIndex((item, i) => !same(item, y[i]));
        const first = differs >= 0 ? differs : Math.min(x.length, y.length);
        const fields =
          first >= 0 && x[first] && typeof x[first] === "object"
            ? Object.keys(x[first]).filter((k) => !same(x[first][k], y[first]?.[k]))
            : [];
        diffs.push(`${key}[${x.length}→${y.length}]@${first}{${fields}}`);
      } else diffs.push(typeof x === "number" ? `${key}:${x}→${y}` : key);
    }
    count[diffs.length ? "differ" : "same"]++;
    if (diffs.length) console.log("differs", id, name, diffs.join(" "));
  }
  console.log(JSON.stringify({ ...count, keys }));
} else {
  console.error("usage: word-sample.mjs export <run>.jsonl <dir> [per-project] | compare <dir>");
  process.exit(2);
}
