import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSIONS, type Tool } from "./protocol.js";
import { connect, wire } from "./testing/client.js";

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
    expect(log.join("\n")).toContain("secret detail");
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
    expect(JSON.parse(await nextLine())).toMatchObject({ id: null, error: { code: -32600 } });
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
});
