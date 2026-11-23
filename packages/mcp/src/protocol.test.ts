import { invalid } from "@folijs/agent";
import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_BYTES,
  MAX_RESULT_CHARS,
  PROTOCOL_VERSIONS,
  serve,
  type Tool,
} from "./protocol.js";
import { published } from "./schema.js";
import { connect, message, wire } from "./testing/client.js";

const echo: Tool = {
  name: "echo",
  description: "Says it back.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      times: { type: "integer", minimum: 1 },
      mode: { type: "string", enum: ["plain", "loud"] },
      value: { anyOf: [{ type: "string" }, { type: "boolean" }, { type: "null" }] },
      list: { type: "array", items: { type: "string" } },
    },
    required: ["text"],
  },
  run: ({ text, times }) => ({ text: String(text).repeat((times as number) ?? 1) }),
};
const refuses: Tool = {
  name: "refuses",
  description: "Always refuses.",
  inputSchema: { type: "object" },
  run: () => ({ text: "No: try echo.", isError: true }),
};
const throws: Tool = {
  name: "throws",
  description: "Breaks.",
  inputSchema: { type: "object" },
  run: () => {
    throw new Error("secret detail");
  },
};
const options = (log: string[] = []) => ({
  name: "foli",
  version: "1.2.3",
  instructions: "Read first.",
  tools: [echo, refuses, throws],
  log: (message: string) => log.push(message),
});
const call = (id: number, name: string, args?: unknown) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });

describe("with the SDK's client", () => {
  it("initializes, lists the tools and calls one", async () => {
    let name = "";
    const client = await connect({ ...options(), onClient: (n) => (name = n) });
    expect(name).toBe("foli-test");
    expect(client.getServerVersion()).toEqual({ name: "foli", version: "1.2.3" });
    expect(client.getServerCapabilities()).toEqual({ tools: {} });
    expect(client.getInstructions()).toBe("Read first.");
    expect(await client.ping()).toEqual({});
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo", "refuses", "throws"]);
    expect(tools[0]).toMatchObject({ description: "Says it back.", inputSchema: echo.inputSchema });
    expect(await client.callTool({ name: "echo", arguments: { text: "ab", times: 2 } })).toEqual({
      content: [{ type: "text", text: "abab" }],
    });
    await client.close();
  });

  it("answers each protocol version it knows with that version, another with its newest", async () => {
    for (const version of PROTOCOL_VERSIONS) {
      const { raw, end } = wire(options());
      const answer = await raw(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "c" } },
        }),
      );
      expect(answer.result).toMatchObject({ protocolVersion: version });
      await end();
    }
    const { raw, end } = wire(options());
    const answer = await raw(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}',
    );
    expect(answer.result).toMatchObject({ protocolVersion: PROTOCOL_VERSIONS[0] });
    await end();
    // The SDK's client accepts the oldest and the newest.
    for (const version of [PROTOCOL_VERSIONS.at(-1), PROTOCOL_VERSIONS[0]]) {
      const client = await connect(options(), version);
      expect((await client.listTools()).tools).toHaveLength(3);
      await client.close();
    }
  });

  it("gives a refusal, wrong arguments and a tool that broke as results the model reads", async () => {
    const log: string[] = [];
    const client = await connect(options(log));
    expect(await client.callTool({ name: "refuses" })).toEqual({
      content: [{ type: "text", text: "No: try echo." }],
      isError: true,
    });
    const wrong = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: "echo", arguments: args });
      expect(result.isError).toBe(true);
      return (result.content as { text: string }[])[0]?.text;
    };
    expect(await wrong({})).toBe("Wrong arguments for echo: arguments.text is missing.");
    expect(await wrong({ text: 5 })).toContain("arguments.text must be string, not number");
    expect(await wrong({ text: "a", times: 0 })).toContain("arguments.times must be at least 1");
    expect(await wrong({ text: "a", times: 1.5 })).toContain("must be integer");
    expect(await wrong({ text: "a", mode: "soft" })).toContain('one of "plain", "loud"');
    expect(await wrong({ text: "a", value: 5 })).toContain("must be string or boolean or null");
    expect(await wrong({ text: "a", list: ["x", 2] })).toContain(
      "arguments.list[1] must be string",
    );
    expect(await wrong({ text: "a", txt: "b" })).toContain(
      "arguments.txt is not an argument (there are: text, times, mode, value, list)",
    );
    const ok = await client.callTool({
      name: "echo",
      arguments: { text: "a", value: null, list: [], mode: "loud" },
    });
    expect(ok.isError).toBeUndefined();
    // What broke is logged, not told.
    expect(await client.callTool({ name: "throws" })).toEqual({
      content: [{ type: "text", text: "throws failed inside the server." }],
      isError: true,
    });
    // Where, not what: an error's message may quote a document.
    expect(log.join("\n")).toMatch(/^throws threw: Error\n\s+at /);
    expect(log.join("\n")).not.toContain("secret detail");
    await expect(client.callTool({ name: "nope" })).rejects.toThrow(/Unknown tool: nope/);
    await client.close();
  });
});

