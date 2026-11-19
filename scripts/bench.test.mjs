import { describe, expect, it } from "vitest";
import {
  compare,
  machineId,
  median,
  medians,
  metricsOf,
  parseArgs,
  recordsIn,
  table,
  tolerance,
  updated,
} from "./bench.mjs";

const layout = (browser, sections, ms) => ({
  bench: "layout",
  browser,
  sections,
  lists: false,
  layoutMs: ms,
  typeHandlerP50: 1,
  typePaintP95: 2,
  enterHandlerP50: 3,
  enterPaintP95: 4,
  reflowMs: 5,
  typePaintP50: 9,
});

describe("bench", () => {
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([Number.NaN, 5])).toBe(5);
    expect(median([])).toBeNaN();
  });

  it("names a machine by its platform and a hash that hides the host name", () => {
    const about = { platform: "win32", hostname: "HOST", cpu: "CPU", cores: 20, memory: 16 };
    const id = machineId(about);
    expect(id).toMatch(/^win32-[0-9a-f]{8}$/);
    expect(id).not.toContain("HOST");
    expect(machineId({ ...about })).toBe(id);
    expect(machineId({ ...about, cpu: "Other" })).not.toBe(id);
  });

  it("reads its options and refuses bad ones", () => {
    expect(parseArgs([])).toMatchObject({ update: false, build: true, runs: 3 });
    expect(
      parseArgs(["--update", "--runs", "5", "--engines", "node,firefox", "--no-build"]),
    ).toEqual({
      update: true,
      build: false,
      runs: 5,
      engines: ["node", "firefox"],
      machine: undefined,
    });
    expect(parseArgs(["--machine", "laptop-1"]).machine).toBe("laptop-1");
    expect(() => parseArgs(["--runs", "0"])).toThrow();
    expect(() => parseArgs(["--engines", "edge"])).toThrow("edge");
    expect(() => parseArgs(["--machine", "../x"])).toThrow();
  });

  it("reads BENCH lines and turns records into tracked metrics", () => {
    const output = [
      "  ok 1 [chromium] › pagination",
      `BENCH ${JSON.stringify(layout("chromium", 100, 40))}`,
      `BENCH ${JSON.stringify({ bench: "find", browser: "firefox", pages: 107, times: { t: 1, th: 20, "the ": 21, "the la": 9, zebra: 4 } })}\r`,
    ].join("\n");
    const records = recordsIn(output);
    expect(records).toHaveLength(2);
    expect(metricsOf(records[0])).toEqual([
      ["chromium", "layout 100", 40],
      ["chromium", "typeHandlerP50 100", 1],
      ["chromium", "typePaintP95 100", 2],
      ["chromium", "enterHandlerP50 100", 3],
      ["chromium", "enterPaintP95 100", 4],
      ["chromium", "reflow 100", 5],
    ]);
    expect(metricsOf(records[1]).map(([, name]) => name)).toEqual([
      'find "th"',
      'find "the "',
      'find "the la"',
      'find "zebra"',
    ]);
    expect(metricsOf({ ...layout("chromium", 100, 1), lists: true })).toEqual([]);
    expect(metricsOf(layout("webkit", 200, 1)).map(([, name]) => name)).toEqual([
      "layout 200",
      "typeHandlerP50 200",
      "enterHandlerP50 200",
      "reflow 200",
    ]);
    expect(metricsOf({ bench: "metrics", engine: "node", metrics: { "docx import": 7 } })).toEqual([
      ["node", "docx import", 7],
    ]);
  });

  it("takes the median of each metric over the runs", () => {
    const current = medians([
      layout("chromium", 100, 40),
      layout("chromium", 100, 90),
      layout("chromium", 100, 41),
      layout("webkit", 100, 70),
    ]);
    expect(current.chromium["layout 100"]).toBe(41);
    expect(current.webkit["layout 100"]).toBe(70);
  });

  it("fails only past both the relative threshold and the floor", () => {
    const base = (median) => ({ median, threshold: 0.5, floor: 2 });
    const baseline = {
      metrics: { node: { a: base(10), b: base(10), c: base(1), d: base(10), e: base(10) } },
    };
    const rows = compare(baseline, { node: { a: 15, b: 15.1, c: 2.5, d: 4, e: 3 }, x: { y: 1 } });
    expect(rows.map((row) => [row.name, row.status])).toEqual([
      ["a", "ok"], // +50%: at the threshold, not past it
      ["b", "regression"],
      ["c", "ok"], // +150% but 1.5 ms: within the floor
      ["d", "faster"],
      ["e", "faster"],
      ["y", "new"],
    ]);
    expect(compare(null, { node: { a: 1 } })).toEqual([
      { engine: "node", name: "a", value: 1, status: "new" },
    ]);
  });

  it("prints a summary table with the change and the allowance", () => {
    const rows = compare(
      { metrics: { node: { a: { median: 10, threshold: 0.3, floor: 5 } } } },
      { node: { a: 20, b: 3 } },
    );
    const text = table(rows);
    expect(text.split("\n")[0]).toMatch(/^engine\s+metric\s+ms\s+baseline\s+change/);
    expect(text).toContain("+100%");
    expect(text).toContain("±30%, 5 ms");
    expect(text).toContain("REGRESSION");
    expect(text.split("\n").at(-1)).toMatch(/b\s+3\s+-\s+-\s+-\s+new$/);
  });

  it("writes a baseline with each metric's tolerance, keeping tuned ones", () => {
    const old = {
      note: "on battery",
      machine: "m",
      metrics: { node: { "docx import": { median: 9, threshold: 0.9, floor: 1 } } },
    };
    const next = updated(
      old,
      { node: { "docx import": 10, "findAll x": 1 }, chromium: { "layout 100": 40 } },
      { machine: "m", recorded: "2026-11-19" },
    );
    expect(next.note).toBe("on battery");
    expect(next.recorded).toBe("2026-11-19");
    expect(next.metrics.node["docx import"]).toEqual({ median: 10, threshold: 0.9, floor: 1 });
    expect(next.metrics.node["findAll x"]).toEqual({ median: 1, ...tolerance("findAll x") });
    expect(next.metrics.chromium["layout 100"]).toEqual({ median: 40, ...tolerance("layout 100") });
    expect(old.metrics.node["docx import"].median).toBe(9);
  });

  it("gives paint times a frame of slack and handlers a millisecond or so", () => {
    expect(tolerance("typePaintP95 100").floor).toBeGreaterThanOrEqual(8);
    expect(tolerance("enterHandlerP50 200").floor).toBeLessThan(5);
    expect(tolerance("something else")).toEqual({ threshold: 0.5, floor: 5 });
  });
});
