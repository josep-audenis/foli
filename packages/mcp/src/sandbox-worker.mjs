// The thread a script runs in (ADR-0010): QuickJS, compiled to WebAssembly, and nothing else.
// Plain JavaScript, copied to `dist` as it is: a worker is started from a file, in the tests
// from this one. `sandbox.ts` starts it, answers its calls and ends it.
import { parentPort, receiveMessageOnPort, workerData } from "node:worker_threads";

const { code, prelude, memory, stack, maxArgs, maxValue, flag, port } = workerData;

// The script's memory is the module's memory, and this holds it: the module asks for more
// through this function, and is told there is none. QuickJS's own limit (`setMemoryLimit`)
// does not count bytes in this build: a script reached 2 GB under a limit of 8 MB.
const grow = WebAssembly.Memory.prototype.grow;
WebAssembly.Memory.prototype.grow = function (pages) {
  if (this.buffer.byteLength + pages * 65536 > memory) throw new RangeError("memory");
  return grow.call(this, pages);
};

const { default: variant } = await import("@jitl/quickjs-wasmfile-release-sync");
const { newQuickJSWASMModuleFromVariant } = await import("quickjs-emscripten-core");

const signal = new Int32Array(flag);
// A module of its own each run: nothing of an earlier script is in its memory.
const QuickJS = await newQuickJSWASMModuleFromVariant(variant);
const runtime = QuickJS.newRuntime();
runtime.setMemoryLimit(memory);
runtime.setMaxStackSize(stack);
const vm = runtime.newContext();

/** Text of the script's as a string of this thread, whatever it is; cut at `most`. */
const text = (value, most) => {
  try {
    return String(value).slice(0, most);
  } catch {
    return "";
  }
};

// The one way out: a name and JSON, answered with JSON. The host thread does the work while
// this one waits, so a call is an ordinary function to the script.
const call = vm.newFunction("__call", (nameHandle, argsHandle) => {
  // Both read first: reading may run the script's code (a `toString`), which may call again.
  const name = vm.getString(nameHandle);
  const args = vm.getString(argsHandle);
  // The host parses the arguments in the thread that keeps the time: they are held to a size
  // here, before they are sent.
  if (name.length > 100 || args.length > maxArgs)
    return vm.newString(
      JSON.stringify({ error: `A call's arguments are over ${maxArgs} characters as JSON.` }),
    );
  Atomics.store(signal, 0, 0);
  port.postMessage({ name, args });
  Atomics.wait(signal, 0, 0);
  const answer = receiveMessageOnPort(port)?.message;
  if (typeof answer !== "string") throw new Error("no answer");
  return vm.newString(answer);
});
vm.setProp(vm.global, "__call", call);
call.dispose();

/** What `evalCode` gave, as a message: the value as text, or the error. */
const told = (result) => {
  if (result.error) {
    let error;
    try {
      error = vm.dump(result.error);
    } catch {
      error = null;
    }
    const thrown = error !== null && typeof error === "object";
    return {
      error: {
        name: thrown ? text(error.name ?? "Error", 100) : "Error",
        message: thrown ? text(error.message ?? "", 2000) : text(error, 2000),
        stack: thrown ? text(error.stack ?? "", 2000) : "",
      },
    };
  }
  const value = vm.dump(result.value);
  if (typeof value === "string" && value.length > maxValue)
    return {
      error: {
        name: "RangeError",
        message: `the value returned is over ${maxValue} characters as JSON`,
        stack: "",
      },
    };
  return { value };
};

const ready = told(vm.evalCode(prelude, "prelude"));
if (ready.error) parentPort.postMessage({ error: { ...ready.error, name: "PreludeError" } });
else
  parentPort.postMessage(
    // The script is a function's body: `return` gives its answer. The value is made text in
    // the sandbox, under its limits; undefined (nothing returned) is told apart.
    told(
      vm.evalCode(
        `(function () { const value = (function () {\n${code}\n})(); return value === undefined ? "" : JSON.stringify(value) ?? ""; })()`,
        "script",
      ),
    ),
  );
