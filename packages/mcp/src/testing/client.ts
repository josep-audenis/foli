import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import { type ServerOptions, serve } from "../protocol.js";

/** A line the server wrote, as the SDK's own transports take it: a valid MCP message, or a throw. */
export const message = (line: string) => JSONRPCMessageSchema.parse(JSON.parse(line));

/**
 * The server on two in-process streams, as it is on stdin and stdout: every byte it reads and
 * writes goes through them. `raw` writes a line to it as it is and gives back what it answered.
 */
export function wire(options: ServerOptions) {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = serve(input, output, options);
  const lines: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let rest = "";
  output.on("data", (chunk: Buffer) => {
    rest += chunk.toString("utf8");
    for (;;) {
      const end = rest.indexOf("\n");
      if (end < 0) break;
      const line = rest.slice(0, end);
      rest = rest.slice(end + 1);
      const next = waiting.shift();
      if (next) next(line);
      else lines.push(line);
    }
  });
  const nextLine = () =>
    new Promise<string>((resolve) => {
      const line = lines.shift();
      if (line !== undefined) resolve(line);
      else waiting.push(resolve);
    });
  return {
    input,
    done,
    nextLine,
    /** Writes `text` and a newline, and reads one answer. */
    async raw(text: string | Buffer) {
      input.write(text);
      input.write("\n");
      return message(await nextLine()) as unknown as Record<string, unknown>;
    },
    /** Ends the client's side; resolves when the server has stopped. */
    async end(): Promise<void> {
      input.end();
      await done;
    },
  };
}

/** The official SDK's client connected to the server over the wire: the conformance check. */
export async function connect(options: ServerOptions, version?: string) {
  const { input, nextLine, end } = wire(options);
  let closed = false;
  const transport: Transport = {
    async start() {
      void (async () => {
        while (!closed) transport.onmessage?.(message(await nextLine()));
      })();
    },
    async send(message) {
      const asked =
        version && "method" in message && message.method === "initialize"
          ? { ...message, params: { ...message.params, protocolVersion: version } }
          : message;
      input.write(`${JSON.stringify(asked)}\n`);
    },
    async close() {
      closed = true;
      await end();
      transport.onclose?.();
    },
  };
  const client = new Client({ name: "foli-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}
