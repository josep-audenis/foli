# ADR-0010: Code mode: a script in the MCP server

- **Status:** Accepted when merged, task 16.1 (2026-11-21), by an agent's review, as the owner
  asked for Phase 16 ("merge and build"). It starts from the proposals of the phase's plan and
  changes two of them on the spike's evidence: the sandbox runs in a thread of its own, and a
  failed run is taken back by the session, not by undo.
- **Context:** `@folijs/mcp` (Phase 14, 0.1.0) gives a model one operation per tool call. A
  task over many blocks ("replace X in every table cell") is dozens of calls; the trial of
  14.8 took 35 for three small tasks. Clients that can run code use `@folijs/agent` in their
  own sandbox; clients that talk MCP only cannot. The server has no dependency but Foli's own
  packages, and nothing in it runs code it was given.

## Question

How does the server run a script a model wrote, what does the script see, and what holds it?

## Spike (2026-11-21; `sandbox.ts` is kept, it is the start of 16.2)

Windows 11, Node 25.3.0, `quickjs-emscripten-core` and `@jitl/quickjs-wasmfile-release-sync`
0.32.0. Times are of one run each: indicative.

- **The script alone in QuickJS, the session in the server.** A function of the host's, called
  from the script with a name and JSON, ran `session.read()` and `replaceText` on the corpus's
  board report: 60 blocks read and 18 replacements in 6 calls, 36 ms. 1000 calls to the host
  took 29 ms in the same thread, 120 ms across threads.
- **In the server's own thread the time limit does not hold.** QuickJS asks its interrupt
  handler between its own instructions, once in about ten thousand; inside one of its native
  functions it does not ask. `for (;;) 'x'.repeat(1e6)` under a 2 s deadline was still running
  after 5 s, with one poll made; `'x'.padEnd(2 ** 30)` ran 2.6 s. A loop of such calls runs for
  minutes, and the server answers nothing meanwhile (ADR-0009: one message at a time).
- **In the server's own thread a script can end the server.** With the script's stack limit
  above about 256 kB, a plain recursion overflowed the thread's stack first: a `RangeError`
  thrown out of the WebAssembly module, in the host. Text nested 100,000 deep given to
  `JSON.parse` did it at any limit. The error can be caught, but the module is then in no
  known state.
