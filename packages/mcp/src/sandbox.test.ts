import { describe, expect, it } from "vitest";
import { type Host, runScript, SANDBOX_LIMITS, type SandboxLimits } from "./sandbox.js";

// What a server's prelude does, in small: one function over `__call`, which is then gone.
const PRELUDE = `const host = (name, ...args) => {
  const answer = JSON.parse(__call(name, JSON.stringify(args)));
  if ("error" in answer) throw new Error(answer.error);
  return answer.value;
};
globalThis.host = host;`;

const echo: Host = (name, args) => {
  if (name === "fail") throw new Error("the host refused");
  return { name, args };
};
const run = (code: string, limits: Partial<SandboxLimits> = {}, host: Host = echo) =>
  runScript(code, PRELUDE, host, { ...SANDBOX_LIMITS, ms: 3000, ...limits });

describe("a script's answer", () => {
  it("is what it returns, as JSON; nothing when it returns nothing", async () => {
    expect(await run("return { n: 1 + 1, s: 'a\\nb' }")).toEqual({
      ok: true,
      value: '{"n":2,"s":"a\\nb"}',
      calls: 0,
    });
    expect(await run("const x = 1;")).toMatchObject({ ok: true, value: "" });
    // What JSON has no word for is nothing.
    expect(await run("return () => 1")).toMatchObject({ ok: true, value: "" });
    expect(await run("return 10n ** 2n > 99n")).toMatchObject({ ok: true, value: "true" });
  });

  it("calls the host and gets its answer, or its error to catch", async () => {
    expect(await run("return host('read', 1, { a: [2] })")).toEqual({
      ok: true,
      value: '{"name":"read","args":[1,{"a":[2]}]}',
      calls: 1,
    });
    expect(
      await run("try { host('fail') } catch (e) { return e.message }\nreturn 'not thrown'"),
    ).toMatchObject({ ok: true, value: '"the host refused"', calls: 1 });
    // A host that answers nothing answers null.
    expect(await run("return host('x')", {}, () => undefined)).toMatchObject({ value: "null" });
  });

  it("says where a script failed", async () => {
    expect(await run("const a = 1;\nconst b = 2;\nnull.x;")).toEqual({
      ok: false,
      reason: "error",
      message: "TypeError: cannot read property 'x' of null",
      line: 3,
      calls: 0,
    });
    expect(await run("const a = 1;\nthrow new RangeError('no')")).toMatchObject({
      reason: "error",
      message: "RangeError: no",
      line: 2,
    });
    const syntax = await run("const a = 1;\nconst = 2;");
    expect(syntax).toMatchObject({ ok: false, reason: "error", line: 2 });
    expect(!syntax.ok && syntax.message).toMatch(/^SyntaxError: /);
    // Thrown in a function of the script: the innermost line.
    expect(await run("function f() {\n  throw new Error('deep');\n}\nf();")).toMatchObject({
      message: "Error: deep",
      line: 2,
    });
    expect(await run("throw 'a string'")).toMatchObject({
      reason: "error",
      message: "Error: a string",
    });
  });
});

describe("what is not there", () => {
  it("nothing of Node, the web or the host but the language", async () => {
    const names = [
      "fetch", "require", "process", "setTimeout", "setInterval", "queueMicrotask", "console",
      "WebAssembly", "Atomics", "Worker", "Buffer", "module", "global",
      "navigator", "XMLHttpRequest", "structuredClone", "performance", "Deno", "Bun",
    ]; // biome-ignore format: a list
    const ran = await run(
      `return ${JSON.stringify(names)}.filter((n) => typeof globalThis[n] !== "undefined")`,
    );
    expect(ran).toMatchObject({ ok: true, value: "[]" });
  });

  it("no module can be loaded", async () => {
    const dynamic = await run("return import('node:fs').then(() => 'loaded', (e) => 'refused')");
    // A promise is not JSON: its settling is never seen, and nothing was loaded either way.
    expect(dynamic.ok ? dynamic.value : dynamic.reason).not.toContain("loaded");
    expect(await run("import fs from 'node:fs'; return 1")).toMatchObject({
      ok: false,
      reason: "error",
    });
  });

  it("the function constructor makes code of the sandbox, not of the host", async () => {
    expect(
      await run(
        "return [typeof Function('return this')().process, typeof (0, eval)('this').require]",
      ),
    ).toMatchObject({ value: '["undefined","undefined"]' });
    // The host's answer is data: its prototype is the sandbox's own.
    expect(
      await run(
        "const a = host('x'); return [a.constructor === Object, typeof a.constructor.constructor('return this')().process]",
      ),
    ).toMatchObject({ value: '[true,"undefined"]' });
  });

  it("each run starts clean", async () => {
    await run(
      "globalThis.kept = 1; Object.prototype.polluted = 1; Array.prototype.map = null; return 1",
    );
    expect(await run("return [typeof kept, typeof ({}).polluted, typeof [].map]")).toMatchObject({
      value: '["undefined","undefined","function"]',
    });
  });
});

