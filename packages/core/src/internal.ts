// `@folijs/core/internal` (ADR-0008): what the other Foli packages need from core that is not
// public (the Word context and envelope, the formatting resolver, clipboard fitting, layout
// helpers). No promise: any release may change it. The packages are installed at the same
// version (exact peer dependencies), so they always run with the core they were built with.
export {
  CommentStep,
  caretStop,
  controlSpot,
  copiedDefinitions,
  deleteSelectionKeepingTables,
  documentJSON,
  EnvelopeStep,
  type FittedPaste,
  fitPaste,
  fitPastedV2,
  keepTablesApart,
  noteKindOf,
  referencesIn,
  StoryStep,
  sameSpot,
  setComments,
  typedMarks,
  type WordContext,
  type WordDefinitions,
  type WordEnvelope,
  withEnvelope,
  wordContext,
} from "./state/index.js";
export type { EnvelopeKey, Story } from "./state/word.js";
export type { Check } from "./v3/check.js";
export {
  type CellFormat,
  type CellPlace,
  CUSTOM_TYPE,
  checkControl,
  checkSection,
  foreignTextOf,
  formatNumber,
  type ListMarker,
  type ParagraphFormat,
  Resolver,
  RUN_PROPERTY_MARKS,
  type RunFormat,
  schema,
  type TableFormat,
  tableConditions,
  withForeignText,
} from "./v3/index.js";
