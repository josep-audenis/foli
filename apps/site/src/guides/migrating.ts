import { parseContent } from "@folijs/core";

// 0.6: parseContent(json, "clip", true)
export const pasted = (json: unknown) => parseContent(json, { path: "clip", fragment: true });
