/**
 * The docs site, rendered at build time from the repository's markdown (`docs/`, each package's
 * CHANGELOG.md) and API reports (12.2), so the pages are the files and cannot drift. `vite.config.ts`
 * calls `buildDocs` before Vite starts, which writes `apps/site/docs/**\/index.html` (git-ignored)
 * and `docs/search.json`; Vite then builds them as pages. Runs in Node only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { Marked, type Token, type Tokens } from "marked";
import { type Entry, NAV } from "./nav.js";

export const GITHUB = "https://github.com/josep-audenis/foli/blob/main/";
const RAW = "https://raw.githubusercontent.com/josep-audenis/foli/main/";

interface Heading {
  depth: number;
  text: string;
  id: string;
}

interface Page {
  url: string;
  title: string;
  /** The repository file the page is made from (its "source" link). */
  source: string;
  entry: Entry;
}

/** A link to another page of the site, checked once every page is rendered. */
interface Anchor {
  from: string;
  url: string;
  hash: string;
}

/** What a render collects: the headings (ids) and the links into the site. */
interface Context {
  /** The repository path the markdown comes from, for relative links. */
  from: string;
  url: string;
  urls: ReadonlyMap<string, string>;
  headings: Heading[];
  anchors: Anchor[];
  seen: Map<string, number>;
  /** Added to heading levels (a changelog's `#` becomes `##`). */
  shift?: number;
  /** Put before heading ids, so pages joined into one keep them apart. */
  prefix?: string;
}

const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** The heading's text without markup. */
const plain = (tokens: readonly Token[]): string =>
  tokens
    .map((t) =>
      t.type === "html"
        ? ""
        : "tokens" in t && t.tokens
          ? plain(t.tokens)
          : "text" in t
            ? String(t.text)
            : "",
    )
    .join("");

/** GitHub's heading ids (github-slugger), so `file.md#heading` links work here as there. */
export function slug(text: string, seen: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

/** The repository path a relative URL written in `from` names. */
function repoPath(path: string, from: string): string {
  try {
    return posix.normalize(posix.join(posix.dirname(from), decodeURI(path)));
  } catch (error) {
    throw new Error(`Docs: ${from} links to a malformed URL, ${path}`, { cause: error });
  }
}

/** Only these schemes are links; `javascript:`, `data:` and the rest are shown as text. */
const SAFE = /^(https?:|mailto:)/i;
const SCHEME = /^([a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * A link as written in `from`: into the site when it names a page, else to the file on GitHub;
 * null for a scheme other than http, https and mailto.
 */
export function resolveLink(
  href: string,
  from: string,
  urls: ReadonlyMap<string, string>,
): { href: string; page?: string; hash: string } | null {
  if (SCHEME.test(href)) return SAFE.test(href) ? { href, hash: "" } : null;
  const at = href.indexOf("#");
  const path = at < 0 ? href : href.slice(0, at);
  const hash = at < 0 ? "" : href.slice(at + 1);
  if (!path) return { href, hash };
  const target = repoPath(path, from);
  const page = urls.get(target);
  if (page) return { href: page + (hash ? `#${hash}` : ""), page, hash };
  return { href: GITHUB + encodeURI(target) + (hash ? `#${hash}` : ""), hash };
}

/** An image's URL: http(s) as it is, a relative path to the file on GitHub; else null. */
export function resolveImage(href: string, from: string): string | null {
  if (SCHEME.test(href)) return /^https?:/i.test(href) ? href : null;
  return RAW + encodeURI(repoPath(href, from));
}

/** Markdown to HTML: GitHub's heading ids, links resolved, raw HTML shown as text. */
export function markdown(source: string, ctx: Context): string {
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = plain(tokens);
        const id = (ctx.prefix ?? "") + slug(text, ctx.seen);
        const level = Math.min(6, depth + (ctx.shift ?? 0));
        ctx.headings.push({ depth: level, text, id });
        return `<h${level} id="${esc(id)}">${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const link = resolveLink(href, ctx.from, ctx.urls);
        if (!link) return this.parser.parseInline(tokens);
        if (link.page) ctx.anchors.push({ from: ctx.url, url: link.page, hash: link.hash });
        else if (href.startsWith("#"))
          ctx.anchors.push({ from: ctx.url, url: ctx.url, hash: link.hash });
        const t = title ? ` title="${esc(title)}"` : "";
        return `<a href="${esc(link.href)}"${t}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const src = resolveImage(href, ctx.from);
        if (!src) return esc(text);
        const t = title ? ` title="${esc(title)}"` : "";
        return `<img src="${esc(src)}" alt="${esc(text)}"${t} />`;
      },
      html: ({ text }: Tokens.HTML | Tokens.Tag) => esc(text),
    },
  });
  return marked.parse(source, { async: false }) as string;
}