describe("what is not a message", () => {
  it("is answered with a JSON-RPC error, and the server goes on", async () => {
    const { raw, end, input, nextLine } = wire(options());
    const error = async (line: string) =>
      ((await raw(line)) as { error: { code: number } }).error.code;
    expect(await error("not json")).toBe(-32700);
    expect(await error("[]")).toBe(-32600);
    expect(await error('"text"')).toBe(-32600);
    expect(await error("null")).toBe(-32600);
    expect(await error('{"jsonrpc":"1.0","id":1,"method":"ping"}')).toBe(-32600);
    // Answered with its id: the client can tell which request was wrong (21.11).
    expect(((await raw('{"jsonrpc":"1.0","id":7,"method":"ping"}')) as { id: unknown }).id).toBe(7);
    expect(await error('{"jsonrpc":"2.0","id":1}')).toBe(-32600);
    expect(await error('{"jsonrpc":"2.0","id":{},"method":"ping"}')).toBe(-32600);
    expect(await error('{"jsonrpc":"2.0","id":1,"method":"resources/list"}')).toBe(-32601);
    expect(await error('{"jsonrpc":"2.0","id":1,"method":"tools/call"}')).toBe(-32602);
    expect(await error('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":5}}')).toBe(
      -32602,
    );
    // Arguments that are not an object are wrong arguments: for the model.
    expect(await raw(call(7, "echo", "text"))).toMatchObject({
      id: 7,
      result: { isError: true },
    });
    // Notifications, responses and empty lines get no answer: the next request's comes next.
    input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    input.write('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}\n');
    input.write('{"jsonrpc":"2.0","id":9,"result":{}}\n');
    input.write("\n   \r\n");
    expect(await raw('{"jsonrpc":"2.0","id":"a","method":"ping"}')).toEqual({
      jsonrpc: "2.0",
      id: "a",
      result: {},
    });
    await end();
    void nextLine;
  });

  it("takes messages split across chunks, several in one, with CRLF and in UTF-8", async () => {
    const { input, nextLine, end } = wire(options());
    const message = Buffer.from(`${call(1, "echo", { text: "añ→🙂" })}\r\n`);
    // Cut inside a multi-byte character.
    const cut = message.indexOf(Buffer.from("→")) + 1;
    input.write(message.subarray(0, cut));
    input.write(message.subarray(cut));
    expect(JSON.parse(await nextLine())).toMatchObject({
      result: { content: [{ text: "añ→🙂" }] },
    });
    input.write(`${call(2, "echo", { text: "a" })}\n${call(3, "echo", { text: "b" })}\n`);
    expect(JSON.parse(await nextLine())).toMatchObject({ id: 2 });
    expect(JSON.parse(await nextLine())).toMatchObject({ id: 3 });
    await end();
  });

  it("drops a line over the size limit and answers the next", async () => {
    const { input, nextLine, raw, end } = wire(options());
    const chunk = Buffer.alloc(1024 * 1024, 97);
    for (let written = 0; written <= MAX_MESSAGE_BYTES; written += chunk.length) input.write(chunk);
    // Said once, as a message the SDK's transports take: an error with no id.
    expect(message(await nextLine())).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: `Invalid request: a message over ${MAX_MESSAGE_BYTES} bytes`,
      },
    });
    input.write("still the same line\n");
    expect(await raw('{"jsonrpc":"2.0","id":1,"method":"ping"}')).toMatchObject({ id: 1 });
    await end();
  });

  it("answers in order, one at a time, and stops when its input ends", async () => {
    const order: string[] = [];
    const slow: Tool = {
      name: "slow",
      description: "",
      inputSchema: { type: "object", properties: { tag: { type: "string" } } },
      async run({ tag }) {
        order.push(`start ${tag}`);
        await new Promise((resolve) => setTimeout(resolve, tag === "a" ? 20 : 0));
        order.push(`end ${tag}`);
        return { text: String(tag) };
      },
    };
    const { input, nextLine, end } = wire({ ...options(), tools: [slow] });
    input.write(`${call(1, "slow", { tag: "a" })}\n${call(2, "slow", { tag: "b" })}\n`);
    expect(JSON.parse(await nextLine())).toMatchObject({ id: 1 });
    expect(JSON.parse(await nextLine())).toMatchObject({ id: 2 });
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
    await end();
  });

  it("holds a line to the limit however it arrives", async () => {
    const { input, nextLine, raw, end } = wire(options());
    const over = {
      code: -32600,
      message: `Invalid request: a message over ${MAX_MESSAGE_BYTES} bytes`,
    };
    const ping = '{"jsonrpc":"2.0","id":1,"method":"ping"}';
    // Whole in one write, its newline with it, and a good message behind it.
    input.write(
      Buffer.concat([Buffer.alloc(MAX_MESSAGE_BYTES + 1, 97), Buffer.from(`\n${ping}\n`)]),
    );
    expect(message(await nextLine())).toEqual({ jsonrpc: "2.0", error: over });
    expect(message(await nextLine())).toMatchObject({ id: 1, result: {} });
    // Under the limit in pieces, over it with the piece that ends it.
    input.write(Buffer.alloc(MAX_MESSAGE_BYTES - 1, 97));
    await new Promise((resolve) => setImmediate(resolve));
    input.write(Buffer.concat([Buffer.alloc(1024, 97), Buffer.from("\n")]));
    expect(message(await nextLine())).toEqual({ jsonrpc: "2.0", error: over });
    // Exactly the limit is a message: here one that is not JSON.
    input.write(Buffer.concat([Buffer.alloc(MAX_MESSAGE_BYTES, 97), Buffer.from("\n")]));
    expect(message(await nextLine())).toMatchObject({ error: { code: -32700 } });
    expect(await raw(ping)).toMatchObject({ id: 1 });
    await end();
  });

  it("takes ids that are strings or whole numbers, and no other", async () => {
    const { raw, end } = wire(options());
    const ping = (id: string) => raw(`{"jsonrpc":"2.0","id":${id},"method":"ping"}`);
    expect(await ping("0")).toEqual({ jsonrpc: "2.0", id: 0, result: {} });
    expect(await ping('""')).toMatchObject({ id: "", result: {} });
    for (const id of ["1.5", "12345678901234567890", "null", "true", "[1]"])
      expect(await ping(id)).toEqual({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid request: id" },
      });
    await end();
  });

  it("drops a last line that never ended, and takes the client's name once", async () => {
    const names: string[] = [];
    const { raw, input, done } = wire({ ...options(), onClient: (name) => names.push(name) });
    const hello = (name: string) =>
      raw(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", clientInfo: { name } },
        }),
      );
    await hello("first");
    await hello("second");
    expect(names).toEqual(["first"]);
    input.write('{"jsonrpc":"2.0","id":2,"method":"ping"}');
    input.end();
    await done;
  });

  it("cuts a result that is too long, and says so", async () => {
    const big: Tool = {
      name: "big",
      description: "",
      inputSchema: { type: "object" },
      run: () => ({ text: "x".repeat(MAX_RESULT_CHARS + 5) }),
    };
    const client = await connect({ ...options(), tools: [big, echo] });
    const result = await client.callTool({ name: "big" });
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(text.length).toBeLessThan(MAX_RESULT_CHARS + 200);
    expect(text).toMatch(
      /\n\(cut: 200005 characters in all, the first 199700 shown\. Ask for less at a time\.\)$/,
    );
    const whole = await client.callTool({ name: "echo", arguments: { text: "y".repeat(1000) } });
    expect((whole.content as { text: string }[])[0]?.text).toHaveLength(1000);
    await client.close();
  });

  it("waits for a client that reads slowly", async () => {
    const big: Tool = {
      name: "big",
      description: "",
      inputSchema: { type: "object" },
      run: () => ({ text: "x".repeat(1024 * 1024) }),
    };
    let release: (() => void) | undefined;
    let written = 0;
    const output = {
      write: () => {
        written++;
        return false;
      },
      once: (_event: "drain", listener: () => void) => {
        release = listener;
      },
    };
    const lines = Array.from({ length: 5 }, (_, id) => `${call(id, "big")}\n`).join("");
    const input = (async function* () {
      yield Buffer.from(lines);
    })();
    const done = serve(input, output, { ...options(), tools: [big] });
    for (let answered = 1; answered <= 5; answered++) {
      await new Promise((resolve) => setImmediate(resolve));
      // One answer written, the next call not run until the client has taken it.
      expect(written).toBe(answered);
      release?.();
    }
    await done;
  });
});

