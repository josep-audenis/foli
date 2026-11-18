import "../site.css";
import "../landing.css";
import { mountHero } from "./hero.js";
import { mountReview } from "./review.js";
import { mountCopy, mountKeystroke, mountRoundTrip, mountTable } from "./scenes.js";

const scenes: [string, (root: HTMLElement) => void][] = [
  ["#pages", mountHero],
  ["#review", mountReview],
  ["#tables", mountTable],
  ["#docx", mountRoundTrip],
  ["#engine", mountKeystroke],
];

for (const [selector, mount] of scenes) {
  const root = document.querySelector<HTMLElement>(selector);
  if (root) mount(root);
}
mountCopy();
