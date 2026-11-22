import { describe, expect, it } from "vitest";
import { type Host, runScript, SANDBOX_LIMITS, type SandboxLimits } from "./sandbox.js";

// What a server's prelude does, in small: one function over `__call` (left in the script's
// sight here: whatever calls it, the host takes its name and arguments as an attacker's).
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
  runScript(code, PRELUDE, host, { ...SANDBOX_LIMITS, ms: 15_000, ...limits });

describe("a script's answer", { timeout: 30_000 }, () => {
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

describe("what is not there", { timeout: 30_000 }, () => {
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
    // Jobs are never run: neither a module's loading nor a promise's settling is seen.
    expect(
      await run(
        "let seen = 'pending'; import('node:fs').then(() => { seen = 'loaded' }, () => { seen = 'refused' }); Promise.resolve().then(() => { seen = 'job' }); return seen",
      ),
    ).toMatchObject({ ok: true, value: '"pending"' });
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

describe("limits", { timeout: 30_000 }, () => {
  it("ends a script that does not end", async () => {
    const started = Date.now();
    expect(await run("for (;;) {}", { ms: 300 })).toEqual({
      ok: false,
      reason: "time",
      message: "It did not finish in 0.3 seconds.",
      line: null,
      calls: 0,
    });
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it("ends one that is slow inside the engine, where no interrupt is asked for", async () => {
    for (const code of [
      "for (;;) 'x'.repeat(1e6)",
      "return /(a+)+$/.test('a'.repeat(40) + 'b')",
      "for (;;) { try { for (;;) {} } catch (e) {} }",
      "for (;;) host('x')",
    ]) {
      const started = Date.now();
      const ran = await run(code, { ms: 300, calls: 1e9 });
      expect(ran, code).toMatchObject({ ok: false, reason: "time" });
      expect(Date.now() - started, code).toBeLessThan(20_000);
    }
  });

  it("holds its memory, in bytes", async () => {
    const memory = 32 * 1024 * 1024;
    // What a script holds when it is told there is no more, counted by the script, in
    // megabytes. (QuickJS's own limit let 2 GB through, and said "out of memory" at the
    // module's end: the message alone proves nothing.)
    for (const code of [
      "const a = []; try { for (;;) a.push(new Uint8Array(1e6)) } catch (e) {} return a.length",
      "const a = []; try { for (;;) a.push(new ArrayBuffer(1e6)) } catch (e) {} return a.length",
    ]) {
      const ran = await run(code, { memory, ms: 5000 });
      expect(ran, code).toMatchObject({ ok: true });
      expect(Number(ran.ok && ran.value), code).toBeGreaterThan(8);
      expect(Number(ran.ok && ran.value), code).toBeLessThan(32);
    }
    expect(
      await run("const a = []; for (;;) a.push(new Uint8Array(1e6))", { memory }),
    ).toMatchObject({ ok: false, reason: "memory", message: "It used more than 32 MB of memory." });
  });

  it("holds what a call sends, what a run returns and what an error says", async () => {
    let called = 0;
    const host: Host = (_name, args) => {
      called++;
      return args;
    };
    // Arguments over the size: refused in the sandbox, the host never asked.
    expect(
      await run("try { host('x', 'y'.repeat(300000)) } catch (e) { return e.message }", {}, host),
    ).toMatchObject({
      ok: true,
      value: '"A call\'s arguments are over 200000 characters as JSON."',
    });
    expect(
      await run(
        "try { __call('x'.repeat(200), '[]') } catch (e) { return 1 }\nreturn JSON.parse(__call('x'.repeat(200), '[]')).error",
        {},
        host,
      ),
    ).toMatchObject({ ok: true });
    expect(called).toBe(0);
    // Nested as deep as the size lets: answered in time.
    const started = Date.now();
    const deep = await run(
      "const s = '['.repeat(99000) + ']'.repeat(99000); return __call('deep', s).length",
      {},
      host,
    );
    expect(deep.ok || deep.reason === "error").toBe(true);
    expect(Date.now() - started).toBeLessThan(20_000);

    expect(await run("return 'x'.repeat(2e6)")).toMatchObject({
      ok: false,
      reason: "error",
      message: "RangeError: the value returned is over 1000000 characters as JSON",
    });
    const loud = await run("throw new Error('x'.repeat(3e6))");
    expect(!loud.ok && loud.message.length).toBeLessThan(2200);
  });

  it("takes an error of any shape, and a host that fails any way", async () => {
    for (const thrown of [
      "{ name: { toString: 1 }, message: { toString() { throw 1 } } }",
      "null",
      "undefined",
      "Symbol('s')",
      "new Proxy({}, { get() { throw new Error('trap') } })",
      "{ get name() { for (;;) {} } }",
      "Object.create(null)",
    ]) {
      const ran = await run(`throw ${thrown}`, { ms: 600 });
      expect(ran.ok, thrown).toBe(false);
      expect(!ran.ok && typeof ran.message, thrown).toBe("string");
    }
    for (const failing of [
      () => {
        const error = new Error("x");
        (error as { message: unknown }).message = 5n;
        throw error;
      },
      () => {
        throw { message: { toString: 1 } };
      },
      () => 5n,
      () => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        return cycle;
      },
    ] as Host[])
      expect(
        await run("try { host('x') } catch (e) { return e.message }", {}, failing),
      ).toMatchObject({ ok: true });
  });

  it("a call made while a call's name is being read does not mix the answers", async () => {
    const ran = await run(
      `const evil = { toString() { host('inner'); return 'outer' } };
const first = JSON.parse(__call(evil, '[]')).value.name;
return [first, host('n0').name, host('n1').name];`,
    );
    expect(ran).toMatchObject({ ok: true, value: '["outer","n0","n1"]', calls: 4 });
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
    // The script's error, or the thread's end where the engine's own parser went too deep:
    // contained either way, and the next run is not touched by it.
    expect(nested.ok).toBe(false);
    const parser = await run("return eval('('.repeat(2e5) + '1' + ')'.repeat(2e5))");
    expect(parser.ok).toBe(false);
    expect(await run("return 1")).toMatchObject({ ok: true, value: "1" });
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

describe("what the host is given", { timeout: 30_000 }, () => {
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
    // The host's parser refuses it; the script reads that as the call's error.
    expect(
      await run(`return typeof JSON.parse(__call("x", "{not json")).error`, {}, host),
    ).toMatchObject({ ok: true, value: '"string"' });
    expect(called).toBe(0);
  });

  // Each run is a thread and a WebAssembly module of its own: on a 2-core machine (GitHub's
  // runners) eight at once took four past 15 s when the thread's start was the script's time.
  it("runs at once each get their own answers", { timeout: 120_000 }, async () => {
    const all = await Promise.all(
      Array.from({ length: 8 }, (_, i) => run(`return host('n', ${i}).args[0]`)),
    );
    expect(all.map((r) => r.ok && r.value)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
  });
});

describe("the clock", { timeout: 60_000 }, () => {
  it("starts when the thread is ready: its start is not the script's time", async () => {
    // The prelude is part of the start: one that takes 400 ms, then a script given 200 ms.
    const slow = `${PRELUDE}\nconst t = Date.now(); while (Date.now() - t < 400) {}`;
    expect(await runScript("return 1", slow, echo, { ...SANDBOX_LIMITS, ms: 200 })).toMatchObject({
      ok: true,
      value: "1",
    });
  });

  it("holds the thread's start to a limit of its own", async () => {
    expect(await run("return 1", { start: 1 })).toEqual({
      ok: false,
      reason: "time",
      message: "The sandbox did not start in 0.001 seconds.",
      line: null,
      calls: 0,
    });
  });
});
