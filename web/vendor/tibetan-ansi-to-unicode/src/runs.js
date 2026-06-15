// Font-aware conversion of a sequence of runs.
//
// A "run" is a piece of text together with the font it was set in:
//   { text: "…", font: "TibetanChogyalSkt2" }
// This carries the information needed to disambiguate legacy glyphs. Runs
// typically come from a .docx, .rtf, or pasted HTML (see ./parsers/*).
//
// A run in a known font is converted by a direct per-character lookup in that
// font's BUDA table; concatenation across the run rebuilds stacked clusters.
// Runs in an unknown font fall back to the default TibetanChogyal converter.

import TibetanUnicodeConverter from "./tibetan-unicode-converter.js";
import { getBudaTable, normalizeFontName, isKnownFont } from "./fonts.js";

// Convert a single run's text using the table for its font.
export function convertRun(text, font) {
  if (!text) return "";
  const table = getBudaTable(font);
  if (table) {
    let out = "";
    for (const ch of text) {
      const u = table[String(ch.codePointAt(0))];
      out += u !== undefined ? u : ch;
    }
    return out;
  }
  // Unknown font: assume default body TibetanChogyal encoding.
  return new TibetanUnicodeConverter(text).convert();
}

// Convert an array of runs to a single Unicode string.
// Consecutive runs in the same font are merged before conversion.
//
// Returns a string by default. Pass { details: true } to also get the set of
// fonts seen and which were unknown (fell back to the default converter).
export function convertRuns(runs, options = {}) {
  if (!Array.isArray(runs)) runs = [];
  const merged = [];
  for (const run of runs) {
    const font = run.font || "";
    const text = run.text != null ? String(run.text) : "";
    if (text === "") continue;
    const last = merged[merged.length - 1];
    if (last && normalizeFontName(last.font) === normalizeFontName(font)) {
      last.text += text;
    } else {
      merged.push({ font, text });
    }
  }

  const fontsSeen = new Set();
  const unknownFonts = new Set();
  let out = "";
  for (const run of merged) {
    fontsSeen.add(normalizeFontName(run.font));
    if (run.font && !isKnownFont(run.font)) unknownFonts.add(run.font);
    out += convertRun(run.text, run.font);
  }

  if (options.details) {
    return { text: out, fonts: [...fontsSeen], unknownFonts: [...unknownFonts] };
  }
  return out;
}
