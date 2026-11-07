"use client";

import { createDocument, parseDocument } from "@foli/core";
import { FoliEditor } from "@foli/react";
import { useState } from "react";

const KEY = "foli-example";

/**
 * The saved document in the browser (a new one when it no longer parses); a new one on the
 * server, which renders no content anyway.
 * (`window`, not `localStorage`: recent Node versions have a server-side `localStorage`.)
 */
function load() {
  const saved = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  try {
    if (saved) return parseDocument(JSON.parse(saved));
  } catch (error) {
    console.warn("Ignoring the saved document:", error);
  }
  return createDocument();
}

// Save once typing pauses: `change.document` is serialized only when read.
let latest;
let timer;
function save() {
  if (latest) localStorage.setItem(KEY, JSON.stringify(latest.document));
  latest = undefined;
}

export function Editor() {
  const [initial] = useState(load);
  return (
    <FoliEditor
      initialContent={initial}
      placeholder="Start writing…"
      onChange={(change) => {
        latest = change;
        clearTimeout(timer);
        timer = setTimeout(save, 300);
        addEventListener("pagehide", save, { once: true });
      }}
    />
  );
}
