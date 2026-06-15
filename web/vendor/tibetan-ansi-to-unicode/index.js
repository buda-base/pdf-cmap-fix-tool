export { testGroups } from "./src/testGroups.js";
export {
  default as TibetanUnicodeConverter,
  default,
  charsMap,
  wordsMap,
  normalizeLegacy,
} from "./src/tibetan-unicode-converter.js";

// Font-aware conversion (use the font of each run to disambiguate glyphs),
// backed by BUDA's py-tiblegenc tables (194 fonts).
export { convertRuns, convertRun } from "./src/runs.js";
export {
  normalizeFontName,
  getBudaTable,
  isKnownFont,
  supportedFonts,
  defaultSizeScale,
} from "./src/fonts.js";

// Document parsers -> font-tagged runs and direct conversion helpers.
export { rtfToRuns, convertRtf } from "./src/parsers/rtf.js";
export { docxToRuns, convertDocx, documentXmlToRuns } from "./src/parsers/docx.js";

// In-place document transforms preserving all formatting.
export { convertDocxDocument } from "./src/transform/docx.js";
export { convertRtfDocument } from "./src/transform/rtf.js";

// Formatting-aware preview model (paragraphs + run sizes/bold), text converted.
export { docxToBlocks, rtfToBlocks } from "./src/preview.js";
