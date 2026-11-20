/**
 * The docs site's pages, in nav order (`build.ts` renders them at build time). A page is a
 * markdown file of the repository, an API report, the changelogs, or a live example
 * (`src/examples/<name>.md` beside `<name>.tsx`); a package's README is the guide
 * `/docs/guides/<package>/`. Adding a page: add the file, then one entry here.
 */
export type Entry =
  /** `title` in place of the file's first heading (a package README's is its package name). */
  | { md: string; title?: string }
  | { api: "core" | "view" | "react" | "docx" | "pdf" }
  | { changelog: true }
  | { example: string };

export interface Group {
  title: string;
  entries: Entry[];
}

export const NAV: Group[] = [
  { title: "Start", entries: [{ md: "docs/getting-started.md" }, { md: "docs/limitations.md" }] },
  {
    title: "Guides",
    entries: [
      { md: "docs/styling.md" },
      { md: "docs/guides/theming.md" },
      { md: "docs/guides/extensions.md" },
      { md: "docs/keyboard.md" },
      { md: "docs/document-model.md" },
      { md: "docs/pagination.md" },
      { md: "packages/docx/README.md", title: "DOCX" },
      { md: "packages/pdf/README.md", title: "PDF" },
      { md: "docs/guides/migrating-from-0x.md" },
    ],
  },
  {
    title: "Examples",
    entries: [{ example: "editor" }, { example: "custom-node" }, { example: "plugin" }],
  },
  {
    title: "Reference",
    entries: [
      { md: "docs/api.md" },
      { md: "docs/deprecation.md" },
      { api: "react" },
      { api: "core" },
      { api: "view" },
      { api: "docx" },
      { api: "pdf" },
      { changelog: true },
    ],
  },
  {
    title: "Project",
    entries: [
      { md: "docs/architecture.md" },
      { md: "docs/contributing.md" },
      { md: "docs/security.md" },
      { md: "docs/benchmarks.md" },
      { md: "docs/roadmap.md" },
      { md: "docs/testing/ime.md" },
      { md: "docs/testing/visual-regression.md" },
    ],
  },
  {
    title: "Decisions",
    entries: [
      { md: "docs/decisions/ADR-0001-editor-foundation.md" },
      { md: "docs/decisions/ADR-0002-own-editing-engine.md" },
      { md: "docs/decisions/ADR-0003-rendering-and-input.md" },
      { md: "docs/decisions/ADR-0004-nested-blocks-on-pages.md" },
      { md: "docs/decisions/ADR-0005-word-compatible-model.md" },
      { md: "docs/decisions/ADR-0006-tables-and-pictures.md" },
      { md: "docs/decisions/ADR-0007-stories-fields-controls.md" },
      { md: "docs/decisions/ADR-0008-1.0-contract-and-extensions.md" },
    ],
  },
];
