// Parse an RTF document into font-tagged runs: [{ text, font }].
//
// Legacy Tibetan RTF stores each 8-bit font code as \'XX (hex). We decode those
// back to the raw byte characters the conversion tables expect (normalizeLegacy
// then handles tool-specific homoglyphs). The current font (\fN) is resolved
// against the \fonttbl so Sanskrit runs can be converted with the right table.

import { convertRuns } from "../runs.js";
import { getBudaTable } from "../fonts.js";
import { isMacRtf, isSym, symLegacyChar, SYM_CHAR } from "../rtf-symbols.js";

// Destinations whose contents are not body text and must be skipped entirely.
const IGNORE_DEST = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object",
  "themedata", "colorschememapping", "latentstyles", "datastore",
  "generator", "filetbl", "listtable", "listoverridetable", "rsidtbl",
]);

function parseFontTable(rtf) {
  const fonts = {};
  const m = rtf.match(/\\fonttbl/);
  if (!m) return fonts;
  // Walk the balanced group that starts at \fonttbl.
  let i = rtf.indexOf("{", rtf.indexOf("\\fonttbl"));
  // back up to the '{' that opens the fonttbl group
  let start = rtf.lastIndexOf("{", m.index);
  i = start;
  let depth = 0;
  let group = "";
  for (; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { group += c; break; }
    }
    group += c;
  }
  // Each font entry: \fN ... FontName;
  const re = /\\f(\d+)[^;{}]*?(?:\\[a-z]+\d* ?)*\s*([^;{}]*);/gi;
  let fm;
  while ((fm = re.exec(group))) {
    const id = fm[1];
    const name = (fm[2] || "").replace(/\\[a-z]+\d* ?/gi, "").trim();
    if (name) fonts[id] = name;
  }
  return fonts;
}

export function rtfToRuns(rtf) {
  rtf = String(rtf);
  const mac = isMacRtf(rtf);
  const fontTable = parseFontTable(rtf);
  const runs = [];
  // Group stack carries the active font id and whether we're inside an
  // ignorable destination.
  const stack = [{ font: null, ignore: false }];
  let cur = () => stack[stack.length - 1];
  let curFontId = null;
  let ucSkip = 1; // \ucN: number of fallback chars to skip after \uN
  let skipChars = 0;
  let buf = "";
  let bufFont = null;

  function flush() {
    if (buf) {
      runs.push({ text: buf, font: fontTable[bufFont] || "" });
      buf = "";
    }
  }
  function emit(ch) {
    if (cur().ignore) return;
    if (skipChars > 0) { skipChars--; return; }
    const fid = cur().font;
    if (fid !== bufFont) { flush(); bufFont = fid; }
    buf += ch;
  }

  let i = 0;
  const n = rtf.length;
  while (i < n) {
    const c = rtf[i];
    if (c === "{") {
      stack.push({ font: cur().font, ignore: cur().ignore });
      i++;
    } else if (c === "}") {
      flush();
      if (stack.length > 1) stack.pop();
      bufFont = cur().font;
      i++;
    } else if (c === "\\") {
      const next = rtf[i + 1];
      if (next === "'") {
        // hex byte \'XX
        const hex = rtf.substr(i + 2, 2);
        emit(String.fromCharCode(parseInt(hex, 16)));
        i += 4;
      } else if (next === "\\" || next === "{" || next === "}") {
        emit(next);
        i += 2;
      } else if (next === "*") {
        cur().ignore = true; // ignorable destination follows
        i += 2;
      } else if (next === "~") { emit(" "); i += 2; }
      else if (next === "-" || next === "_") { i += 2; } // optional hyphen
      else if (/[a-zA-Z]/.test(next)) {
        // control word: \word[-]<digits>[ ]
        let j = i + 1;
        while (j < n && /[a-zA-Z]/.test(rtf[j])) j++;
        const word = rtf.slice(i + 1, j);
        let num = "";
        if (rtf[j] === "-") { num += "-"; j++; }
        while (j < n && /[0-9]/.test(rtf[j])) { num += rtf[j]; j++; }
        if (rtf[j] === " ") j++; // a single trailing space is part of the word
        i = j;
        // act on the control word
        if (word === "f") { cur().font = num; }
        else if (word === "u") {
          if (!cur().ignore) emit(String.fromCharCode(parseInt(num, 10) & 0xffff));
          skipChars = ucSkip;
        } else if (word === "uc") { ucSkip = parseInt(num || "1", 10); }
        else if (word === "par" || word === "line" || word === "sect") emit("\n");
        else if (word === "tab") emit("\t");
        else if (word === "cell" || word === "row") emit("\t");
        else if (isSym(word)) {
          const legacy = !!getBudaTable(fontTable[cur().font]);
          emit(legacy ? symLegacyChar(word, mac) : SYM_CHAR[word]);
        }
        else if (IGNORE_DEST.has(word.toLowerCase())) cur().ignore = true;
        // all other control words: ignore
      } else {
        i += 2; // unknown escape
      }
    } else if (c === "\r" || c === "\n") {
      i++; // RTF line breaks are not content
    } else {
      emit(c);
      i++;
    }
  }
  flush();
  return runs;
}

export function convertRtf(rtf, options) {
  return convertRuns(rtfToRuns(rtf), options);
}
