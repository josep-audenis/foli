// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { imagesLoaded } from "./renderer.js";

/** An image in the page whose decoding never ends, or ends at once. */
function image(hangs: boolean): HTMLImageElement {
  const element = document.createElement("img");
  element.src = "data:image/png;base64,AA==";
  Object.defineProperty(element, "complete", { value: false, configurable: true });
  element.decode = () =>
    hangs
      ? new Promise(() => {})
      : Promise.resolve().then(() => {
          Object.defineProperty(element, "complete", { value: true });
        });
  document.body.append(element);
  return element;
}

describe("imagesLoaded", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("gives up on an image that never loads: it prints without it, as its box", async () => {
    vi.useFakeTimers();
    const stuck = image(true);
    const fine = image(false);
    const done = imagesLoaded(document);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(stuck.hasAttribute("src")).toBe(false);
    expect(fine.hasAttribute("src")).toBe(true);
  });
});