- **In a worker thread both hold.** The same scripts, with the thread ended by the host after
  the deadline: every one stopped within 20 ms of it, the native calls included. With a 4 MB
  thread stack a recursion of the script's is QuickJS's own `stack overflow`, an error of the
  script with its line; one inside the engine's parser (`eval` of 200,000 nested brackets)
  still ends the thread, with no line: a failed run, and the server untouched. A run costs
  about 55 ms to start (the thread, the module's 10 ms).
- **QuickJS's memory limit does not hold in this build** (found by the review of #165, not by
  the spike). `setMemoryLimit` refused one allocation over the limit and about limit/8
  allocations, whatever their size: under a limit of 8 MB a loop of 1 MB arrays reached the
  module's 2 GB, and runs after it failed. The module asks the thread's
  `WebAssembly.Memory.prototype.grow` for more memory: that function, replaced in the worker
  to refuse past the limit, held the same loops to the limit in bytes (61 arrays of 1 MB under
  64 MB, then QuickJS's own "out of memory").
- **What the host parses must be small** (the same review). A call's arguments are JSON text
  the server's thread parses, where the timer lives: 10 MB of nested brackets, parsed and
  given back, held a 2 s run for 62 s (V8's `JSON.stringify` is quadratic in depth), and
  60 MB of objects in a loop ended a host started with a 512 MB heap.
- **What is there:** `fetch`, `require`, `process`, `setTimeout`, `console`, `WebAssembly`,
  `Atomics` are all undefined in the script. Its errors carry a line (`script:3:7`).
- **Taking a run back.** The editor's undo does not fit: it keeps 100 steps, joins steps made
  within half a second, and a first edit could join one made before the run. Inverting every
  step the run made, last first, in one change marked as an undo and not tracked, gave back
  the three corpus documents after replacements, insertions, a deletion, style changes, a
  comment, every control filled and the fields updated: the document equal as JSON, every
  handle naming its block. Without the undo mark core's rules for content controls refused to
  put back a list's placeholder and a check box's glyph.
- **`isolated-vm`** was not tried again: no binary for Node 25 (the exploration).

## Decision

### The script is alone in the sandbox

The sandbox holds the language and one object, `doc`. Its methods are functions of the server
over the open session: the reading and the operations the tools have, with the same checks
and the same refusals, as values. Foli's code is not in the sandbox. So a script can do to a
document what a sequence of tool calls can, and nothing else: tracking stays on, the author
stays the server's, and no file is reached (`open` and `save` are not on `doc`).

Not chosen: `@folijs/core` inside the sandbox (the exploration's spike). It needs `Intl` and
`structuredClone`, which QuickJS has not; a 578 kB bundle loaded each run; and code that holds
the editor can turn tracking off, so every result would need proving afterwards.
**Reverse this** only for a task the operations cannot do and a model needs in a loop.

### QuickJS as WebAssembly, in a thread of its own

- **The engine:** QuickJS compiled to WebAssembly (`quickjs-emscripten-core` with the one
  synchronous release variant). No native build, any Node the server runs on. The script's
  memory is the module's memory: there is no path into the host but the one function passed
  in. `isolated-vm` is out (a native addon, Node 24 and 26 only, in maintenance; its own
  README asks for a separate process). Node's `vm` is not a boundary.
- **A worker thread, a new one each run** (`node:worker_threads`), with a new module: nothing
  of a run is left for the next. The server ends the thread when the script is done and when
  its time is up, whatever it is doing. The thread's output streams are taken: nothing it
  prints reaches the process's stdout, which carries the protocol.
- **Calls to the host are ordinary functions to the script.** The thread posts the call,
  waits (`Atomics.wait`) and reads the answer (`receiveMessageOnPort`); the server's thread
  answers between its own events. No promise, no `await` in a script.
- **Only JSON crosses**, as text, both ways, and little of it: a call's arguments are refused
  in the sandbox over 200,000 characters, before they are sent; the host parses them with
  `JSON.parse` and checks them as a tool's are. The script's result is made text inside the
  sandbox, under its limits, and refused over a million characters; an error's message is cut
  at 2,000. What a script returns is shown on one line whatever it is: a script can replace
  `JSON.stringify` and return any text.
- **One run at a time**, as every tool call (ADR-0009).

### Limits

Each ends the run and takes it back. Defaults, constants of the server:

| Limit                 | Default                                                                       | How                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Time, the whole run   | 10 s                                                                          | The server ends the thread                                                                                                               |
| The script's memory   | 64 MB, the engine's own few included                                          | The module's memory is refused growth past it (the worker's `WebAssembly.Memory.prototype.grow`): "out of memory" is an error of the run |
| A call's arguments    | 200,000 characters as JSON                                                    | Refused in the sandbox, and again by the host                                                                                            |
| The script's stack    | 192 kB                                                                        | QuickJS's own limit, under what the thread's 4 MB stack holds                                                                            |
| Calls to the document | 5,000                                                                         | Counted by the server                                                                                                                    |
| The thread's own heap | 64+16 MB                                                                      | The worker's `resourceLimits`: over it the thread ends                                                                                   |
| What the tool answers | 200,000 characters, as every tool (ADR-0009); the log and the value each less |

A script can name its own failure as it likes (throw an error that reads "out of memory", or
one whose stack names another line): the run failed and is taken back either way.

### The server's own work is bounded apart

The time is kept in the server's thread, which also does the work of every call to `doc` and
of taking a run back: no timer fires while it works. Two reviews of #165 showed what that
leaves open. One `insertAfter` of 20,000 empty paragraphs (60 kB of arguments) ran for 85 s
and ended the server out of memory; a loop of smaller inserts was stopped at 10 s and then
took 27 s to take back. Then, with those held: a script that swapped a long paragraph's text
back and forth, adding nothing, ended the server in 14 s, because the checkpoint kept every
step's transaction, each with its documents (465 MB for 20,000 steps); and paragraphs
inserted in a table's cell were not counted. A fourth review found that one call could still
multiply what it was given (a replace of 500 places, each with 199,000 characters: 100
million characters in one call, 27 s and 1.35 GB), and that comment text counted against
nothing (three runs of comments made a document that could not be saved). So:

- One insert takes 500 paragraphs at most, one replace 500 places (`@folijs/agent`: the plain
  tools are held by it too), and one operation writes 300,000 characters at most, its places
  together (a replacement times its places, a value times the controls that take it, a merge field's
  value times the merge fields of its name, the headers' and notes' included). A
  call is bounded by that; the timer fires between calls.
- A run may insert 2,000 paragraphs, wherever, add 300,000 characters to the body, and give
  its calls a million characters in all (comments, values, everything but the log); past any
  of these the server ends it, whatever the script catches (`StopRun`).
- A rollback costs the same whatever the run did: the body is put back whole in one step,
  and only what changed beside it (a comment's text, a note, a header) is undone step by
  step. The checkpoint keeps no transaction. Undo is given back the state it had, not
  rebased.

While a script runs the server answers nothing else, a `ping` included. Measured with the
limits as they are (Windows 11, Node 25, one run each, five in one process): the
back-and-forth script, single inserts without end, and replaces at the multiplying cap
without end each answered in 10.0 s with the document as it was; comments of 190,000
characters without end, and every control filled without end, were stopped for what their
calls gave in 0.1 and 0.4 s. The process stayed under 700 MB across the five. Before, inserts
of 500 in a cell without end were stopped for what they added in 0.9 s. Measured, not proved: a script that finds an operation slow in itself would add
that operation's time once.
A hosted or shared server would want the run in another process; this one serves one client
on its own machine.

### All or nothing

A run that throws, or meets a limit, leaves the document as it was before the run: the
session marks a checkpoint before the script starts and goes back to it
(`session.checkpoint()` in `@folijs/agent`: the body put back whole and what changed beside
it undone, in one change that is not tracked, with the handles, the styles and undo as they
were). A run that ends well keeps its
edits, tracked like a tool's. So a model that reads "it failed at line 12" can fix the script
and run it again on the same document, not on a half-edited one.

### Behind a flag

The `run` tool is listed and answered only when the server is started with `--code`. Without
it the server is as in 0.1.0, and the engine is never loaded. Running code that a model wrote,
which may have read a hostile document, is a larger thing to accept than the plain tools; the
person who starts the server decides. **Reverse this** (on by default) when the sandbox has
been in use and reviewed without a finding.

### The dependency

The server's first dependencies outside Foli: `quickjs-emscripten-core`,
`@jitl/quickjs-wasmfile-release-sync` and their `@jitl/quickjs-ffi-types`, all 0.32.0, MIT,
795 kB, 650 kB and 80 kB unpacked (npm, 2026-11-21), pinned to the exact version. The module
holds QuickJS (MIT, Fabrice Bellard and Charlie Gordon). Nothing is copied into Foli:
`THIRD_PARTY_NOTICES.md` has no entry. They are loaded in the worker only, so a server
started without `--code` never reads them. An optional dependency was not chosen: a tool that
is there or not by what `npm` managed to install is harder to explain than a flag.

## Consequences

- A model does a loop in one call; the plain tools stay, and stay the default.
- `@folijs/mcp` is no longer "Foli's own packages only": README, `architecture.md`
  (dependency policy) and `security.md` say so.
- `@folijs/agent` gains `checkpoint()`, of use to any caller that wants all or nothing.
- A run costs a thread's start (about 55 ms) whatever it does.
- The sandbox is a new surface for hostile input: its limits and what is absent from it are
  tests (16.2, 16.5), each proved to fail when its guard is taken out.

## Not decided here

The names and shapes on `doc`, what the tool's description says, and the answer's format:
16.3 and 16.4, shaped by a model's trial (16.6).
