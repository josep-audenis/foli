import { createElement, type ReactElement } from "react";

// Generated from lucide-static 1.81.0: ISC, a few from Feather under MIT; the notices are in
// LICENSE-lucide (published with this package) and THIRD_PARTY_NOTICES.md.
// Each entry: the item's key, the Lucide icon's name, its shapes (24-unit grid, 2-unit stroke).
type Shape = readonly [tag: string, attrs: Readonly<Record<string, string>>];

const SHAPES: Readonly<Record<string, readonly Shape[]>> = {
  undo: /* undo-2 */ [
    ["path", { d: "M9 14 4 9l5-5" }],
    ["path", { d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" }],
  ],
  redo: /* redo-2 */ [
    ["path", { d: "m15 14 5-5-5-5" }],
    ["path", { d: "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" }],
  ],
  bold: /* bold */ [
    ["path", { d: "M6 12h9a4 4 0 010 8H7a1 1 0 01-1-1V5a1 1 0 011-1h7a4 4 0 010 8" }],
  ],
  italic: /* italic */ [
    ["line", { x1: "19", x2: "10", y1: "4", y2: "4" }],
    ["line", { x1: "14", x2: "5", y1: "20", y2: "20" }],
    ["line", { x1: "15", x2: "9", y1: "4", y2: "20" }],
  ],
  underline: /* underline */ [
    ["path", { d: "M6 4v6a6 6 0 0 0 12 0V4" }],
    ["line", { x1: "4", x2: "20", y1: "20", y2: "20" }],
  ],
  strike: /* strikethrough */ [
    ["path", { d: "M16 4H9a3 3 0 0 0-2.83 4" }],
    ["path", { d: "M14 12a4 4 0 0 1 0 8H6" }],
    ["line", { x1: "4", x2: "20", y1: "12", y2: "12" }],
  ],
  link: /* link */ [
    ["path", { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }],
    ["path", { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" }],
  ],
  textColor: /* baseline */ [
    ["path", { d: "M4 20h16" }],
    ["path", { d: "m6 16 6-12 6 12" }],
    ["path", { d: "M8 12h8" }],
  ],
  highlight: /* highlighter */ [
    ["path", { d: "m9 11-6 6v3h9l3-3" }],
    ["path", { d: "m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" }],
  ],
  "align-start": /* text-align-start */ [
    ["path", { d: "M21 5H3" }],
    ["path", { d: "M15 12H3" }],
    ["path", { d: "M17 19H3" }],
  ],
  "align-center": /* text-align-center */ [
    ["path", { d: "M21 5H3" }],
    ["path", { d: "M17 12H7" }],
    ["path", { d: "M19 19H5" }],
  ],
  "align-end": /* text-align-end */ [
    ["path", { d: "M21 5H3" }],
    ["path", { d: "M21 12H9" }],
    ["path", { d: "M21 19H7" }],
  ],
  "align-justify": /* text-align-justify */ [
    ["path", { d: "M3 5h18" }],
    ["path", { d: "M3 12h18" }],
    ["path", { d: "M3 19h18" }],
  ],
  bulletList: /* list */ [
    ["path", { d: "M3 5h.01" }],
    ["path", { d: "M3 12h.01" }],
    ["path", { d: "M3 19h.01" }],
    ["path", { d: "M8 5h13" }],
    ["path", { d: "M8 12h13" }],
    ["path", { d: "M8 19h13" }],
  ],
  orderedList: /* list-ordered */ [
    ["path", { d: "M11 5h10" }],
    ["path", { d: "M11 12h10" }],
    ["path", { d: "M11 19h10" }],
    ["path", { d: "M4 4h1v5" }],
    ["path", { d: "M4 9h2" }],
    ["path", { d: "M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" }],
  ],
  outdent: /* list-indent-decrease */ [
    ["path", { d: "M21 5H11" }],
    ["path", { d: "M21 12H11" }],
    ["path", { d: "M21 19H11" }],
    ["path", { d: "m7 8-4 4 4 4" }],
  ],
  indent: /* list-indent-increase */ [
    ["path", { d: "M21 5H11" }],
    ["path", { d: "M21 12H11" }],
    ["path", { d: "M21 19H11" }],
    ["path", { d: "m3 8 4 4-4 4" }],
  ],
  newComment: /* message-square-plus */ [
    [
      "path",
      {
        d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
      },
    ],
    ["path", { d: "M12 8v6" }],
    ["path", { d: "M9 11h6" }],
  ],
  trackChanges: /* file-pen-line */ [
    [
      "path",
      {
        d: "M14.364 13.634a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506l4.013-4.009a1 1 0 0 0-3.004-3.004z",
      },
    ],
    ["path", { d: "M14.487 7.858A1 1 0 0 1 14 7V2" }],
    [
      "path",
      {
        d: "M20 19.645V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l2.516 2.516",
      },
    ],
    ["path", { d: "M8 18h1" }],
  ],
  previousChange: /* chevron-left */ [["path", { d: "m15 18-6-6 6-6" }]],
  nextChange: /* chevron-right */ [["path", { d: "m9 18 6-6-6-6" }]],
  acceptChange: /* check */ [["path", { d: "M20 6 9 17l-5-5" }]],
  rejectChange: /* x */ [
    ["path", { d: "M18 6 6 18" }],
    ["path", { d: "m6 6 12 12" }],
  ],
  acceptAll: /* check-check */ [
    ["path", { d: "M18 6 7 17l-5-5" }],
    ["path", { d: "m22 10-7.5 7.5L13 16" }],
  ],
  rejectAll: /* circle-x */ [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "m15 9-6 6" }],
    ["path", { d: "m9 9 6 6" }],
  ],
  table: /* table */ [
    ["path", { d: "M12 3v18" }],
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M3 9h18" }],
    ["path", { d: "M3 15h18" }],
  ],
  cellShading: /* paint-bucket */ [
    ["path", { d: "M11 7 6 2" }],
    ["path", { d: "M18.992 12H2.041" }],
    [
      "path",
      {
        d: "M21.145 18.38A3.34 3.34 0 0 1 20 16.5a3.3 3.3 0 0 1-1.145 1.88c-.575.46-.855 1.02-.855 1.595A2 2 0 0 0 20 22a2 2 0 0 0 2-2.025c0-.58-.285-1.13-.855-1.595",
      },
    ],
    [
      "path",
      {
        d: "m8.5 4.5 2.148-2.148a1.205 1.205 0 0 1 1.704 0l7.296 7.296a1.205 1.205 0 0 1 0 1.704l-7.592 7.592a3.615 3.615 0 0 1-5.112 0l-3.888-3.888a3.615 3.615 0 0 1 0-5.112L5.67 7.33",
      },
    ],
  ],
  picture: /* image */ [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2" }],
    ["circle", { cx: "9", cy: "9", r: "2" }],
    ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }],
  ],
  pageBreak: /* separator-horizontal */ [
    ["path", { d: "m16 16-4 4-4-4" }],
    ["path", { d: "M3 12h18" }],
    ["path", { d: "m8 8 4-4 4 4" }],
  ],
  horizontalRule: /* minus */ [["path", { d: "M5 12h14" }]],
  section: /* section */ [
    ["path", { d: "M16 5a4 3 0 0 0-8 0c0 4 8 3 8 7a4 3 0 0 1-8 0" }],
    ["path", { d: "M8 19a4 3 0 0 0 8 0c0-4-8-3-8-7a4 3 0 0 1 8 0" }],
  ],
  headerFooter: /* panel-top */ [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M3 9h18" }],
  ],
  fields: /* braces */ [
    ["path", { d: "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" }],
    ["path", { d: "M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" }],
  ],
  navigate: /* search */ [
    ["path", { d: "m21 21-4.34-4.34" }],
    ["circle", { cx: "11", cy: "11", r: "8" }],
  ],
  notes: /* notebook-text */ [
    ["path", { d: "M2 6h4" }],
    ["path", { d: "M2 10h4" }],
    ["path", { d: "M2 14h4" }],
    ["path", { d: "M2 18h4" }],
    ["rect", { width: "16", height: "20", x: "4", y: "2", rx: "2" }],
    ["path", { d: "M9.5 8h5" }],
    ["path", { d: "M9.5 12H16" }],
    ["path", { d: "M9.5 16H14" }],
  ],
  controls: /* text-cursor-input */ [
    ["path", { d: "M12 20h-1a2 2 0 0 1-2-2 2 2 0 0 1-2 2H6" }],
    ["path", { d: "M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7" }],
    ["path", { d: "M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1" }],
    ["path", { d: "M6 4h1a2 2 0 0 1 2 2 2 2 0 0 1 2-2h1" }],
    ["path", { d: "M9 6v12" }],
  ],
  rowAbove: /* between-horizontal-start */ [
    ["rect", { width: "13", height: "7", x: "8", y: "3", rx: "1" }],
    ["path", { d: "m2 9 3 3-3 3" }],
    ["rect", { width: "13", height: "7", x: "8", y: "14", rx: "1" }],
  ],
  rowBelow: /* between-horizontal-end */ [
    ["rect", { width: "13", height: "7", x: "3", y: "3", rx: "1" }],
    ["path", { d: "m22 15-3-3 3-3" }],
    ["rect", { width: "13", height: "7", x: "3", y: "14", rx: "1" }],
  ],
  columnLeft: /* between-vertical-start */ [
    ["rect", { width: "7", height: "13", x: "3", y: "8", rx: "1" }],
    ["path", { d: "m15 2-3 3-3-3" }],
    ["rect", { width: "7", height: "13", x: "14", y: "8", rx: "1" }],
  ],
  columnRight: /* between-vertical-end */ [
    ["rect", { width: "7", height: "13", x: "3", y: "3", rx: "1" }],
    ["path", { d: "m9 22 3-3 3 3" }],
    ["rect", { width: "7", height: "13", x: "14", y: "3", rx: "1" }],
  ],
  deleteRows: /* rows-2 */ [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M3 12h18" }],
  ],
  deleteColumns: /* columns-2 */ [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M12 3v18" }],
  ],
  deleteTable: /* trash-2 */ [
    ["path", { d: "M10 11v6" }],
    ["path", { d: "M14 11v6" }],
    ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
    ["path", { d: "M3 6h18" }],
    ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
  ],
  mergeCells: /* table-cells-merge */ [
    ["path", { d: "M12 21v-6" }],
    ["path", { d: "M12 9V3" }],
    ["path", { d: "M3 15h18" }],
    ["path", { d: "M3 9h18" }],
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
  ],
  splitCell: /* table-cells-split */ [
    ["path", { d: "M12 15V9" }],
    ["path", { d: "M3 15h18" }],
    ["path", { d: "M3 9h18" }],
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
  ],
  columnWidth: /* move-horizontal */ [
    ["path", { d: "m18 8 4 4-4 4" }],
    ["path", { d: "M2 12h20" }],
    ["path", { d: "m6 8-4 4 4 4" }],
  ],
  headerRow: /* table-properties */ [
    ["path", { d: "M15 3v18" }],
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M21 9H3" }],
    ["path", { d: "M21 15H3" }],
  ],
  lineNumbers: /* list-ordered */ [
    ["path", { d: "M10 12h11" }],
    ["path", { d: "M10 18h11" }],
    ["path", { d: "M10 6h11" }],
    ["path", { d: "M4 10h2" }],
    ["path", { d: "M4 6h1v4" }],
    ["path", { d: "M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" }],
  ],
  shading: /* paint-roller */ [
    ["rect", { width: "16", height: "6", x: "2", y: "2", rx: "2" }],
    ["path", { d: "M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" }],
    ["rect", { width: "4", height: "6", x: "8", y: "16", rx: "1" }],
  ],
  borders: /* square-dashed-bottom */ [
    ["path", { d: "M5 21a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2" }],
    ["path", { d: "M9 21h1" }],
    ["path", { d: "M14 21h1" }],
  ],
  watermark: /* stamp */ [
    ["path", { d: "M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13" }],
    [
      "path",
      {
        d: "M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z",
      },
    ],
    ["path", { d: "M5 22h14" }],
  ],
  pageColor: /* paint-bucket */ [
    ["path", { d: "m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" }],
    ["path", { d: "m5 2 5 5" }],
    ["path", { d: "M2 13h15" }],
    ["path", { d: "M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" }],
  ],
  pageBorders: /* square */ [["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }]],
  pageSetup: /* file-cog */ [
    [
      "path",
      { d: "M15 8a1 1 0 0 1-1-1V2a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8z" },
    ],
    ["path", { d: "M20 8v12a2 2 0 0 1-2 2h-4.182" }],
    ["path", { d: "m3.305 19.53.923-.382" }],
    ["path", { d: "M4 10.592V4a2 2 0 0 1 2-2h8" }],
    ["path", { d: "m4.228 16.852-.924-.383" }],
    ["path", { d: "m5.852 15.228-.383-.923" }],
    ["path", { d: "m5.852 20.772-.383.924" }],
    ["path", { d: "m8.148 15.228.383-.923" }],
    ["path", { d: "m8.53 21.696-.382-.924" }],
    ["path", { d: "m9.773 16.852.922-.383" }],
    ["path", { d: "m9.773 19.148.922.383" }],
    ["circle", { cx: "7", cy: "18", r: "3" }],
  ],
  controlProperties: /* settings-2 */ [
    ["path", { d: "M14 17H5" }],
    ["path", { d: "M19 7h-9" }],
    ["circle", { cx: "17", cy: "17", r: "3" }],
    ["circle", { cx: "7", cy: "7", r: "3" }],
  ],
  shapeStyles: /* a filled square and an outlined one */ [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1", fill: "currentColor" }],
    ["rect", { x: "11", y: "11", width: "10", height: "10", rx: "1" }],
  ],
  shapeFill: /* paint-bucket */ [
    ["path", { d: "m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" }],
    ["path", { d: "m5 2 5 5" }],
    ["path", { d: "M2 13h15" }],
    ["path", { d: "M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" }],
  ],
  shapeOutline: /* pen-line */ [
    ["path", { d: "M12 20h9" }],
    ["path", { d: "M16.4 3.6a2 2 0 0 1 2.9 2.9L7 18.8l-4 1 1-4Z" }],
  ],
  outlineWeight: /* lines of three weights */ [
    ["path", { d: "M3 6h18", strokeWidth: "1" }],
    ["path", { d: "M3 12h18", strokeWidth: "2" }],
    ["path", { d: "M3 18h18", strokeWidth: "3.5" }],
  ],
  outlineDashes: /* dashed lines */ [
    ["path", { d: "M3 7h4m4 0h4m4 0h2" }],
    ["path", { d: "M3 13h2m3 0h2m3 0h2m3 0h2" }],
    ["path", { d: "M3 19h7m4 0h7" }],
  ],
  outlineArrows: /* move-right */ [
    ["path", { d: "M3 12h18" }],
    ["path", { d: "m15 6 6 6-6 6" }],
  ],
  shapes: /* shapes: a triangle, a square, a circle */ [
    [
      "path",
      {
        d: "M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z",
      },
    ],
    ["rect", { x: "3", y: "14", width: "7", height: "7", rx: "1" }],
    ["circle", { cx: "17.5", cy: "17.5", r: "3.5" }],
  ],
  textBox: /* text-cursor-input-ish: a box with lines */ [
    ["rect", { width: "18", height: "14", x: "3", y: "5", rx: "1" }],
    ["path", { d: "M7 10h10" }],
    ["path", { d: "M7 14h6" }],
  ],
  wrapText: /* wrap-text */ [
    ["path", { d: "M3 6h18" }],
    ["path", { d: "M3 12h15a3 3 0 1 1 0 6h-4" }],
    ["path", { d: "m16 16-2 2 2 2" }],
    ["path", { d: "M3 18h7" }],
  ],
  layoutOptions: /* wrap-text */ [
    ["path", { d: "M3 6h18" }],
    ["path", { d: "M3 12h15a3 3 0 1 1 0 6h-4" }],
    ["path", { d: "m16 16-2 2 2 2" }],
    ["path", { d: "M3 18h7" }],
  ],
  position: /* layout-dashboard-ish: a box placed in a page */ [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["rect", { width: "7", height: "6", x: "6", y: "6" }],
  ],
  objectSize: /* scaling */ [
    ["path", { d: "M21 3 9 15" }],
    ["path", { d: "M12 3H3v18h18v-9" }],
    ["path", { d: "M16 3h5v5" }],
  ],
  bringForward: /* bring-to-front */ [
    ["rect", { x: "8", y: "8", width: "8", height: "8", rx: "2" }],
    ["path", { d: "M4 10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2" }],
    ["path", { d: "M14 20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2" }],
  ],
  sendBackward: /* send-to-back */ [
    ["rect", { x: "14", y: "14", width: "8", height: "8", rx: "2" }],
    ["rect", { x: "2", y: "2", width: "8", height: "8", rx: "2" }],
    ["path", { d: "M7 14v1a2 2 0 0 0 2 2h1" }],
    ["path", { d: "M14 7h1a2 2 0 0 1 2 2v1" }],
  ],
  alignObject: /* align-horizontal-justify-start */ [
    ["rect", { width: "6", height: "14", x: "6", y: "5", rx: "2" }],
    ["rect", { width: "6", height: "10", x: "16", y: "7", rx: "2" }],
    ["path", { d: "M2 2v20" }],
  ],
  crop: /* crop */ [
    ["path", { d: "M6 2v14a2 2 0 0 0 2 2h14" }],
    ["path", { d: "M18 22V8a2 2 0 0 0-2-2H2" }],
  ],
  footnote: /* panel-bottom */ [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M3 15h18" }],
  ],
  endnote: /* list-end */ [
    ["path", { d: "M16 5H3" }],
    ["path", { d: "M16 12H3" }],
    ["path", { d: "M9 19H3" }],
    ["path", { d: "m16 16-3 3 3 3" }],
    ["path", { d: "M21 5v12a2 2 0 0 1-2 2h-6" }],
  ],
  goToNote: /* corner-down-right */ [
    ["path", { d: "m15 10 5 5-5 5" }],
    ["path", { d: "M4 4v7a4 4 0 0 0 4 4h12" }],
  ],
  noteOptions: /* settings-2 */ [
    ["path", { d: "M14 17H5" }],
    ["path", { d: "M19 7h-9" }],
    ["circle", { cx: "17", cy: "17", r: "3" }],
    ["circle", { cx: "7", cy: "7", r: "3" }],
  ],
  tableOfContents: /* table-of-contents */ [
    ["path", { d: "M16 5H3" }],
    ["path", { d: "M16 12H3" }],
    ["path", { d: "M16 19H3" }],
    ["path", { d: "M21 5h.01" }],
    ["path", { d: "M21 12h.01" }],
    ["path", { d: "M21 19h.01" }],
  ],
  updateFields: /* refresh-cw */ [
    ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
    ["path", { d: "M21 3v5h-5" }],
    ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
    ["path", { d: "M8 16H3v5" }],
  ],
  pageNumber: /* hash */ [
    ["line", { x1: "4", x2: "20", y1: "9", y2: "9" }],
    ["line", { x1: "4", x2: "20", y1: "15", y2: "15" }],
    ["line", { x1: "10", x2: "8", y1: "3", y2: "21" }],
    ["line", { x1: "16", x2: "14", y1: "3", y2: "21" }],
  ],
  symbol: /* omega */ [
    [
      "path",
      {
        d: "M3 20h4.5a.5.5 0 0 0 .5-.5v-.282a.52.52 0 0 0-.247-.437 8 8 0 1 1 8.494-.001.52.52 0 0 0-.247.438v.282a.5.5 0 0 0 .5.5H21",
      },
    ],
  ],
  date: /* calendar */ [
    ["path", { d: "M8 2v3" }],
    ["path", { d: "M16 2v3" }],
    ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
    ["path", { d: "M3 9h18" }],
  ],
  dateTime: /* calendar */ [
    ["path", { d: "M8 2v3" }],
    ["path", { d: "M16 2v3" }],
    ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
    ["path", { d: "M3 9h18" }],
  ],
  crossReference: /* bookmark */ [
    [
      "path",
      {
        d: "M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z",
      },
    ],
  ],
  fieldCodes: /* code */ [
    ["path", { d: "m16 18 6-6-6-6" }],
    ["path", { d: "m8 6-6 6 6 6" }],
  ],
  navigationPane: /* panel-left */ [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M9 3v18" }],
  ],
  rotateLeft: /* rotate-ccw */ [
    ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
    ["path", { d: "M3 3v5h5" }],
  ],
  rotateRight: /* rotate-cw */ [
    ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" }],
    ["path", { d: "M21 3v5h-5" }],
  ],
  superscript: /* superscript */ [
    ["path", { d: "m4 19 8-8" }],
    ["path", { d: "m12 19-8-8" }],
    [
      "path",
      {
        d: "M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7.002c0-.472-.17-.93-.484-1.29a2.105 2.105 0 0 0-2.617-.436c-.42.239-.738.614-.899 1.06",
      },
    ],
  ],
  subscript: /* subscript */ [
    ["path", { d: "m4 5 8 8" }],
    ["path", { d: "m12 5-8 8" }],
    [
      "path",
      {
        d: "M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07",
      },
    ],
  ],
  clearFormatting: /* eraser */ [
    [
      "path",
      {
        d: "M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21",
      },
    ],
    ["path", { d: "m5.082 11.09 8.828 8.828" }],
  ],
  changeCase: /* case-sensitive */ [
    ["path", { d: "m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" }],
    ["path", { d: "M22 9v7" }],
    ["path", { d: "M3.304 13h6.392" }],
    ["circle", { cx: "18.5", cy: "12.5", r: "3.5" }],
  ],
  growFont: /* a-arrow-up */ [
    ["path", { d: "m14 11 4-4 4 4" }],
    ["path", { d: "M18 16V7" }],
    ["path", { d: "m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" }],
    ["path", { d: "M3.304 13h6.392" }],
  ],
  shrinkFont: /* a-arrow-down */ [
    ["path", { d: "m14 12 4 4 4-4" }],
    ["path", { d: "M18 16V7" }],
    ["path", { d: "m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" }],
    ["path", { d: "M3.304 13h6.392" }],
  ],
  underlineStyle: /* chevron-down */ [["path", { d: "m6 9 6 6 6-6" }]],
  formatPainter: /* paintbrush */ [
    ["path", { d: "m14.622 17.897-10.68-2.913" }],
    [
      "path",
      {
        d: "M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z",
      },
    ],
    [
      "path",
      {
        d: "M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15",
      },
    ],
  ],
  ruler: /* ruler */ [
    [
      "path",
      {
        d: "M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z",
      },
    ],
    ["path", { d: "m14.5 12.5 2-2" }],
    ["path", { d: "m11.5 9.5 2-2" }],
    ["path", { d: "m8.5 6.5 2-2" }],
    ["path", { d: "m17.5 15.5 2-2" }],
  ],
  formattingMarks: /* pilcrow */ [
    ["path", { d: "M13 4v16" }],
    ["path", { d: "M17 4v16" }],
    ["path", { d: "M19 4H9.5a4.5 4.5 0 0 0 0 9H13" }],
  ],
  margins: /* foli: a page and its text area */ [
    ["rect", { x: "4", y: "2", width: "16", height: "20", rx: "2" }],
    ["path", { d: "M8 6h8v12H8z" }],
  ],
  orientation: /* foli: a page turning */ [
    ["rect", { x: "3", y: "8", width: "13", height: "13", rx: "2" }],
    ["path", { d: "M8 4h9a4 4 0 0 1 4 4v9" }],
    ["path", { d: "m18 14 3 3 3-3" }],
  ],
  pageSize: /* file */ [
    ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }],
    ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }],
  ],
  columns: /* columns-2 */ [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M12 3v18" }],
  ],
  breaks: /* separator-horizontal */ [
    ["path", { d: "M3 12h18" }],
    ["path", { d: "m8 8 4-4 4 4" }],
    ["path", { d: "m16 16-4 4-4-4" }],
  ],
  fontSettings: /* settings-2 */ [
    ["path", { d: "M14 17H5" }],
    ["path", { d: "M19 7h-9" }],
    ["circle", { cx: "17", cy: "17", r: "3" }],
    ["circle", { cx: "7", cy: "7", r: "3" }],
  ],
  paragraphSettings: /* settings-2 */ [
    ["path", { d: "M14 17H5" }],
    ["path", { d: "M19 7h-9" }],
    ["circle", { cx: "17", cy: "17", r: "3" }],
    ["circle", { cx: "7", cy: "7", r: "3" }],
  ],
};

const icon = (shapes: readonly Shape[]): ReactElement =>
  createElement(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: 16,
      height: 16,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
      focusable: false,
      className: "foli-toolbar-icon",
    },
    ...shapes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs })),
  );

/**
 * An SVG icon for each built-in toolbar item, by the item's `key` (`align-start`…): what
 * `wordRibbonTabs` draws. Give one to an item of your own: `{ ...toolbarItems.bold, icon:
 * toolbarIcons.bold }`. Drawn in `currentColor`, 16 px (`.foli-toolbar-icon`; CSS sizes it).
 */
export const toolbarIcons: Readonly<Record<string, ReactElement>> = Object.fromEntries(
  Object.entries(SHAPES).map(([key, shapes]) => [key, icon(shapes)]),
);
