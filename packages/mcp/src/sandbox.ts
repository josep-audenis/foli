/**
 * Runs a script nobody trusts (ADR-0010): in QuickJS, compiled to WebAssembly, in a thread of
 * its own. The script has the language and one function, `__call(name, json)`, which this
 * side answers; no file, network, timer, module or object of Node's is there. The thread is
 * ended when the script is done, and when it is not done in time.
 *
 * It knows nothing of documents: `tools.ts` gives it the functions a script may call.
 */
import { MessageChannel, Worker } from "node:worker_threads";

/** @internal */
export interface SandboxLimits {
  /** Wall-clock time for the whole run, the host's answers included. */
  ms: number;
  /**
   * The script's memory, in bytes: all the WebAssembly module may hold, the engine's own few
   * megabytes included.
   */
  memory: number;
  /** How many calls to the host a run may make. */
  calls: number;
}

/** @internal */
export const SANDBOX_LIMITS: SandboxLimits = { ms: 10_000, memory: 64 * 1024 * 1024, calls: 5_000 };

/**
 * @internal
 * The most a call's arguments may be, as JSON text, and the most a script may return. The
 * host parses the arguments in the thread that keeps the time, and its answers may hold them.
 */
export const MAX_ARGS = 200_000;
/** @internal */
export const MAX_VALUE = 1_000_000;

/**
 * The script's stack, in bytes. Above about 256 kB a deep recursion overflows the thread's own
 * stack before QuickJS sees its limit (ADR-0010, the spike): the thread would end with no line
 * to tell.
 */
const STACK = 192 * 1024;

/**
 * @internal
 * Answers one call of the script: its name and its arguments as the script gave them (parsed
 * JSON: anything). What it returns goes back as JSON; what it throws is thrown in the script.
 */
export type Host = (name: string, args: unknown) => unknown;

/**
 * @internal
 * Thrown by a host function to end the run there: a limit of the host's own was met. Any
 * other error is thrown in the script, which may catch it.
 */
export class StopRun extends Error {}

/** @internal */
export type Ran =
  | {
      ok: true;
      /** What the script returned, as JSON text; "" when it returned nothing. */
      value: string;
      calls: number;
    }
  | {
      ok: false;
      /**
       * `error`: the script threw (a syntax error included). `time`, `memory`, `calls`: a
       * limit. `host`: the host ended it (`StopRun`). `crash`: the thread ended some other
       * way.
       */
      reason: "error" | "time" | "memory" | "calls" | "host" | "crash";
      /** The error's name and message, for `error`. */
      message: string;
      /** The line of the script it was thrown at, when known (1 is its first). */
      line: number | null;
      calls: number;
    };

const WORKER = new URL("./sandbox-worker.mjs", import.meta.url);

/** The script's line in a QuickJS stack: its first frame in "script", less the wrapper's line. */
const lineOf = (stack: string): number | null => {
  // Frames read "at f (script:3:7)", a syntax error's "at script:3:7".
  const found = /\bscript:(\d+)/.exec(stack);
  const line = found ? Number(found[1]) - 1 : 0;
  return line > 0 ? line : null;
};

/**
 * @internal
 * Runs `code` as a function's body, after `prelude` (the server's own code, which builds what
 * the script sees over `__call`). Never throws. The script itself never has longer than
 * `limits.ms`; the time is kept in the host's thread, so the answer comes when the host
 * function that is running at that moment has returned: a host function must be bounded.
 */
export function runScript(
  code: string,
  prelude: string,
  host: Host,
  limits: SandboxLimits = SANDBOX_LIMITS,
): Promise<Ran> {
  return new Promise((resolve) => {
    let calls = 0;
    let settled = false;
    const flag = new SharedArrayBuffer(4);
    const signal = new Int32Array(flag);
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(WORKER, {
      workerData: {
        code,
        prelude,
        memory: limits.memory,
        stack: STACK,
        maxArgs: MAX_ARGS,
        maxValue: MAX_VALUE,
        flag,
        port: port2,
      },
      transferList: [port2],
      // Nothing the thread prints reaches the process's stdout, which carries the protocol.
      stdout: true,
      stderr: true,
      env: {},
      execArgv: [],
      // The thread's own JavaScript: the module's glue and the messages. The script's memory
      // is the WebAssembly module's, held by `memory`.
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    const end = (ran: Ran) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port1.close();
      // Ended whatever it is doing: a loop, a native call, a wait for an answer.
      void worker.terminate();
      resolve(ran);
    };
    const failed = (reason: "time" | "calls" | "host" | "crash", message: string) =>
      end({ ok: false, reason, message, line: null, calls });
    const timer = setTimeout(
      () => failed("time", `It did not finish in ${limits.ms / 1000} seconds.`),
      limits.ms,
    );

    port1.on("message", (message: { name: string; args: string }) => {
      if (settled) return;
      if (++calls > limits.calls)
        return failed("calls", `It made more than ${limits.calls} calls to the document.`);
      let answer: string;
      try {
        // Held to a size by the thread already; checked here, where it is parsed.
        if (typeof message?.name !== "string" || typeof message.args !== "string")
          throw new Error("not a call");
        if (message.args.length > MAX_ARGS) throw new Error("the arguments are too large");
        answer = JSON.stringify({ value: host(message.name, JSON.parse(message.args)) ?? null });
      } catch (error) {
        if (error instanceof StopRun) return failed("host", error.message);
        // Whatever was thrown, and whatever its message is: an answer.
        let said = "failed";
        try {
          if (error instanceof Error && typeof error.message === "string") said = error.message;
        } catch {}
        answer = JSON.stringify({ error: said });
      }
      port1.postMessage(answer);
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0);
    });
    worker.on(
      "message",
      (
        message: { value: unknown } | { error: { name: string; message: string; stack: string } },
      ) => {
        if ("error" in message) {
          const { name, message: text, stack } = message.error;
          const memory = name === "InternalError" && text === "out of memory";
          end({
            ok: false,
            reason: memory ? "memory" : "error",
            message: memory
              ? `It used more than ${Math.round(limits.memory / 1024 / 1024)} MB of memory.`
              : `${name}: ${text}`,
            line: lineOf(stack),
            calls,
          });
        } else
          end({ ok: true, value: typeof message.value === "string" ? message.value : "", calls });
      },
    );
    // The thread's own failure: its stack or its memory gone, the module not loaded.
    worker.on("error", () => failed("crash", "It could not be run to its end."));
    worker.on("exit", () => failed("crash", "It could not be run to its end."));
  });
}
