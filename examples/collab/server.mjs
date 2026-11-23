// A WebSocket server for the collab example (22.11): the authority of one document
// (`@folijs/collab`), a JSON file as its store, and the built page. What the app keeps (ADR-0012):
// the transport, the store, who the clients are. Run `npm run build` first, then
// `node server.mjs [--port 5184] [--store store.json]`.
//
// An example, not a product: no login (a client is whoever holds its token), any page may
// connect (no Origin check). An app authenticates its users and checks who may edit (`authorize`).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
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
const MESSAGE_SIZE = 4_000_000;

// The stored snapshot and log, or a new document with a paragraph to edit.
const saved = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : null;
const authority = createAuthority({
  document:
    saved?.document ??
    createDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Edit this together." }] }],
    }),
  version: saved?.version ?? 0,
  ...(saved?.log ? { log: saved.log } : {}),
  limits: { messageSize: MESSAGE_SIZE },
});
/** Who the clients are: the secret token each was given, and its id. Kept with the document. */
const tokens = new Map(Object.entries(saved?.tokens ?? {}));
/** Small integers, one per client ever seen: they also keep the clients' new ids apart. */
let nextClient = saved?.nextClient ?? 1;

// Written whole to a file beside it and renamed over it (a crash never leaves half a store),
// at most once a tick (a burst of batches is one write).
let pending = false;
const persist = () => {
  if (pending) return;
  pending = true;
  setImmediate(() => {
    pending = false;
    const data = {
      ...authority.snapshot(),
      log: authority.log,
      tokens: Object.fromEntries(tokens),
      nextClient,
    };
    writeFileSync(`${store}.tmp`, JSON.stringify(data));
    renameSync(`${store}.tmp`, store);
  });
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  // Only files under dist/, never outside it, never a folder.
  const file = normalize(join(dist, path === "/" ? "index.html" : path));
  let found = false;
  try {
    found = file.startsWith(dist + sep) && statSync(file).isFile();
  } catch {}
  if (!found) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
});

const sockets = new WebSocketServer({ server, maxPayload: MESSAGE_SIZE });
/** The ids connected now: a token is honoured by one connection at a time. */
const connected = new Set();
const send = (socket, message) => socket.readyState === 1 && socket.send(JSON.stringify(message));
const everyone = (message) => {
  for (const socket of sockets.clients) send(socket, message);
};

sockets.on("connection", (socket) => {
  // Who it is: told by its first message (`hello`), through the token it was given; a new client
  // otherwise. A client never names its own id.
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
      const known = typeof message.token === "string" ? tokens.get(message.token) : undefined;
      const back = known !== undefined && !connected.has(known);
      let token = message.token;
      if (back) clientID = known;
      else {
        clientID = nextClient++;
        token = randomUUID();
        tokens.set(token, clientID);
        persist();
      }
      connected.add(clientID);
      // Back from a version the log still has: the steps since. Otherwise the whole document.
      const missed = back ? authority.stepsSince(Number(message.version)) : null;
      if (missed && !("snapshot" in missed)) send(socket, { type: "steps", ...missed });
      else send(socket, { type: "init", clientID, token, snapshot: authority.snapshot() });
      return;
    }
    if (message?.type === "steps") {
      const result = authority.receive(message, clientID);
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
    if (clientID === null) return;
    connected.delete(clientID);
    everyone({ type: "leave", clientID });
  });
});

server.listen(port, () => console.log(`http://localhost:${port}`));
