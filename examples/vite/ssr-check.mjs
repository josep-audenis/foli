// Server rendering with React 18 and the installed packages: the markup is the editor's shell, and
// React logs nothing (React 18 warns about layout effects during server rendering).
import { createDocument } from "@foli/core";
import { FoliEditor } from "@foli/react";
import { createElement, version } from "react";
import { renderToString } from "react-dom/server";

const logged = [];
for (const level of ["error", "warn"]) {
  console[level] = (...args) => logged.push(`${level}: ${args.join(" ")}`);
}
const html = renderToString(createElement(FoliEditor, { initialContent: createDocument() }));
const problems = [
  ...logged,
  ...['role="toolbar"', 'role="textbox"', 'aria-label="Document"']
    .filter((part) => !html.includes(part))
    .map((part) => `missing ${part}`),
];
if (problems.length) {
  process.stderr.write(`SSR check failed (React ${version}):\n${problems.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`SSR check passed (React ${version})\n`);
