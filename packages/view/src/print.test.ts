import { describe, expect, it } from "vitest";
import { printStyles } from "./print.js";

describe("printStyles", () => {
  const a4 = { width: "210mm", height: "297mm" };

  it("gives one sheet of the page size per page, without named pages for one size", () => {
    const css = printStyles(".page", a4, [{ ...a4, index: 0 }], "x");
    expect(css).toBe(
      "@media print{@page{size:210mm 297mm;margin:0}.page{height:297mm!important;" +
        "margin-block:0!important;break-after:page;break-inside:avoid}" +
        ".page:last-child{break-after:auto}}",
    );
  });

  it("names a page for each setup when sizes differ", () => {
    const landscape = { width: "297mm", height: "210mm", index: 1 };
    const css = printStyles(".page", a4, [{ ...a4, index: 0 }, landscape], "x");
    expect(css).toContain("@page foli-x-1{size:297mm 210mm;margin:0}");
    expect(css).toContain('.page[data-foli-sheet="1"]{page:foli-x-1;height:210mm!important}');
    expect(css).toContain('.page[data-foli-sheet="0"]{page:foli-x-0;height:297mm!important}');
  });
});
