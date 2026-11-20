import { FoliEditor } from "@folijs/react";
import "@folijs/react/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { sample } from "../sample.js";

// `sample` is a document saved as JSON (schema v2, migrated on load): a heading, text, a list.
createRoot(document.getElementById("example") as HTMLElement).render(
  <StrictMode>
    <FoliEditor initialContent={sample} label="Example document" />
  </StrictMode>,
);
