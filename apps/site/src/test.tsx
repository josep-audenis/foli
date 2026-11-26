import { type EditorDocument, wordKeymap } from "@folijs/core";
import type { DocxPackage, PackageImages } from "@folijs/docx";
import {
  FoliEditor,
  type FoliEditorHandle,
  type FoliEditorProps,
  wordRibbonTabs,
} from "@folijs/react";
import "@folijs/react/styles.css";
import { type ChangeEvent, StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import sampleUrl from "../../../corpus/word/02-services-agreement-redlined.docx?url";
import { sample } from "./sample.js";
import "./site.css";
import "./test.css";

const SAMPLE_NAME = "services-agreement-redlined.docx";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface Opened {
  id: number;
  name: string;
  document: EditorDocument;
  pkg?: DocxPackage;
  trackChanges: boolean;
}

/** Word's keys for what Foli's default keymap gives to something else (Shift+F3, Ctrl+Shift+8…). */
const PLUGINS = [wordKeymap()];

type Theme = "system" | "light" | "dark";
const THEME_KEY = "foli-try-theme";

/** The reader's theme, kept in this browser (storage may be blocked: then Word's light). */
function keptTheme(): Theme {
  try {
    const kept = localStorage.getItem(THEME_KEY);
    return kept === "system" || kept === "dark" ? kept : "light";
  } catch {
    return "light";
  }
}

/** Light (Word's look) unless the reader picked otherwise; the page's head applied it first. */
function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(keptTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not kept: the choice lasts while the page is open.
    }
  }, [theme]);
  return [theme, setTheme];
}

function Try() {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<FoliEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  // The latest open or reset: an import that finishes after a newer one is dropped.
  const request = useRef(0);
  const images = useRef<PackageImages | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState<{ same: number; total: number; changed: string[] } | null>(
    null,
  );
  const [theme, setTheme] = useTheme();

  // An opened file shows only images it contains: one linked from the web stays a box, unfetched.
  const resource = useCallback<NonNullable<FoliEditorProps["resource"]>>(
    (key, entry) => (images.current ? (images.current.url(key, entry) ?? null) : undefined),
    [],
  );

  const load = useCallback(async (name: string, read: () => Promise<ArrayBuffer>) => {
    const id = ++request.current;
    setMessage("");
    setSaved(null);
    const docx = await import("@folijs/docx");
    const imported = await docx.importDocx(new Uint8Array(await read()));
    if (id !== request.current) return;
    const previous = images.current;
    images.current = docx.packageImages(imported.package);
    setOpened({
      id,
      name,
      document: imported.document,
      pkg: imported.package,
      trackChanges: imported.trackRevisions,
    });
    // After the editor showing the previous file's pictures has gone.
    setTimeout(() => previous?.revoke(), 0);
  }, []);

  const openSample = useCallback(async () => {
    try {
      await load(SAMPLE_NAME, async () => {
        const response = await fetch(sampleUrl);
        if (!response.ok) throw new Error(`The sample answered ${response.status}`);
        return response.arrayBuffer();
      });
    } catch (cause) {
      console.warn(cause);
      images.current?.revoke();
      images.current = null;
      setOpened({ id: ++request.current, name: "On pages", document: sample, trackChanges: false });
    }
  }, [load]);

  useEffect(() => {
    void openSample();
  }, [openSample]);

  async function open(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await load(file.name, () => file.arrayBuffer());
    } catch (cause) {
      console.warn(cause);
      setMessage(`Could not open ${file.name}. It is not a .docx Foli can read.`);
    }
  }

  async function save() {
    const editor = editorRef.current?.editor;
    if (!editor || !opened) return;
    setMessage("");
    try {
      const { exportDocx, readPackage } = await import("@folijs/docx");
      const bytes = await exportDocx(editor.getDocument(), opened.pkg, {
        trackRevisions: editor.trackingChanges,
      });
      const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_TYPE }));
      const link = document.createElement("a");
      link.href = url;
      link.download = opened.name.endsWith(".docx") ? opened.name : `${opened.name}.docx`;
      link.click();
      // Revoked once the download has started (at once, Firefox and Safari may cancel it).
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (opened.pkg) {
        const before = new Map(opened.pkg.parts.map((part) => [part.name, part.data]));
        const after = (await readPackage(bytes)).parts;
        const changed = after.filter((part) => {
          const old = before.get(part.name);
          return old?.length !== part.data.length || !old.every((b, i) => b === part.data[i]);
        });
        setSaved({
          same: after.length - changed.length,
          total: after.length,
          changed: changed.map((part) => part.name.replace(/^\//, "")),
        });
      } else {
        setMessage(`Saved ${link.download}.`);
      }
    } catch (cause) {
      console.warn(cause);
      setMessage("Could not save this document as .docx.");
    }
  }

  return (
    <div className="try-app" ref={host}>
      <header className="try-bar">
        <a className="brand" href="/" aria-label="Foli home">
          <svg className="brand-mark" viewBox="0 0 28 32" aria-hidden="true">
            <path className="brand-back" d="M7 1h15v24H7z" />
            <path className="brand-front" d="M2 6h12l5 5v20H2z" />
            <path className="brand-fold" d="M14 6v5h5" />
          </svg>
          <span className="brand-name">Foli</span>
        </a>
        <span className="try-file">{opened?.name ?? "Opening the sample…"}</span>
        {opened?.name === SAMPLE_NAME && (
          <span className="try-guide">
            Try this: accept both edits in clause 2.1, save, then open the file in Word.
          </span>
        )}
        <span className="try-actions">
          <label className="try-theme">
            <span className="try-theme-label">Theme</span>
            <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </label>
          <button type="button" className="try-link" onClick={openSample}>
            Reset
          </button>
          <button type="button" className="button" onClick={() => fileRef.current?.click()}>
            Open .docx
          </button>
          <button
            ref={saveRef}
            type="button"
            className="button button-primary"
            onClick={save}
            disabled={!opened}
          >
            Save .docx
          </button>
          <input
            ref={fileRef}
            type="file"
            aria-label="Open a .docx file"
            accept={`.docx,${DOCX_TYPE}`}
            hidden
            onChange={open}
          />
        </span>
      </header>
      {saved && (
        <aside className="try-result" role="status">
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setSaved(null);
              saveRef.current?.focus();
            }}
          >
            ×
          </button>
          <strong>
            {saved.same} of {saved.total} parts byte-identical
          </strong>
          <span>
            {saved.changed.length === 0
              ? "Nothing in the file changed."
              : `Only ${saved.changed.slice(0, 3).join(", ")}${saved.changed.length > 3 ? ` and ${saved.changed.length - 3} more` : ""} changed.`}
          </span>
        </aside>
      )}
      <main className="try-main">
        {opened ? (
          <FoliEditor
            key={opened.id}
            ref={editorRef}
            initialContent={opened.document}
            trackChanges={opened.trackChanges}
            author="You"
            resource={resource}
            className="try-canvas"
            toolbar={wordRibbonTabs}
            toolbarProps={{ overflow: "menu" }}
            plugins={PLUGINS}
            statusBar
            contextMenu
            miniToolbar
          />
        ) : (
          <div className="try-loading" role="status">
            Opening a redlined services agreement…
          </div>
        )}
      </main>
      <footer className="try-status">
        <span className="try-message" role="status">
          {message}
        </span>
        <span className="try-private">Built from main · Your files stay in this browser</span>
      </footer>
    </div>
  );
}

const mount = document.getElementById("try");
if (mount) {
  createRoot(mount).render(
    <StrictMode>
      <Try />
    </StrictMode>,
  );
}
