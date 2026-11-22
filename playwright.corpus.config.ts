import { defineConfig } from "@playwright/test";
import word from "./playwright.word.config";

/** The corpus run's renderer pass (Phase 20, `pnpm corpus:render`): the Word page's setup. */
export default defineConfig({ ...word, testMatch: "**/corpus.word.ts", testIgnore: [] });