describe("a tool's arguments", () => {
  const schema = {
    type: "object",
    properties: {
      n: { type: "integer", minimum: 1, maximum: 10 },
      x: { type: "number" },
      inner: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
      any: { type: "object", additionalProperties: true },
    },
  } as const;
  it("are held to the schema", () => {
    const wrong = (value: unknown) => invalid(value, schema);
    expect(wrong({ n: 10, x: 1.5, inner: { a: "" }, any: { whatever: [1] } })).toBeNull();
    expect(wrong({ n: 11 })).toBe("arguments.n must be at most 10");
    expect(wrong({ n: 1e300 })).toBe("arguments.n must be at most 10");
    expect(wrong({ n: Number.NaN })).toContain("must be integer");
    expect(wrong({ x: Number.POSITIVE_INFINITY })).toContain("must be number");
    expect(wrong({ inner: {} })).toBe("arguments.inner.a is missing");
    expect(wrong({ inner: { a: "", b: 1 } })).toContain("arguments.inner.b is not an argument");
    expect(wrong(JSON.parse('{"__proto__":1}'))).toContain(
      "arguments.__proto__ is not an argument",
    );
    expect(wrong({ constructor: 1 })).toContain("arguments.constructor is not an argument");
    expect(wrong([])).toBe("arguments must be object, not array");
    expect(wrong(null)).toBe("arguments must be object, not null");
  });

  it("are published as they are held: no property that is not named", async () => {
    expect(published(schema)).toMatchObject({
      additionalProperties: false,
      properties: {
        inner: { additionalProperties: false },
        any: { additionalProperties: true },
      },
    });
    const client = await connect(options());
    const { tools } = await client.listTools();
    expect(tools[0]?.inputSchema.additionalProperties).toBe(false);
    await client.close();
  });
});