/** A wide table scrolls in its own box: focusable, so the keyboard can scroll it, and numbered. */
function boxTables(html: string): string {
  let n = 0;
  return html
    .replace(
      /<table>/g,
      () => `<div class="table" tabindex="0" role="region" aria-label="Table ${++n}"><table>`,
    )
    .replace(/<\/table>/g, "</table></div>");
}

/** A top-level declaration of an API report. */
export interface Declaration {
  name: string;
  file: string;
  doc: string;
  code: string;
}

const DECLARES =
  /^(?:export )?(?:declare )?(?:abstract )?(?:function|class|const|let|var|interface|type|enum|namespace) ([\w$]+)/;

/**
 * An API report split into its declarations (each with its doc comment) and the names each
 * entry (`index.d.ts`, `internal.d.ts`) lists. A declaration starts at column 0; indented lines
 * and lines starting with a closing bracket or an operator continue it.
 */
export function parseReport(report: string): {
  declarations: Declaration[];
  entries: Map<string, string[]>;
} {
  const declarations: Declaration[] = [];
  const entries = new Map<string, string[]>();
  let file = "";
  let chunk: string[] = [];
  const flush = () => {
    const lines = chunk;
    chunk = [];
    const end = lines[0]?.startsWith("/**") ? lines.findIndex((l) => l.includes("*/")) + 1 : 0;
    const code = lines.slice(end).join("\n").trim();
    if (!code || code.startsWith("import ") || code === "export {};") return;
    const listed = /^export (?:type )?\{([^}]*)\}/.exec(code);
    if (listed?.[1] !== undefined) {
      if (file === "index.d.ts" || file === "internal.d.ts") {
        const names = entries.get(file) ?? [];
        for (const spec of listed[1].split(",")) {
          const name = spec
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)
            .pop();
          if (name) names.push(name);
        }
        entries.set(file, names);
      }
      return;
    }
    const doc = lines
      .slice(0, end)
      .join("\n")
      .replace(/^\s*\/\*\*\s?|\s*\*\/\s*$/g, "")
      .replace(/^\s*\* ?/gm, "")
      .trim();
    const name = DECLARES.exec(code)?.[1] ?? code.split("\n")[0] ?? "";
    const last = declarations.at(-1);
    // Overloads: one entry, every signature.
    if (last && last.name === name && last.file === file) last.code += `\n${code}`;
    else declarations.push({ name, file, doc, code });
  };
  // The chunk so far is one whole doc comment: the next line is what it documents.
  const docOnly = () =>
    chunk[0]?.startsWith("/**") && chunk.findIndex((l) => l.includes("*/")) === chunk.length - 1;
  for (const line of report.replace(/\r\n/g, "\n").split("\n")) {
    const section = /^\/\/ (\S+\.d\.ts)$/.exec(line);
    if (section?.[1]) {
      flush();
      file = section[1];
      continue;
    }
    if (!file) continue;
    if (/^[A-Za-z/]/.test(line) && !docOnly()) flush();
    if (line || chunk.length) chunk.push(line);
  }
  flush();
  return { declarations, entries };
}

