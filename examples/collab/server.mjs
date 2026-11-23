// A WebSocket server for the collab example (22.11): the authority of one document
// (`@folijs/collab`), a JSON file as its store, and the built page. What the app keeps (ADR-0012):
// the transport, the store, who the clients are. Run `npm run build` first, then
// `node server.mjs [--port 5184] [--store store.json]`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthority } from "@folijs/collab";
import { createDocument } from "@folijs/core";
import { WebSocketServer } from "ws";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const port = Number(arg("port", "5184"));
const here = fileURLToPath(new URL(".", import.meta.url));
const store = join(here, arg("store", "store.json"));
const dist = join(here, "dist");

// The stored snapshot, or a new document with a paragraph to edit.
const saved = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : null;
const authority = createAuthority({
  document:
    saved?.document ??
    createDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Edit this together." }] }],
    }),
  version: saved?.version ?? 0,
});
const persist = () => writeFileSync(store, JSON.stringify(authority.snapshot()));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  // Only files under dist/, never outside it.
  const file = normalize(join(dist, path === "/" ? "index.html" : path));
  if (!file.startsWith(dist) || !existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
});

const sockets = new WebSocketServer({ server, maxPayload: 4_000_000 });
/** Small integers, one per connection: they also keep the clients' new ids apart. */
let nextClient = 1;
const send = (socket, message) => socket.readyState === 1 && socket.send(JSON.stringify(message));
const everyone = (message) => {
  for (const socket of sockets.clients) send(socket, message);
};

sockets.on("connection", (socket) => {
  // Who it is: told by its first message (`hello`), a new id unless it comes back with one.
  let clientID = null;
  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (clientID === null) {
      if (message?.type !== "hello") return;
      const back = Number.isSafeInteger(message.clientID) && message.clientID < nextClient;
      clientID = back ? message.clientID : nextClient++;
      // Back from a version the log still has: the steps since. Otherwise the whole document.
      const missed = back ? authority.stepsSince(Number(message.version)) : null;
      if (missed && !("snapshot" in missed)) send(socket, { type: "steps", ...missed });
      else send(socket, { type: "init", clientID, snapshot: authority.snapshot() });
      return;
    }
    if (message?.type === "steps") {
      // The client's id is the connection's, whatever the message says.
      const result = authority.receive({ ...message, clientID });
      if (result.ok) {
        persist();
        everyone({ type: "steps", ...result.broadcast });
      } else send(socket, { type: "refused", reason: result.reason, version: result.version });
    } else if (message?.type === "catchup") {
      const missed = authority.stepsSince(Number(message.version));
      if ("snapshot" in missed) send(socket, { type: "init", clientID, ...missed });
      else send(socket, { type: "steps", ...missed });
    } else if (message?.type === "presence") {
      for (const other of sockets.clients)
        if (other !== socket) send(other, { ...message, clientID });
    }
  });
  socket.on("close", () => {
    if (clientID !== null) everyone({ type: "leave", clientID });
  });
});

server.listen(port, () => console.log(`http://localhost:${port}`));
