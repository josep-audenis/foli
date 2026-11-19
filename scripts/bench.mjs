// Performance tracking (ADR-0008, 12.7): the layout, keystroke and find benchmarks in Chromium,
// Firefox and WebKit (Playwright, `playwright.bench.config.ts`), `findAll` and the `.docx` import
// and export in Node, `exportPdf` through Chromium; each median compared with this machine's
// committed baseline (`bench/baselines/<machine>.json`). Fails on a regression past a metric's
// threshold. Not in `pnpm check` (minutes); run before each release. Method and numbers:
// docs/benchmarks.md, "Performance tracking".
//
//   pnpm bench [--update] [--runs N] [--machine NAME] [--engines node,chromium,...] [--no-build]

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ENGINES = ["node", "chromium", "firefox", "webkit"];

/**
 * How far a median may move before it counts: past `threshold` (relative to the baseline) and by
 * more than `floor` ms, both. The floor covers whole-millisecond clocks (Firefox, WebKit) and a
 * frame of waiting in paint times. First match wins. Set in 12.7 from the spread of medians
 * between runs of the same code on the owner's laptop (docs/benchmarks.md): browser medians
 * within ±30%, sub-millisecond `findAll` medians up to +150%. A baseline keeps its own per
 * metric, so they can be tuned per machine.
 */
export const TOLERANCES = [
  [/Paint/, { threshold: 0.5, floor: 8 }],
  [/Handler/, { threshold: 0.5, floor: 1.5 }],
  [/^layout|^reflow/, { threshold: 0.4, floor: 5 }],
  [/^find /, { threshold: 0.5, floor: 10 }],
  [/^findAll /, { threshold: 1, floor: 1 }],
  [/^docx /, { threshold: 0.4, floor: 10 }],
  [/^pdf /, { threshold: 0.4, floor: 100 }],
];
const DEFAULT_TOLERANCE = { threshold: 0.5, floor: 5 };

