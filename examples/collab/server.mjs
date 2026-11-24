// A WebSocket server for the collab example (22.11, 24.4): the authority of one document and the
// hub that speaks for it (`@folijs/collab`), a JSON file as its store, and the built page. What the app keeps (ADR-0012):
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
import { createAuthority, createHub } from "@folijs/collab";
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
const hub = createHub(authority);
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
/** The connected clients' sockets, by id: a token is honoured by one connection at a time. */
const connected = new Map();
const send = (socket, message) => socket.readyState === 1 && socket.send(JSON.stringify(message));
/** What the hub gave, to whom it goes: everyone, the sender or the others. */
const deliver = (from, out) => {
  for (const { to, message } of out) {
    if (message.type === "steps" && to === "everyone") persist(); // accepted steps
    for (const [id, socket] of connected)
      if (to === "everyone" || (to === "sender") === (id === from)) send(socket, message);
  }
};

sockets.on("connection", (socket) => {
  // Who it is: told by its first message (`hello`), through the token it was given; a new client
  // otherwise. A client never names its own id.
  let clientID = null;
  socket.on("message", (data) => {
    if (clientID !== null) {
      deliver(clientID, hub.receive(String(data), clientID));
      return;
    }
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
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
    connected.set(clientID, socket);
    send(socket, { type: "hello", token });
    // A new client gets the document; one back resumes (it asks for what it missed) and gets
    // who is here now (it missed those who left meanwhile).
    const joined = hub.join(clientID);
    deliver(clientID, back ? joined.slice(1) : joined);
  });
  socket.on("close", () => {
    if (clientID === null || connected.get(clientID) !== socket) return;
    connected.delete(clientID);
    deliver(clientID, hub.leave(clientID));
  });
});

server.listen(port, () => console.log(`http://localhost:${port}`));
