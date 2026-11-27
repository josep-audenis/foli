// @vitest-environment jsdom
import {
  createDocument,
  createEditor,
  type FoliDocument,
  type NodeJSON,
  parseDocument,
} from "@folijs/core";
import { describe, expect, it } from "vitest";
import { EditorView, renderDocument } from "../index.js";
import { FLOAT_ATTR, SHAPE_ATTR, TEXT_BOX_ATTR } from "./blocks.js";
import { drawPaths, evaluate, guides, textRect } from "./geometry.js";
import { PRESETS } from "./presets.js";
import { shapeSvg } from "./shapes.js";

/** Shapes drawn (34.2, ADR-0017). */

const shape = (attrs: Record<string, unknown> = {}): NodeJSON => ({
  type: "shape",
  attrs: { geometry: "rightArrow", width: 1_905_000, height: 952_500, fill: "4472C4", ...attrs },
});

function shaped(attrs: Record<string, unknown> = {}, text?: string): FoliDocument {
  return parseDocument({
    ...createDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Before " },
            shape(attrs),
            { type: "text", text: "After" },
          ],
        },
      ],
    }),
    schemaVersion: 11,
    ...(text
      ? {
          stories: {
            "textbox:1": {
              kind: "textBox",
              content: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              },
            },
          },
        }
      : {}),
  });
}

describe("DrawingML geometry (34.2)", () => {
  it("evaluates guide formulas as ECMA-376 defines them", () => {
    const values = new Map([
      ["w", 200],
      ["a", 25_000],
      ["neg", -1],
    ]);
    expect(evaluate("*/ w a 100000", values)).toBe(50);
    expect(evaluate("+- w 10 a", values)).toBe(200 + 10 - 25_000);
    expect(evaluate("+/ w 100 3", values)).toBe(100);
    expect(evaluate("?: neg 1 2", values)).toBe(2);
    expect(evaluate("pin 0 a 20000", values)).toBe(20_000);
    expect(evaluate("cos w 5400000", values)).toBeCloseTo(0, 6);
    expect(evaluate("sin w 5400000", values)).toBeCloseTo(200, 6);
    expect(evaluate("at2 0 1", values)).toBeCloseTo(5_400_000, 3);
    expect(evaluate("mod 3 4 0", values)).toBe(5);
    expect(evaluate("sqrt 16", values)).toBe(4);
    expect(evaluate("*/ w 1 0", values)).toBe(0);
    expect(evaluate("nonsense 1", values)).toBe(0);
  });

  it("knows the built-in guides and an adjust value over the default", () => {
    const def = PRESETS.roundRect;
    if (!def) throw new Error("no roundRect");
    const values = guides(def, 200, 100, { adj: 50_000 });
    expect(values.get("ss")).toBe(100);
    expect(values.get("hc")).toBe(100);
    expect(values.get("x1")).toBe(50);
    expect(guides(def, 200, 100).get("x1")).toBeCloseTo(16.667, 2);
  });

  it("draws every preset Foli knows as finite SVG path data", () => {
    expect(Object.keys(PRESETS).length).toBeGreaterThanOrEqual(45);
    for (const [name, def] of Object.entries(PRESETS)) {
      const paths = drawPaths(def, 120, 80);
      expect(paths.length, name).toBeGreaterThan(0);
      for (const { d } of paths) {
        expect(d, name).toMatch(/^M/);
        expect(d, name).not.toMatch(/NaN|Infinity/);
      }
      const [l, t, r, b] = textRect(def, 120, 80);
      expect(r >= l && b >= t, name).toBe(true);
    }
  });

  it("draws an arc from the current point, angles clockwise as seen", () => {
    // A circle of radius 50 from its leftmost point, half a turn clockwise: over the top.
    const [path] = drawPaths(
      {
        paths: [
          {
            commands: [
              { op: "M", args: ["0", "50"] },
              { op: "A", args: ["50", "50", "10800000", "10800000"] },
            ],
          },
        ],
      },
      100,
      100,
    );
    expect(path?.d).toBe("M0 50A50 50 0 0 1 100 50");
  });

  it("scales a path drawn in its own coordinates", () => {
    const [path] = drawPaths(
      {
        paths: [
          {
            width: 10,
            height: 10,
            commands: [
              { op: "M", args: ["0", "0"] },
              { op: "L", args: ["10", "5"] },
            ],
          },
        ],
      },
      200,
      100,
    );
    expect(path?.d).toBe("M0 0L200 50");
  });
});