/** A package's API page: the names each entry exports, then every declaration by file. */
function apiPage(pkg: string, ctx: Context, root: string): string {
  const name = `@folijs/${pkg}`;
  const reportPath = `packages/${pkg}/api-report.d.ts`;
  const { declarations, entries } = parseReport(readFileSync(join(root, reportPath), "utf8"));
  const ids = new Map<string, string>();
  for (const d of declarations) if (!ids.has(d.name)) ids.set(d.name, slugId(d.name, ctx));
  const publicNames = new Set(entries.get("index.d.ts"));
  const internalNames = new Set(entries.get("internal.d.ts"));
  const out: string[] = [
    `<h1 id="top">${esc(name)}</h1>`,
    markdown(
      `Every published type of \`${name}\`, from its API report [\`${reportPath}\`](../../${reportPath}) (the built \`.d.ts\` files, checked by \`pnpm api\`). What each name does and what is stable: [API reference](../../docs/api.md).`,
      ctx,
    ),
  ];
  for (const [file, entry] of [
    ["index.d.ts", name],
    ["internal.d.ts", `${name}/internal`],
  ]) {
    const names = entries.get(file ?? "");
    if (!names || !entry) continue;
    const id = slugId(`entry ${entry}`, ctx);
    ctx.headings.push({ depth: 2, text: `Exports of ${entry}`, id });
    out.push(
      `<h2 id="${id}">Exports of <code>${esc(entry)}</code></h2>`,
      file === "internal.d.ts"
        ? "<p>For the other Foli packages, with no promise: any release may change them.</p>"
        : "",
      `<ul class="api-index">${[...names]
        .sort((a, b) => a.localeCompare(b, "en"))
        .map((n) => {
          const target = ids.get(n);
          return `<li>${target ? `<a href="#${target}"><code>${esc(n)}</code></a>` : `<code>${esc(n)}</code>`}</li>`;
        })
        .join("")}</ul>`,
    );
  }
  let file = "";
  const placed = new Set<string>();
  for (const d of declarations) {
    if (d.file !== file) {
      file = d.file;
      const id = slugId(`file ${file}`, ctx);
      out.push(`<h2 id="${id}" class="api-file"><code>${esc(file)}</code></h2>`);
    }
    const id = placed.has(d.name) ? slugId(d.name, ctx) : (ids.get(d.name) ?? slugId(d.name, ctx));
    placed.add(d.name);
    ctx.headings.push({ depth: 3, text: d.name, id });
    const tag = publicNames.has(d.name)
      ? ""
      : internalNames.has(d.name)
        ? ' <span class="api-tag">internal</span>'
        : ' <span class="api-tag">not exported</span>';
    out.push(
      `<section class="api-decl"><h3 id="${id}"><code>${esc(d.name)}</code>${tag}</h3>`,
      d.doc ? markdown(d.doc, { ...ctx, headings: [] }) : "",
      `<pre><code>${esc(d.code)}</code></pre></section>`,
    );
  }
  return out.join("\n");
}

/** A heading id for generated headings, unique on the page. */
function slugId(text: string, ctx: Context): string {
  return slug(text, ctx.seen);
}

