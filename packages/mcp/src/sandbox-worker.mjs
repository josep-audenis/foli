// The thread a script runs in (ADR-0010): QuickJS, compiled to WebAssembly, and nothing else.
// Plain JavaScript, copied to `dist` as it is: a worker is started from a file, in the tests
// from this one. `sandbox.ts` starts it, answers its calls and ends it.
import { parentPort, receiveMessageOnPort, workerData } from "node:worker_threads";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";

const { code, prelude, memory, stack, flag, port } = workerData;
const signal = new Int32Array(flag);
// A module of its own each run: nothing of an earlier script is in its memory.
const QuickJS = await newQuickJSWASMModuleFromVariant(variant);
const runtime = QuickJS.newRuntime();
runtime.setMemoryLimit(memory);
runtime.setMaxStackSize(stack);
const vm = runtime.newContext();

// The one way out: a name and JSON, answered with JSON. The host thread does the work while
// this one waits, so a call is an ordinary function to the script.
const call = vm.newFunction("__call", (name, args) => {
  Atomics.store(signal, 0, 0);
  port.postMessage({ name: vm.getString(name), args: vm.getString(args) });
  Atomics.wait(signal, 0, 0);
  const answer = receiveMessageOnPort(port)?.message;
  if (typeof answer !== "string") throw new Error("no answer");
  return vm.newString(answer);
});
vm.setProp(vm.global, "__call", call);
call.dispose();

/** What `evalCode` gave, as a message: the value as JSON text, or the error. */
const told = (result) => {
  if (result.error) {
    const error = vm.dump(result.error);
    result.error.dispose();
    return {
      error: {
        name: String(error?.name ?? "Error"),
        message: String(error?.message ?? error),
        stack: String(error?.stack ?? ""),
      },
    };
  }
  const value = vm.dump(result.value);
  result.value.dispose();
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
