import { Editor } from "./Editor.jsx";

// A server component: the editor's shell is rendered on the server, the document on hydration.
export default function Page() {
  return (
    <main>
      <h1 style={{ font: "600 18px system-ui", margin: "12px 16px" }}>Foli with Next.js</h1>
      <Editor />
    </main>
  );
}