function pages(root: string): Page[] {
  const title = (md: string) => {
    const h1 = /^# (.+)$/m.exec(readFileSync(join(root, md), "utf8"))?.[1] ?? md;
    return h1.replace(/`/g, "");
  };
  return NAV.flatMap((group) =>
    group.entries.map((entry): Page => {
      if ("md" in entry) {
        const rel = entry.md.replace(/^docs\//, "").replace(/\.md$/, "");
        const url = rel === "getting-started" ? "/docs/" : `/docs/${rel}/`;
        return { url, title: title(entry.md), source: entry.md, entry };
      }
      if ("api" in entry)
        return {
          url: `/docs/api/${entry.api}/`,
          title: `@folijs/${entry.api}`,
          source: `packages/${entry.api}/api-report.d.ts`,
          entry,
        };
      if ("changelog" in entry)
        return {
          url: "/docs/changelog/",
          title: "Changelog",
          source: "packages/core/CHANGELOG.md",
          entry,
        };
      const md = `apps/site/src/examples/${entry.example}.md`;
      return { url: `/docs/examples/${entry.example}/`, title: title(md), source: md, entry };
    }),
  );
}

const PACKAGES = ["core", "view", "react", "docx", "pdf"] as const;

function body(page: Page, ctx: Context, root: string): string {
  const { entry } = page;
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  if ("md" in entry) return markdown(read(entry.md), ctx);
  if ("api" in entry) return apiPage(entry.api, ctx, root);
  if ("changelog" in entry) {
    const parts = PACKAGES.map((pkg) => {
      const path = `packages/${pkg}/CHANGELOG.md`;
      return markdown(read(path), { ...ctx, from: path, shift: 1, prefix: `${pkg}-` });
    });
    const intro = markdown(
      "Each package's `CHANGELOG.md`, written by Changesets at each release. The packages share one version.",
      ctx,
    );
    return `<h1 id="changelog">Changelog</h1>\n${intro}\n${parts.join("\n")}`;
  }
  const md = markdown(read(page.source), ctx);
  const script = `apps/site/src/examples/${entry.example}.tsx`;
  return `${md}
<div class="example" id="example" data-example="${esc(entry.example)}"><noscript>The example needs JavaScript.</noscript></div>
<h2 id="source">Source</h2>
<p><a href="${GITHUB}${script}"><code>${esc(script)}</code></a>, the code running above:</p>
<pre><code>${esc(read(script))}</code></pre>`;
}

const BRAND = `<svg class="brand-mark" viewBox="0 0 28 32" aria-hidden="true"><path class="brand-back" d="M7 1h15v24H7z" /><path class="brand-front" d="M2 6h12l5 5v20H2z" /><path class="brand-fold" d="M14 6v5h5" /></svg>`;

function nav(current: Page, all: Page[]): string {
  let i = 0;
  const groups = NAV.map((group) => {
    const items = group.entries.map(() => {
      const page = all[i++] as Page;
      const here = page === current ? ' aria-current="page"' : "";
      return `<li><a href="${page.url}"${here}>${esc(page.title)}</a></li>`;
    });
    return `<h2>${esc(group.title)}</h2><ul>${items.join("")}</ul>`;
  });
  return groups.join("");
}

function shell(page: Page, all: Page[], content: string): string {
  const script =
    "example" in page.entry
      ? `<script type="module" src="/src/examples/${page.entry.example}.tsx"></script>`
      : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(page.title)} · Foli docs</title>
    <meta name="theme-color" content="#f3f3f1" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caladea:ital,wght@0,400;0,700;1,400;1,700&family=Carlito:ital,wght@0,400;0,700;1,400&family=Cousine:wght@400;700&display=swap" />
    <script type="module" src="/src/docs/main.ts"></script>
    ${script}
  </head>
  <body class="docs">
    <a class="skip" href="#main">Skip to content</a>
    <header class="masthead">
      <div class="wrap-wide masthead-row">
        <a class="brand" href="/" aria-label="Foli home">${BRAND}<span class="brand-name">Foli</span></a>
        <nav class="nav" aria-label="Main">
          <a href="/docs/">Docs</a>
          <a href="/docs/api/">API</a>
          <a class="nav-gh" href="https://github.com/josep-audenis/foli">GitHub</a>
          <a class="nav-try" href="/test/">Try the editor</a>
        </nav>
      </div>
    </header>
    <div class="docs-layout wrap-wide">
      <details class="docs-nav" open>
        <summary>Contents</summary>
        <nav aria-label="Documentation">
          <form class="docs-search" role="search" action="#" data-search>
            <label for="docs-search">Search the docs</label>
            <input id="docs-search" type="search" autocomplete="off" placeholder="Headings and API names" />
            <p class="docs-search-status" role="status" data-search-status></p>
            <ul class="docs-search-results" data-search-results></ul>
          </form>
          ${nav(page, all)}
        </nav>
      </details>
      <main id="main" class="docs-main" tabindex="-1">
        <article class="prose">
${content}
        </article>
        <p class="docs-source">Made from <a href="${GITHUB}${encodeURI(page.source)}"><code>${esc(page.source)}</code></a>.</p>
      </main>
    </div>
  </body>
</html>
`;
}

/**
 * Writes every page of `NAV` under `out` (`/docs/x/` → `out/x/index.html`) and the search index
 * (`out/search.json`: headings and API names). Throws on a link to a heading that is not there.
 * Returns the HTML files written, for Vite's inputs.
 */
export function buildDocs(root: string, out: string): string[] {
  const all = pages(root);
  const urls = new Map<string, string>();
  for (const page of all) if ("md" in page.entry) urls.set(page.entry.md, page.url);
  const rendered = all.map((page) => {
    const ctx: Context = {
      from: page.source,
      url: page.url,
      urls,
      headings: [],
      anchors: [],
      seen: new Map(),
    };
    return { page, ctx, html: boxTables(body(page, ctx, root)) };
  });
  const ids = new Map(rendered.map((r) => [r.page.url, new Set(r.ctx.headings.map((h) => h.id))]));
  const broken = rendered
    .flatMap((r) => r.ctx.anchors)
    .filter((a) => a.hash && !ids.get(a.url)?.has(a.hash))
    .map((a) => `${a.from} → ${a.url}#${a.hash}`);
  if (broken.length) throw new Error(`Docs: links to missing headings:\n${broken.join("\n")}`);

  // Only changed files are written: a dev server reloads its pages on every write.
  // shortcut: a page dropped from the nav stays in `out` until deleted (never built: not an input).
  const write = (file: string, text: string) => {
    if (existsSync(file) && readFileSync(file, "utf8") === text) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const files: string[] = [];
  for (const { page, html } of rendered) {
    const file = join(out, page.url.replace(/^\/docs\/?/, ""), "index.html");
    write(file, shell(page, all, html));
    files.push(file);
  }
  const search = rendered.flatMap(({ page, ctx }) =>
    ctx.headings
      .filter((h) => h.depth <= 3)
      .map((h) => ({ t: h.text, u: `${page.url}#${h.id}`, p: page.title })),
  );
  write(join(out, "search.json"), JSON.stringify(search));
  return files;
}
