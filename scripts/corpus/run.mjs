// The corpus run (Phase 20, ADR-0011): every file through `check.mjs`, each in a worker thread
// with a time limit and a heap cap, so no file can stop the run. After `pnpm build`:
//
//   pnpm corpus:run                 the external corpus (`pnpm corpus:fetch` first)
//   pnpm corpus:run <folder>        every .docx under a folder (a private one: counts only)
//
// Writes `.corpus-cache/results/<time>.jsonl` (one line per distinct file) and prints a
// summary. Files with the same bytes run once; the line lists every path that holds them.

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainThread, parentPort, Worker } from "node:worker_threads";

/** Per file: what a worker may take before the file counts as hung or too big. */
export const LIMITS = { ms: 120_000, heapMb: 2048 };

async function work() {
  const { checkFile } = await import("./check.mjs");
  parentPort.on("message", async ({ path }) => {
    parentPort.postMessage(await checkFile(new Uint8Array(readFileSync(path))));
  });
}

/** Every .docx under `folder`, as `{ name, path }`. */
function filesIn(folder) {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".docx"))
    .map((e) => {
      const path = join(e.parentPath, e.name);
      return { name: relative(folder, path).replaceAll("\\", "/"), path };
    });
}

/** The files to run, distinct by content: `{ sha256, names, path }`. */
async function inputs(folder) {
  let files;
  if (folder) files = filesIn(folder);
  else {
    const { fetchAll, cachePath } = await import("./fetch.mjs");
    const ready = await fetchAll({ log: () => {} });
    files = ready.files.map((f) => ({ name: `${f.source}/${f.path}`, path: cachePath(f) }));
  }
  const byHash = new Map();
  for (const file of files) {
    const sha256 = createHash("sha256").update(readFileSync(file.path)).digest("hex");
    const seen = byHash.get(sha256);
    if (seen) seen.names.push(file.name);
    else byHash.set(sha256, { sha256, names: [file.name], path: file.path });
  }
  return [...byHash.values()].sort((a, b) => a.names[0].localeCompare(b.names[0]));
}

/** Runs every input, `threads` at a time; a hung or dead worker is that file's result. */
export async function runAll(items, { threads = 4, limits = LIMITS, onResult = () => {} } = {}) {
  const results = [];
  let next = 0;
  /** A worker and the file it is on: its listeners are added once (removing them stops it). */
  const spawn = () => {
    const worker = new Worker(new URL(import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: limits.heapMb },
    });
    const slot = { worker, settle: null, dead: false };
    const fail = (error) => {
      slot.dead = true;
      slot.settle?.({ import: "died", error }, true);
    };
    worker.on("message", (result) => slot.settle?.(result, false));
    worker.on("error", (error) =>
      fail({ name: error?.code ?? error?.name, message: String(error?.message).slice(0, 200) }),
    );
    worker.on("exit", (code) => fail({ name: "exit", message: `code ${code}` }));
    return slot;
  };
  const one = (slot, item) =>
    new Promise((resolve) => {
      const timer = setTimeout(
        () => slot.settle?.({ import: "timeout", ms: limits.ms }, true),
        limits.ms,
      );
      slot.settle = (result, replace) => {
        clearTimeout(timer);
        slot.settle = null;
        resolve({ result, replace });
      };
      slot.worker.postMessage({ path: item.path });
    });
  await Promise.all(
    Array.from({ length: Math.min(threads, items.length) }, async () => {
      let slot = spawn();
      const fresh = async () => {
        await slot.worker.terminate();
        slot = spawn();
      };
      while (next < items.length) {
        const item = items[next++];
        // A worker that died between files (a previous file's late failure) is replaced first.
        if (slot.dead) await fresh();
        let { result, replace } = await one(slot, item);
        if (replace) {
          await fresh();
          // Once more on a fresh worker: a death may be the previous file's, not this one's.
          const again = await one(slot, item);
          if (!again.replace) result = { ...again.result, retried: result.import };
          else {
            result = again.result;
            await fresh();
          }
        }
        const line = {
          sha256: item.sha256,
          names: item.names,
          path: resolve(item.path),
          ...result,
        };
        results.push(line);
        onResult(line);
      }
      await slot.worker.terminate();
    }),
  );
  return results;
}

/** The totals of a run: how many files ended how, and the classes of difference by file count. */
export function summarize(results) {
  const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  const outcome = new Map();
  const classes = new Map();
  for (const r of results) {
    const exportCrash = r.export?.crash;
    const status =
      r.import !== "ok"
        ? r.import
        : exportCrash
          ? "export crash"
          : r.reimport?.crash || r.edit?.crash
            ? "later crash"
            : "ok";
    count(outcome, status);
    const seen = new Set();
    const mark = (key) => {
      if (!seen.has(key)) count(classes, key);
      seen.add(key);
    };
    if (r.import === "crash") mark(`crash on import: ${r.error?.name} at ${r.error?.at}`);
    if (exportCrash) mark(`crash on export: ${exportCrash.name} at ${exportCrash.at}`);
    for (const part of r.export?.lost ?? []) mark(`part lost: ${part}`);
    for (const part of r.export?.added ?? []) mark(`part added: ${part}`);
    for (const change of r.export?.changed ?? []) {
      if (change.kind === "bytes") mark(`binary part changed: ${change.part}`);
      if (change.kind === "unreadable") mark(`part not compared: ${change.error?.name}`);
      for (const name of change.lost ?? []) mark(`element lost: ${name}`);
      for (const name of change.added ?? []) mark(`element added: ${name}`);
      for (const name of change.changed ?? []) mark(`value changed: ${name}`);
      for (const name of change.text ?? []) mark(`text differs in ${name}`);
    }
    if (r.retried) mark(`${r.retried} once, then ${r.import} on a fresh worker`);
    if (r.reimport?.differs)
      mark(`second import differs at ${r.reimport.differs.split("/").slice(0, 3).join("/")}`);
    if (r.edit?.crash) mark(`edit then export: ${r.edit.crash.name}`);
  }
  const sorted = (map) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { files: results.length, outcome: sorted(outcome), classes: sorted(classes) };
}

if (!isMainThread) await work();
else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = process.argv[2];
  const items = await inputs(folder);
  const out = join(import.meta.dirname, "..", "..", ".corpus-cache", "results");
  mkdirSync(out, { recursive: true });
  const file = join(out, `${new Date().toISOString().replaceAll(":", "-")}.jsonl`);
  let done = 0;
  const threads = Math.max(1, Math.min(6, availableParallelism() - 1));
  console.log(`${items.length} distinct files, ${threads} threads`);
  const results = await runAll(items, {
    threads,
    // Each result written as it comes: an interrupted run keeps what it did.
    onResult: (line) => {
      appendFileSync(file, `${JSON.stringify(line)}\n`);
      if (++done % 100 === 0) console.log(`  ${done} / ${items.length}`);
    },
  });
  const summary = summarize(results);
  writeFileSync(file.replace(/\.jsonl$/, ".summary.json"), `${JSON.stringify(summary, null, 1)}\n`);
  console.log(`results: ${relative(process.cwd(), file)}`);
  for (const [status, n] of summary.outcome) console.log(`  ${status}: ${n}`);
  console.log("classes (files):");
  for (const [name, n] of summary.classes.slice(0, 40)) console.log(`  ${n}  ${name}`);
}
