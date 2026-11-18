import { setFontFamily } from "@folijs/core";
import type { PackageImages } from "@folijs/docx";
import { FoliEditor, type FoliEditorHandle, type FoliEditorProps } from "@folijs/react";
import "@folijs/react/styles.css";
import { type ChangeEvent, StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./site.css";
import { sample } from "./sample.js";

/** Word's status bar: page count and word count, read from the rendered pages. */
function useStatus(host: React.RefObject<HTMLDivElement | null>) {
  const [status, setStatus] = useState({ pages: 0, words: 0 });
  const update = useCallback(() => {
    // After the view has laid out the change; a timeout, not rAF, so a background tab updates too.
    setTimeout(() => {
      const el = host.current;
      if (!el) return;
      const text = el.querySelector(".foli-content")?.textContent ?? "";
      setStatus({
        pages: el.querySelectorAll(".foli-page").length,
        words: text.split(/\s+/).filter(Boolean).length,
      });
    });
  }, [host]);
  return [status, update] as const;
}

/**
 * Sets the sample in Caladea, the metric twin of Cambria the site is set in, then clears the
 * undo history so Undo does not take the font back off.
 */
const styled = new WeakSet<object>();
function setSampleFont(handle: FoliEditorHandle | null) {
  if (!handle || styled.has(handle.editor)) return;
  styled.add(handle.editor);
  const { editor } = handle;
  editor.commands.selectAll();
  editor.run(setFontFamily("Caladea"));
  editor.setDocument(editor.getDocument());
}

const SAMPLE_NAME = "On pages.docx";

function Demo() {
  const host = useRef<HTMLDivElement>(null);
  // The latest open or reset: an import that finishes after a newer one is dropped.
  const request = useRef(0);
  const editorRef = useRef<FoliEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const images = useRef<PackageImages | null>(null);
  const [key, setKey] = useState(0);
  const [name, setName] = useState(SAMPLE_NAME);
  const [error, setError] = useState("");
  const [status, update] = useStatus(host);
  // Stable, so FoliEditor's imperative handle is not rebuilt on every status update.
  const attach = useCallback((handle: FoliEditorHandle | null) => {
    editorRef.current = handle;
    setSampleFont(handle);
  }, []);

  // An opened file shows only images it contains: one linked from the web stays a box, unfetched.
  const resource = useCallback<NonNullable<FoliEditorProps["resource"]>>(
    (key, entry) => (images.current ? (images.current.url(key, entry) ?? null) : undefined),
    [],
  );

  // Pages appear after the first layout; web fonts loading later re-flow them.
  useEffect(() => {
    update();
    const timer = setTimeout(update, 400);
    document.fonts?.ready.then(update);
    return () => clearTimeout(timer);
  }, [update]);

  async function open(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const id = ++request.current;
    setError("");
    let docx: typeof import("@folijs/docx");
    try {
      docx = await import("@folijs/docx");
    } catch (cause) {
      console.warn(cause);
      if (id === request.current)
        setError("Could not load the .docx reader. Check your connection and try again.");
      return;
    }
    try {
      const imported = await docx.importDocx(new Uint8Array(await file.arrayBuffer()));
      if (id !== request.current) return;
      const previous = images.current;
      const next = docx.packageImages(imported.package);
      images.current = next;
      try {
        editorRef.current?.editor.setDocument(imported.document);
      } catch (cause) {
        images.current = previous;
        next.revoke();
        throw cause;
      }
      previous?.revoke();
      setName(file.name);
      update();
    } catch (cause) {
      console.warn(cause);
      if (id === request.current)
        setError(`Could not open ${file.name}: it is not a .docx Foli can read.`);
    }
  }

  function reset() {
    request.current++;
    images.current?.revoke();
    images.current = null;
    setName(SAMPLE_NAME);
    setError("");
    setKey((k) => k + 1);
    setTimeout(update, 400);
  }

  return (
    <div className="demo-frame" ref={host}>
      <div className="demo-titlebar">
        <span className="demo-file">{name}</span>
        <span className="demo-actions">
          <button type="button" className="demo-link" onClick={() => fileRef.current?.click()}>
            Open your own .docx
          </button>
          <button type="button" className="demo-link" onClick={reset}>
            Reset
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            hidden
            onChange={open}
          />
        </span>
      </div>
      <FoliEditor
        key={key}
        ref={attach}
        initialContent={sample}
        author="You"
        resource={resource}
        onChange={update}
        className="demo-canvas"
      />
      <div className="demo-status">
        <span>
          {status.pages} {status.pages === 1 ? "page" : "pages"}
        </span>
        <span>{status.words} words</span>
        {name === SAMPLE_NAME && <span className="demo-status-size">A6 · 105 × 148 mm</span>}
        <span className="demo-error" role="alert">
          {error}
        </span>
      </div>
    </div>
  );
}

const mount = document.getElementById("demo");
if (mount) {
  createRoot(mount).render(
    <StrictMode>
      <Demo />
    </StrictMode>,
  );
}

// Copy buttons for install commands and code samples.
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  button.addEventListener("click", async () => {
    const source = document.getElementById(button.dataset.copy ?? "");
    const text = source?.textContent?.trim() ?? "";
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      if (source) getSelection()?.selectAllChildren(source);
      button.textContent = "Selected";
    }
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1600);
  });
}