describe("shapes drawn (34.2)", () => {
  it("draws a shape's geometry, fill, line, dash and ends as SVG", () => {
    const svg = shapeSvg(
      {
        geometry: "line",
        width: 952_500,
        height: 0,
        outline: {
          color: "FF0000",
          width: 19_050,
          dash: "dash",
          head: { type: "oval" },
          tail: { type: "triangle", width: "lg" },
        },
      },
      document,
    );
    // A line with no height is still drawn.
    expect(svg.getAttribute("height")).toBe("1");
    const stroke = svg.querySelector("g path") as SVGPathElement;
    expect(stroke.getAttribute("stroke")).toBe("#FF0000");
    expect(stroke.getAttribute("stroke-width")).toBe("2");
    expect(stroke.getAttribute("stroke-dasharray")).toBe("8 6");
    expect(stroke.getAttribute("marker-start")).toMatch(/^url\(#foli-shape-\d+-h\)$/);
    expect(svg.querySelectorAll("marker")).toHaveLength(2);
    expect(svg.querySelector("marker ellipse")).not.toBeNull();
  });

  it("fills with a gradient, shades a 3-D face, flips, and draws an unknown preset as its box", () => {
    const can = shapeSvg(
      {
        geometry: "can",
        width: 952_500,
        height: 952_500,
        gradient: {
          stops: [
            { position: 0, color: "FFFFFF" },
            { position: 100_000, color: "000000" },
          ],
          angle: 5_400_000,
        },
        flipH: true,
      },
      document,
    );
    expect(can.querySelector("linearGradient stop")?.getAttribute("stop-color")).toBe("#FFFFFF");
    expect(can.querySelector("g")?.getAttribute("transform")).toBe("translate(100 0) scale(-1 1)");
    // The can's top lightened over its fill.
    expect(can.querySelector('path[fill="#fff"]')?.getAttribute("fill-opacity")).toBe("0.4");
    const cloud = shapeSvg(
      { geometry: "cloud", width: 952_500, height: 476_250, fill: "00FF00" },
      document,
    );
    expect(cloud.querySelector("g path")?.getAttribute("d")).toBe("M0 0L100 0L100 50L0 50Z");
  });

  it("draws a shape where its paragraph is, turned, its text inside, on read-only pages", () => {
    const root = document.createElement("div");
    renderDocument(
      shaped({ rotation: 5_400_000, story: "textbox:1", textColor: "FFFFFF" }, "Go"),
      root,
    );
    const drawn = root.querySelector(`[${SHAPE_ATTR}]`) as HTMLElement;
    expect(drawn.getAttribute(SHAPE_ATTR)).toBe("rightArrow");
    expect(drawn.style.transform).toBe("rotate(90deg)");
    expect(drawn.style.width).toBe("200px");
    const text = drawn.querySelector(`[${TEXT_BOX_ATTR}="textbox:1"]`) as HTMLElement;
    expect(text.textContent).toBe("Go");
    expect(text.style.color).toBe("rgb(255, 255, 255)");
  });

  it("draws a floating shape in the editing view as a floating picture is placed", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView(
      host,
      createEditor({
        document: shaped({
          float: {
            horizontal: { relativeTo: "column", offset: 0 },
            vertical: { relativeTo: "paragraph", offset: 0 },
            wrap: "square",
          },
        }),
      }),
    );
    const drawn = host.querySelector(`[${SHAPE_ATTR}]`) as HTMLElement;
    expect(drawn.closest(`[${FLOAT_ATTR}]`)?.getAttribute(FLOAT_ATTR)).toBe("square");
    expect(drawn.getAttribute("role")).toBe("img");
    view.destroy();
    host.remove();
  });
});