export function tolerance(name) {
  return TOLERANCES.find(([pattern]) => pattern.test(name))?.[1] ?? DEFAULT_TOLERANCE;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round = (value) => Math.round(value * 100) / 100;

/**
 * The machine's name: the hardware and OS, hashed with the host name (which stays out of the
 * repository). `--machine` or `FOLI_BENCH_MACHINE` names it instead.
 */
export function machineId({ platform, hostname, cpu, cores, memory }) {
  const hash = createHash("sha256")
    .update([hostname, cpu, cores, memory].join("|"))
    .digest("hex")
    .slice(0, 8);
  return `${platform}-${hash}`;
}

export function parseArgs(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const runs = Number(value("--runs") ?? 3);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs takes a whole number from 1");
  const engines = (value("--engines") ?? ENGINES.join(",")).split(",").filter(Boolean);
  const unknown = engines.filter((engine) => !ENGINES.includes(engine));
  if (unknown.length) throw new Error(`Unknown engines: ${unknown.join(", ")}`);
  const machine = value("--machine") ?? process.env.FOLI_BENCH_MACHINE;
  if (machine !== undefined && !/^[\w.-]+$/.test(machine))
    throw new Error("--machine takes letters, digits, '.', '_' and '-'");
  return {
    update: argv.includes("--update"),
    build: !argv.includes("--no-build"),
    runs,
    engines,
    machine,
  };
}

/** Layout tracked at these sizes (sections; 200 sections are 199 pages). */
const LAYOUT_FIELDS = [
  "layoutMs",
  "typeHandlerP50",
  "typePaintP95",
  "enterHandlerP50",
  "enterPaintP95",
  "reflowMs",
];
const FIND_QUERIES = ["th", "the ", "the la", "zebra"];

/** The metrics of one `BENCH {…}` record: `[engine, name, ms]`. */
export function metricsOf(record) {
  if (record.bench === "layout") {
    if (record.lists) return [];
    // Playwright's WebKit on Windows paints in software: its paint times say nothing of Safari
    // and swing by 2x run to run (docs/benchmarks.md), so only its handlers are tracked.
    const fields = LAYOUT_FIELDS.filter(
      (field) => record.browser !== "webkit" || !field.includes("Paint"),
    );
    return fields.map((field) => [
      record.browser,
      `${field.replace(/Ms$/, "")} ${record.sections}`,
      record[field],
    ]);
  }
  if (record.bench === "find")
    return FIND_QUERIES.map((query) => [record.browser, `find "${query}"`, record.times[query]]);
  if (record.bench === "metrics")
    return Object.entries(record.metrics).map(([name, ms]) => [record.engine, name, ms]);
  return [];
}

/** The `BENCH {…}` records of a run's output. */
export function recordsIn(output) {
  return output
    .split(/\r?\n/)
    .map((line) => /^\s*BENCH (\{.*\})\s*$/.exec(line)?.[1])
    .filter(Boolean)
    .map((json) => JSON.parse(json));
}

/** Medians per engine and metric over every record (one per run). */
export function medians(records) {
  const samples = {};
  for (const [engine, name, ms] of records.flatMap(metricsOf)) {
    samples[engine] ??= {};
    samples[engine][name] ??= [];
    samples[engine][name].push(ms);
  }
  const out = {};
  for (const [engine, metrics] of Object.entries(samples)) {
    out[engine] = {};
    for (const [name, values] of Object.entries(metrics)) out[engine][name] = round(median(values));
  }
  return out;
}

/**
 * Each current median against the baseline: `regression` past its threshold and floor, `faster`
 * past them the other way, `new` when the baseline lacks it.
 */
export function compare(baseline, current) {
  const rows = [];
  for (const [engine, metrics] of Object.entries(current)) {
    for (const [name, value] of Object.entries(metrics)) {
      const base = baseline?.metrics?.[engine]?.[name];
      if (!base) {
        rows.push({ engine, name, value, status: "new" });
        continue;
      }
      const { threshold, floor } = base;
      const diff = value - base.median;
      const past = Math.abs(diff) > base.median * threshold && Math.abs(diff) > floor;
      const status = !past ? "ok" : diff > 0 ? "regression" : "faster";
      rows.push({ engine, name, value, base: base.median, threshold, floor, status });
    }
  }
  return rows;
}

/** The summary table, as text. */
export function table(rows) {
  const header = ["engine", "metric", "ms", "baseline", "change", "allowed", "status"];
  const lines = rows.map((row) => [
    row.engine,
    row.name,
    String(row.value),
    row.base === undefined ? "-" : String(row.base),
    row.base === undefined
      ? "-"
      : `${row.value >= row.base ? "+" : ""}${Math.round(((row.value - row.base) / row.base) * 100)}%`,
    row.base === undefined ? "-" : `±${Math.round(row.threshold * 100)}%, ${row.floor} ms`,
    row.status === "regression" ? "REGRESSION" : row.status,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((line) => line[i].length)));
  const format = (cells) =>
    cells.map((cell, i) => (i < 2 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");
  return [format(header), widths.map((w) => "-".repeat(w)).join("  "), ...lines.map(format)].join(
    "\n",
  );
}

/** The baseline with the current medians; thresholds (and a hand-written `note`) are kept. */
export function updated(baseline, current, about) {
  const metrics = structuredClone(baseline?.metrics ?? {});
  for (const [engine, values] of Object.entries(current)) {
    metrics[engine] ??= {};
    for (const [name, value] of Object.entries(values)) {
      const kept = metrics[engine][name];
      metrics[engine][name] = {
        median: value,
        threshold: kept?.threshold ?? tolerance(name).threshold,
        floor: kept?.floor ?? tolerance(name).floor,
      };
    }
  }
  return { ...baseline, ...about, metrics };
}

// --- Running the benchmarks ---

const root = fileURLToPath(new URL("..", import.meta.url));

/** Runs a command, echoing its output; resolves with the output. */
function run(command, args, shell = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, shell, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} ${args[0]} exited with ${code}`)),
    );
  });
}

/** Median ms of `fn` over `times` calls after `warm` unmeasured ones. */
async function time(fn, times, warm = 2) {
  for (let i = 0; i < warm; i++) await fn();
  const ms = [];
  for (let i = 0; i < times; i++) {
    const start = performance.now();
    await fn();
    ms.push(performance.now() - start);
  }
  return median(ms);
}

/** `findAll` and the `.docx` import and export in Node, and `exportPdf` in Chromium (built). */
async function nodeRecords(engines) {
  const dist = (name) => pathToFileURL(join(root, "packages", name, "dist", "index.js")).href;
  const { createDocument, createEditor, findAll } = await import(dist("core"));
  const { exportDocx, importDocx } = await import(dist("docx"));
  const corpus = join(root, "corpus", "word");
  const files = readdirSync(corpus)
    .filter((name) => name.endsWith(".docx"))
    .sort()
    .map((name) => new Uint8Array(readFileSync(join(corpus, name))));
  const records = [];

  if (engines.includes("node")) {
    const line = "The quick brown fox jumps over the lazy dog and runs across the wide field.";
    // The find benchmark's document (`apps/playground/bench/find.bench.ts`): 1,640 paragraphs.
    const content = Array.from({ length: 1640 }, (_, i) => ({
      type: "paragraph",
      content: [{ type: "text", text: `${i} ${line}` }],
    }));
    const editor = createEditor({ document: createDocument({ type: "doc", content }) });
    const metrics = {};
    for (const query of FIND_QUERIES)
      metrics[`findAll "${query}"`] = round(await time(() => findAll(editor, query), 50, 5));
    let imports = 0;
    let exports = 0;
    for (const bytes of files) {
      imports += await time(() => importDocx(bytes), 10);
      const { document, package: pkg } = await importDocx(bytes);
      exports += await time(() => exportDocx(document, pkg), 10);
    }
    metrics["docx import (corpus)"] = round(imports);
    metrics["docx export (corpus)"] = round(exports);
    records.push({ bench: "metrics", engine: "node", metrics });
  }

  if (engines.includes("chromium")) {
    const { exportPdf } = await import(dist("pdf"));
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      let ms = 0;
      for (const bytes of files) {
        const { document, package: pkg } = await importDocx(bytes);
        const options = {
          page,
          review: "final",
          resources: (_key, resource) =>
            resource.part ? pkg.part(`/${resource.part}`) : undefined,
        };
        ms += await time(() => exportPdf(document, options), 3, 1);
      }
      records.push({
        bench: "metrics",
        engine: "chromium",
        metrics: { "pdf (corpus)": round(ms) },
      });
    } finally {
      await browser.close();
    }
  }
  return records;
}

/** The machine, for the baseline: what its numbers were measured on. */
async function hardware(engines) {
  const browsers = {};
  const playwright = await import("@playwright/test");
  for (const engine of engines.filter((e) => e !== "node")) {
    const browser = await playwright[engine].launch();
    browsers[engine] = browser.version();
    await browser.close();
  }
  return {
    cpu: os.cpus()[0]?.model.trim(),
    cores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    browsers,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cpus = os.cpus();
  const machine =
    options.machine ??
    machineId({
      platform: process.platform,
      hostname: os.hostname(),
      cpu: cpus[0]?.model ?? "",
      cores: cpus.length,
      memory: os.totalmem(),
    });
  const file = join(root, "bench", "baselines", `${machine}.json`);
  const baseline = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;

  // A shell finds pnpm's `.cmd` on Windows; the command is fixed.
  if (options.build) await run("pnpm", ["build"], true);
  const records = [];
  for (let i = 0; i < options.runs; i++) {
    console.log(`Node benchmarks, run ${i + 1} of ${options.runs}`);
    for (const record of await nodeRecords(options.engines)) {
      console.log(`BENCH ${JSON.stringify(record)}`);
      records.push(record);
    }
  }
  const browsers = options.engines.filter((engine) => engine !== "node");
  if (browsers.length) {
    const cli = join(root, "node_modules", "@playwright", "test", "cli.js");
    const output = await run(process.execPath, [
      cli,
      "test",
      "--config",
      "playwright.bench.config.ts",
      "--grep",
      " (100|200)-section document$|find on a hundred pages",
      "--repeat-each",
      String(options.runs),
      ...browsers.map((engine) => `--project=${engine}`),
    ]);
    records.push(...recordsIn(output));
  }

  const current = medians(records);
  const rows = compare(baseline, current);
  mkdirSync(join(root, "test-results"), { recursive: true });
  writeFileSync(
    join(root, "test-results", "bench.json"),
    `${JSON.stringify({ machine, runs: options.runs, medians: current, rows }, null, 2)}\n`,
  );
  console.log(`\nMachine ${machine}, medians of ${options.runs} runs (test-results/bench.json):\n`);
  console.log(table(rows));

  if (options.update) {
    const about = {
      machine,
      recorded: new Date().toISOString().slice(0, 10),
      runs: options.runs,
      hardware: await hardware(browsers),
    };
    // Engines not run this time keep the versions their numbers were measured with.
    about.hardware.browsers = { ...baseline?.hardware?.browsers, ...about.hardware.browsers };
    mkdirSync(join(root, "bench", "baselines"), { recursive: true });
    writeFileSync(file, `${JSON.stringify(updated(baseline, current, about), null, 2)}\n`);
    console.log(`\nBaseline written: bench/baselines/${machine}.json (commit it).`);
    return;
  }
  if (!baseline) {
    console.log(
      `\nNo baseline for machine ${machine}: nothing compared. Record one with \`pnpm bench --update${options.machine ? ` --machine ${machine}` : ""}\` and commit it.`,
    );
    return;
  }
  const regressions = rows.filter((row) => row.status === "regression");
  const faster = rows.filter((row) => row.status === "faster");
  if (faster.length)
    console.log(`\n${faster.length} faster than the baseline: \`pnpm bench --update\` to keep.`);
  if (regressions.length) {
    console.log(`\n${regressions.length} past their threshold. Rerun on a quiet machine first.`);
    process.exitCode = 1;
  } else console.log("\nNo regression past a threshold.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
