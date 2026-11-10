export {
  type AbstractNumberingJSON,
  type CommentJSON,
  type FoliDocumentV3,
  type NumberingInstanceJSON,
  type NumberingLevelJSON,
  type ParagraphPropertiesJSON,
  parseContentV3,
  parseDocumentV3,
  SCHEMA_VERSION_V3,
  type SectionJSON,
  type StyleJSON,
  type ThemeJSON,
} from "./document.js";
export { migrateToV3 } from "./migrate.js";
export {
  checkSection,
  HIGHLIGHT_COLORS,
  JUSTIFICATIONS,
  type Justification,
  schemaV3,
} from "./schema.js";
export * from "./units.js";