describe("limits", () => {
  it("ends a script that does not end", async () => {
    const started = Date.now();
    expect(await run("for (;;) {}", { ms: 300 })).toEqual({
      ok: false,
      reason: "time",
      message: "It did not finish in 0.3 seconds.",
      line: null,
      calls: 0,
    });
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it("ends one that is slow inside the engine, where no interrupt is asked for", async () => {
    for (const code of [
      "for (;;) 'x'.repeat(1e6)",
      "return /(a+)+$/.test('a'.repeat(40) + 'b')",
      "for (;;) { try { for (;;) {} } catch (e) {} }",
      "const a = new Array(3e6).fill(0).map((_, i) => -i); a.sort((x, y) => x - y); return 1",
      "for (;;) host('x')",
    ]) {
      const started = Date.now();
      const ran = await run(code, { ms: 300, calls: 1e9 });
      expect(ran, code).toMatchObject({ ok: false, reason: "time" });
      expect(Date.now() - started, code).toBeLessThan(2500);
    }
  });

  it("holds its memory", async () => {
    const ran = await run("const a = []; for (;;) a.push(new Uint8Array(1e6))", {
      memory: 8 * 1024 * 1024,
    });
    expect(ran).toMatchObject({
      ok: false,
      reason: "memory",
      message: "It used more than 8 MB of memory.",
    });
    expect(await run("return 'x'.repeat(5e7).length", { memory: 8 * 1024 * 1024 })).toMatchObject({
      reason: "memory",
    });
    // Caught and tried again: time ends it.
    expect(
      await run(
        "const a = []; for (;;) { try { a.push('x'.repeat(1e5) + a.length) } catch (e) {} }",
        {
          memory: 8 * 1024 * 1024,
          ms: 500,
        },
      ),
    ).toMatchObject({ ok: false, reason: "time" });
  });

  it("holds its stack: a recursion without end is the script's error, not the thread's", async () => {
    expect(await run("function f() { return f() + 1 }\nreturn f()")).toMatchObject({
      ok: false,
      reason: "error",
      message: "InternalError: stack overflow",
      line: 1,
    });
    // Recursion inside the engine: text nested deeper than its parser goes.
    const nested = await run(
      "let s = ''; for (let i = 0; i < 100000; i++) s += '['; return JSON.parse(s)",
    );
    expect(nested.ok).toBe(false);
    const getter = await run("const o = { get a() { return this.a } }; return o.a");
    expect(getter).toMatchObject({ ok: false, reason: "error" });
  });

  it("holds the number of calls", async () => {
    expect(
      await run("for (let i = 0; i < 50; i++) host('x'); return 1", { calls: 50 }),
    ).toMatchObject({
      ok: true,
      calls: 50,
    });
    expect(await run("for (;;) host('x')", { calls: 50 })).toEqual({
      ok: false,
      reason: "calls",
      message: "It made more than 50 calls to the document.",
      line: null,
      calls: 51,
    });
  });

  it("a value that cannot be made text is the script's error", async () => {
    expect(await run("const a = {}; a.a = a; return a")).toMatchObject({
      ok: false,
      reason: "error",
    });
    expect(await run("return { toJSON() { throw new Error('mine') } }")).toMatchObject({
      message: "Error: mine",
    });
    expect(await run("return { get a() { for (;;) {} } }", { ms: 300 })).toMatchObject({
      reason: "time",
    });
  });
});

describe("what the host is given", () => {
  it("is JSON, whatever the script passes", async () => {
    const seen: unknown[] = [];
    const host: Host = (name, args) => {
      seen.push([name, args]);
      return null;
    };
    await run(
      `__call("raw", '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}}}');
host(new Proxy({}, { get: () => "trap" }), { get a() { return 1 }, f() {}, s: Symbol("x"), u: undefined });
return 1`,
      {},
      host,
    );
    expect(({} as { polluted?: number }).polluted).toBeUndefined();
    const [raw, second] = seen as [[string, object], [string, unknown[]]];
    expect(raw[0]).toBe("raw");
    expect(Object.getPrototypeOf(raw[1])).toBe(Object.prototype);
    expect(typeof second[0]).toBe("string");
    expect(second[1]).toEqual([{ a: 1 }]);
  });

  it("arguments that are not JSON are the script's error, and the host is not called", async () => {
    let called = 0;
    const host: Host = () => ++called;
    expect(await run(`return __call("x", "{not json")`, {}, host)).toMatchObject({ ok: true });
    expect(called).toBe(0);
  });

  it("many runs, one after another and at once, leave nothing behind", async () => {
    const all = await Promise.all(
      Array.from({ length: 8 }, (_, i) => run(`return host('n', ${i}).args[0]`)),
    );
    expect(all.map((r) => r.ok && r.value)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
  });
});
