/**
 * The Model Context Protocol, as much of it as a server with tools speaks over stdio
 * (ADR-0009): JSON-RPC 2.0, one message per line, `initialize`, `ping`, `tools/list` and
 * `tools/call`. Written here and not taken from the SDK, whose client checks it in the tests.
 */
import { invalid, type JsonSchema } from "./schema.js";

/** The protocol versions answered, newest first. A client asking for another gets the newest. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** A line longer than this is not a message: it is dropped, and the client told. */
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/** What a tool gives back: text for the model; `isError` when it should act on it and try again. */
export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface Tool {
  name: string;
  /** For the model: what it does, when to use it, what it returns. */
  description: string;
  /** Its arguments, as a JSON Schema object; checked before `run`. */
  inputSchema: JsonSchema & { type: "object" };
  run(args: Record<string, unknown>): ToolResult | Promise<ToolResult>;
}

export interface ServerOptions {
  name: string;
  version: string;
  /** Said to the model once, by clients that pass it on: how to use the tools together. */
  instructions?: string;
  tools: readonly Tool[];
  /** The client's name, from its `initialize`. */
  onClient?(name: string): void;
  /** What went wrong that the client is not told (a tool that threw): for stderr. */
  log?(message: string): void;
}

type Id = string | number;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is Id =>
  typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Serves `options.tools` to the client on `input` and `output` (a process's stdin and stdout,
 * or any stream of bytes and anything to write lines to) until `input` ends. Messages are
 * answered one at a time, in order. Nothing a client sends makes it throw: what is not a message
 * is answered with a JSON-RPC error, or ignored where the protocol says to.
 */
export async function serve(
  input: AsyncIterable<Uint8Array | string>,
  output: { write(text: string): unknown },
  options: ServerOptions,
): Promise<void> {
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const send = (message: object) => {
    output.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  const fail = (id: Id | null, code: number, message: string) =>
    send({ id, error: { code, message } });

  const call = async (params: unknown): Promise<object> => {
    if (!isRecord(params) || typeof params.name !== "string")
      throw new RpcError(INVALID_PARAMS, "tools/call needs the tool's name");
    const tool = tools.get(params.name);
    if (!tool) throw new RpcError(INVALID_PARAMS, `Unknown tool: ${params.name}`);
    const args = params.arguments ?? {};
    let result: ToolResult;
    // Wrong arguments are the model's to correct: said as a result it reads, not as an error
    // of the protocol, which clients may keep from it.
    const wrong = invalid(args, tool.inputSchema);
    if (wrong) result = { text: `Wrong arguments for ${tool.name}: ${wrong}.`, isError: true };
    else
      try {
        result = await tool.run(args as Record<string, unknown>);
      } catch (error) {
        options.log?.(`${tool.name} threw: ${error instanceof Error ? error.stack : error}`);
        result = { text: `${tool.name} failed inside the server.`, isError: true };
      }
    return {
      content: [{ type: "text", text: result.text }],
      ...(result.isError ? { isError: true } : {}),
    };
  };

  const answer = async (method: string, params: unknown): Promise<object> => {
    switch (method) {
      case "initialize": {
        const asked = isRecord(params) ? params.protocolVersion : undefined;
        const client = isRecord(params) && isRecord(params.clientInfo) && params.clientInfo.name;
        if (typeof client === "string") options.onClient?.(client);
        return {
          protocolVersion: (PROTOCOL_VERSIONS as readonly unknown[]).includes(asked)
            ? asked
            : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: options.name, version: options.version },
          ...(options.instructions ? { instructions: options.instructions } : {}),
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: options.tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        };
      case "tools/call":
        return call(params);
      default:
        throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  };

  const handle = async (line: string): Promise<void> => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return fail(null, PARSE_ERROR, "Parse error: not JSON");
    }
    // No batches: the protocol dropped them (2025-06-18), and no client found sends them.
    if (!isRecord(message) || message.jsonrpc !== "2.0")
      return fail(null, INVALID_REQUEST, "Invalid request: not a JSON-RPC 2.0 message");
    const { id, method } = message;
    if (typeof method !== "string") {
      // A response: the server asks nothing, so there is nothing it answers.
      if ("result" in message || "error" in message) return;
      return fail(isId(id) ? id : null, INVALID_REQUEST, "Invalid request: no method");
    }
    // A notification (`notifications/initialized`, a cancellation): nothing to say.
    if (id === undefined) return;
    if (!isId(id)) return fail(null, INVALID_REQUEST, "Invalid request: id");
    try {
      send({ id, result: await answer(method, message.params) });
    } catch (error) {
      if (error instanceof RpcError) return fail(id, error.code, error.message);
      options.log?.(`${method} threw: ${error instanceof Error ? error.stack : error}`);
      fail(id, -32603, "Internal error");
    }
  };

  let buffered: Buffer[] = [];
  let size = 0;
  let dropping = false;
  for await (const chunk of input) {
    let rest: Buffer = Buffer.from(chunk);
    for (;;) {
      const end = rest.indexOf(10);
      if (end < 0) break;
      const line = Buffer.concat([...buffered, rest.subarray(0, end)]).toString("utf8");
      rest = rest.subarray(end + 1);
      buffered = [];
      size = 0;
      if (dropping) dropping = false;
      else if (line.trim()) await handle(line.replace(/\r$/, ""));
    }
    if (dropping) continue;
    size += rest.length;
    if (size > MAX_MESSAGE_BYTES) {
      // The rest of the line, when it comes, is not a message either.
      buffered = [];
      size = 0;
      dropping = true;
      fail(null, INVALID_REQUEST, `Invalid request: a message over ${MAX_MESSAGE_BYTES} bytes`);
    } else if (rest.length) buffered.push(rest);
  }
}
