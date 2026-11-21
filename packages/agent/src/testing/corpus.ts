import { readFileSync } from "node:fs";
import { importDocx } from "@folijs/docx";

const CORPUS = new URL("../../../../corpus/word/", import.meta.url);

/** A document of the Word corpus (`corpus/word/<name>.docx`), imported. */
export const corpus = (name: string) => importDocx(readFileSync(new URL(`${name}.docx`, CORPUS)));
