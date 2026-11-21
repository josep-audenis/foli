/**
 * The Model Context Protocol, as much of it as a server with tools speaks over stdio
 * (ADR-0009): JSON-RPC 2.0, one message per line, `initialize`, `ping`, `tools/list` and
 * `tools/call`. Written here and not taken from the SDK, whose client checks it in the tests.
 */
import { invalid, type JsonSchema, published } from "./schema.js";

/** The protocol versions answered, newest first. A client asking for another gets the newest. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** A line longer than this is not a message: it is dropped, and the client told. */
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/**
 * The most characters of a tool's result that are sent: more is cut, and said. A client, and
 * the model's context behind it, is not the place for a document whole.
 */
export const MAX_RESULT_CHARS = 200_000;

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

/**
 * Where answers go: a stream (`write`, and `once("drain")` when it is full, or `close` or
 * `error` when it went away), or anything with `write`.
 */
export interface Output {
  write(text: string): unknown;
  once?(event: "drain" | "close" | "error", listener: () => void): unknown;
  off?(event: "drain" | "close" | "error", listener: () => void): unknown;
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
const isId = (v: unknown): v is Id => typeof v === "string" || Number.isSafeInteger(v);

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/**
 * An error for the log: its kind and where it was thrown, not its message, which may quote the
 * document it was thrown over. Clients keep a server's stderr.
 */
const where = (error: unknown) =>
  error instanceof Error
    ? [error.name, ...(error.stack ?? "").split("\n").filter((l) => /^\s+at /.test(l))].join("\n")
    : typeof error;

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
 * answered one at a time, in order: the next is read once the answer is written, and taken by
 * `output` when it says it is full. Nothing read from `input` makes it throw: what is not a
 * message is answered with a JSON-RPC error, or ignored where the protocol says to. It rejects
 * only when `input` or `output` themselves fail.
 */
export async function serve(
  input: AsyncIterable<Uint8Array | string>,
  output: Output,
  options: ServerOptions,
): Promise<void> {
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const send = async (message: object) => {
    const taken = output.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    // A client that reads slowly holds the server back, rather than filling its memory.
    if (taken === false && output.once)
      await new Promise<void>((resolve, reject) => {
        const settle = (closed: boolean) => () => {
          for (const event of ["drain", "close", "error"] as const)
            output.off?.(event, event === "drain" ? drained : gone);
          if (closed) reject(new Error("The output closed before an answer was taken"));
          else resolve();
        };
        const drained = settle(false);
        const gone = settle(true);
        // A stream that closes without draining would hold the server forever.
        output.once?.("close", gone);
        output.once?.("error", gone);
        output.once?.("drain", drained);
      });
  };
  // An error for no request there is an id for has none: `null` is not an id to MCP clients.
  const fail = (id: Id | null, code: number, message: string) =>
    send({ ...(id === null ? {} : { id }), error: { code, message } });

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
        options.log?.(`${tool.name} threw: ${where(error)}`);
        result = { text: `${tool.name} failed inside the server.`, isError: true };
      }
    const text =
      result.text.length > MAX_RESULT_CHARS
        ? `${result.text.slice(0, MAX_RESULT_CHARS)}\n(cut: ${result.text.length} characters in all, the first ${MAX_RESULT_CHARS} shown. Ask for less at a time.)`
        : result.text;
    return {
      content: [{ type: "text", text }],
      ...(result.isError ? { isError: true } : {}),
    };
  };

  let named = false;
  const answer = async (method: string, params: unknown): Promise<object> => {
    switch (method) {
      case "initialize": {
        const asked = isRecord(params) ? params.protocolVersion : undefined;
        const client = isRecord(params) && isRecord(params.clientInfo) && params.clientInfo.name;
        // The first one's: a client does not rename itself.
        if (typeof client === "string" && !named) {
          named = true;
          options.onClient?.(client);
        }
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
            inputSchema: published(inputSchema),
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
      const result = await answer(method, message.params);
      return send({ id, result });
    } catch (error) {
      if (error instanceof RpcError) return fail(id, error.code, error.message);
      options.log?.(`${method} threw: ${where(error)}`);
      return fail(id, -32603, "Internal error");
    }
  };

  const tooLong = () =>
    fail(null, INVALID_REQUEST, `Invalid request: a message over ${MAX_MESSAGE_BYTES} bytes`);
  /** The line being read: its pieces so far, their size, and whether it is over the limit. */
  let buffered: Buffer[] = [];
  let size = 0;
  let dropping = false;
  let first = true;
  for await (const chunk of input) {
    let rest: Buffer = Buffer.from(chunk);
    for (;;) {
      const end = rest.indexOf(10);
      if (end < 0) break;
      // Over the limit however it arrived: in pieces, or whole with its newline.
      const whole = !dropping && size + end <= MAX_MESSAGE_BYTES;
      let line = whole ? Buffer.concat([...buffered, rest.subarray(0, end)]).toString("utf8") : "";
      // A byte order mark some clients write before the first message is not part of it
      // (read from the decoded line: it may come split over chunks).
      if (first) {
        first = false;
        if (line.startsWith("﻿")) line = line.slice(1);
      }
      const said = dropping;
      rest = rest.subarray(end + 1);
      buffered = [];
      size = 0;
      dropping = false;
      if (!whole) {
        if (!said) await tooLong();
      } else if (line.trim()) await handle(line.replace(/\r$/, ""));
    }
    if (dropping) continue;
    size += rest.length;
    if (size > MAX_MESSAGE_BYTES) {
      // The rest of the line, when it comes, is not a message either.
      buffered = [];
      dropping = true;
      await tooLong();
    } else if (rest.length) buffered.push(rest);
  }
}
