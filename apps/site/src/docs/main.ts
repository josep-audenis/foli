/**
 * The docs pages' script: the nav folded on narrow screens, and search over the headings and API
 * names the build indexed (`search.json`, fetched on first use). Results are built with
 * `textContent`, never HTML.
 */
import "../site.css";
import "./docs.css";
import searchUrl from "../../docs/search.json?url";

interface Hit {
  /** Heading or API name. */
  t: string;
  u: string;
  /** Page title. */
  p: string;
}

const details = document.querySelector<HTMLDetailsElement>(".docs-nav");
if (details && matchMedia("(max-width: 900px)").matches) details.open = false;

const form = document.querySelector<HTMLFormElement>("[data-search]");
const input = form?.querySelector("input");
const status = form?.querySelector<HTMLElement>("[data-search-status]");
const results = form?.querySelector<HTMLUListElement>("[data-search-results]");
let index: Promise<Hit[]> | undefined;

async function search(): Promise<void> {
  if (!input || !status || !results) return;
  const query = input.value.trim().toLowerCase();
  index ??= fetch(searchUrl).then((r) => r.json() as Promise<Hit[]>);
  const hits = query ? (await index).filter((h) => h.t.toLowerCase().includes(query)) : [];
  if (query !== input.value.trim().toLowerCase()) return; // a newer query is on its way
  // Names that start with the query first, then the shorter.
  hits.sort(
    (a, b) =>
      Number(!a.t.toLowerCase().startsWith(query)) - Number(!b.t.toLowerCase().startsWith(query)) ||
      a.t.length - b.t.length,
  );
  const shown = hits.slice(0, 20);
  results.replaceChildren(
    ...shown.map((hit) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = hit.u;
      a.textContent = hit.t;
      const page = document.createElement("span");
      page.textContent = hit.p;
      a.append(page);
      li.append(a);
      return li;
    }),
  );
  status.textContent = !query
    ? ""
    : hits.length > shown.length
      ? `${hits.length} results, the first ${shown.length} shown`
      : `${hits.length} ${hits.length === 1 ? "result" : "results"}`;
}

input?.addEventListener("input", () => void search());
form?.addEventListener("submit", (event) => {
  event.preventDefault();
  results?.querySelector("a")?.click();
});
