// The external corpus (Phase 20, ADR-0011): real .docx files from the test suites of projects
// that publish them, at pinned commits, into `.corpus-cache/` (ignored, never committed).
//
//   pnpm corpus:fetch            download what is missing, check every file's SHA-256
//   pnpm corpus:fetch --update   list the sources' pinned trees again and rewrite the manifest
//
// `corpus/external.json` is the manifest: the sources (repository, commit, license) and every
// file (source, path, size, SHA-256). A file whose bytes do not match is deleted and reported,
// never run. GitHub's API lists the trees (set GITHUB_TOKEN for its higher rate limit); the files
// come from raw.githubusercontent.com.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..", "..");
const manifestPath = join(root, "corpus", "external.json");
export const cache = join(root, ".corpus-cache");
/** No test document of these suites comes near this; a bigger one is not fetched. */
const MAX_BYTES = 25 * 1024 * 1024;

/** The sources, as ADR-0011 records them: what of each repository is fetched. */
export const SOURCES = [
  {
    name: "poi",
    repo: "apache/poi",
    commit: "c94ee8ad9096bdb8cf8e5e59d8d12432e950dbf3",
    license: "Apache-2.0 (legal/LICENSE)",
    paths: ["test-data"],
  },
  {
    name: "libreoffice",
    repo: "LibreOffice/core",
    commit: "bfae41929a538e7a734933026b20507461463caa",
    license: "MPL-2.0 (COPYING.MPL)",
    paths: ["sw/qa/extras/ooxmlexport/data", "sw/qa/extras/ooxmlimport/data"],
  },
  {
    name: "docx4j",
    repo: "plutext/docx4j",
    commit: "836eab29ea8b47536ba9320e9bdf3da434de1d2f",
    license: "Apache-2.0 (legals/LICENSE)",
    paths: [""],
  },
  {
    name: "python-docx",
    repo: "python-openxml/python-docx",
    commit: "e45454602b53e8e572b179ccf1c91093ec9f4ed7",
    license: "MIT (LICENSE)",
    paths: [""],
  },
  {
    name: "open-xml-sdk",
    repo: "dotnet/Open-XML-SDK",
    commit: "431ab05cf160248cc3885a4a766026d4f8243792",
    license: "MIT (LICENSE)",
    paths: [""],
  },
];

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "foli-corpus-fetch",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function api(path) {
  const response = await fetch(`https://api.github.com/${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${path}: ${response.status}`);
  return response.json();
}

/** The .docx blobs under `prefix` of a source's pinned tree (a subtree for a large repository). */
async function listDocx(source, prefix) {
  let sha = source.commit;
  if (prefix) {
    const parent = prefix.split("/").slice(0, -1).join("/");
    const name = prefix.split("/").pop();
    const entries = await api(`repos/${source.repo}/contents/${parent}?ref=${source.commit}`);
    const entry = entries.find((e) => e.name === name && e.type === "dir");
    if (!entry) throw new Error(`${source.repo}: no ${prefix} at ${source.commit}`);
    sha = entry.sha;
  }
  const tree = await api(`repos/${source.repo}/git/trees/${sha}?recursive=1`);
  if (tree.truncated)
    throw new Error(`${source.repo}/${prefix}: tree truncated, list a narrower path`);
  return tree.tree
    .filter((e) => e.type === "blob" && e.path.toLowerCase().endsWith(".docx"))
    .filter((e) => e.size <= MAX_BYTES)
    .map((e) => (prefix ? `${prefix}/${e.path}` : e.path));
}

/**
 * Where a manifest file lives in the cache: `<source>/<path>`, refused unless the source is a
 * plain name and every path segment a plain file or folder name (no `..`, no empty segment, no
 * `\` or `:`: no other source's folder, no drive, no NTFS stream).
 */
export function cachePath(file) {
  const segments = String(file.path).split("/");
  const plain = segments.every((s) => s && s !== "." && s !== ".." && !/[\\:]/.test(s));
  if (!/^[a-z0-9-]+$/.test(String(file.source)) || !plain)
    throw new Error(`refused path ${file.source}/${file.path}`);
  return normalize(join(cache, file.source, ...segments));
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A file's bytes at its source's commit, no more than `limit`; three tries. */
async function download(source, path, limit = MAX_BYTES) {
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": headers["User-Agent"] } });
      if (!response.ok) throw new Error(`${response.status}`);
      // Counted as it arrives: a body over the limit is never held whole.
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) throw Object.assign(new Error(`over ${limit} bytes`), { final: true });
        chunks.push(chunk);
      }
      return new Uint8Array(Buffer.concat(chunks));
    } catch (error) {
      if (error.final || attempt === 3) throw new Error(`${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/** Runs `task` over `items`, `limit` at a time. */
async function pool(items, limit, task) {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) await task(items[next++]);
    }),
  );
}

async function update() {
  const files = [];
  for (const source of SOURCES)
    for (const prefix of source.paths)
      for (const path of await listDocx(source, prefix)) files.push({ source: source.name, path });
  const bySource = Object.fromEntries(SOURCES.map((s) => [s.name, s]));
  const failed = [];
  await pool(files, 8, async (file) => {
    try {
      const at = cachePath(file);
      const bytes = await download(bySource[file.source], file.path);
      file.size = bytes.length;
      file.sha256 = sha256(bytes);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, bytes);
    } catch (error) {
      failed.push(`${file.source}/${file.path}: ${error.message}`);
    }
  });
  // All or nothing: a manifest is never written with files missing.
  if (failed.length) {
    for (const line of failed) console.error(`  failed: ${line}`);
    throw new Error(`${failed.length} files could not be fetched; the manifest is unchanged`);
  }
  files.sort((a, b) => a.source.localeCompare(b.source) || a.path.localeCompare(b.path));
  writeFileSync(manifestPath, `${JSON.stringify({ sources: SOURCES, files }, null, 1)}\n`);
  console.log(`manifest: ${files.length} files from ${SOURCES.length} sources`);
}

/** Downloads what the cache lacks and checks every file; returns the files that are good. */
export async function fetchAll({ log = console.log } = {}) {
  const { sources, files } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bySource = Object.fromEntries(sources.map((s) => [s.name, s]));
  let fetched = 0;
  const bad = [];
  await pool(files, 8, async (file) => {
    const at = cachePath(file);
    if (!existsSync(at)) {
      try {
        const bytes = await download(bySource[file.source], file.path, file.size);
        mkdirSync(dirname(at), { recursive: true });
        writeFileSync(at, bytes);
        fetched++;
      } catch (error) {
        bad.push(`${file.source}/${file.path}: ${error.message}`);
        return;
      }
    }
    if (sha256(readFileSync(at)) !== file.sha256) {
      rmSync(at);
      bad.push(`${file.source}/${file.path}: SHA-256 differs from the manifest (deleted)`);
    }
  });
  log(`${files.length - bad.length} of ${files.length} files ready (${fetched} downloaded)`);
  for (const line of bad) log(`  refused: ${line}`);
  return { files: files.filter((f) => existsSync(cachePath(f))), bad };
}

// Run as a script (not imported by the runner or the test); as scripts/api.mjs does.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--update")) await update();
  else if ((await fetchAll()).bad.length) process.exitCode = 1;
}
