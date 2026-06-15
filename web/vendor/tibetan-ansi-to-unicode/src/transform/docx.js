// Convert a .docx IN PLACE: replace each run's legacy-encoded text with Unicode
// and swap its legacy font for a Unicode Tibetan font, leaving every other piece
// of formatting (paragraph styles, run sizes — hence the big/small distinction —
// bold, colour, spacing, tables, …) exactly as it was.
//
// Only runs whose font is a known legacy font (BUDA table) are touched; any other
// run is left byte-for-byte untouched.

import { getBudaTable, defaultSizeScale } from "../fonts.js";

const TARGET_XML = /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/;

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}
function encodeEntities(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function attr(tag, name) {
  const m = tag.match(new RegExp("\\b" + name + '="([^"]*)"'));
  return m ? m[1] : null;
}
function setAttr(tag, name, value) {
  const re = new RegExp("\\b" + name + '="[^"]*"');
  if (re.test(tag)) return tag.replace(re, `${name}="${value}"`);
  // insert before the closing of the (possibly self-closing) tag
  return tag.replace(/\s*\/?>$/, (end) => ` ${name}="${value}"` + end);
}

function convertText(text, table) {
  let out = "";
  for (const ch of text) {
    const u = table[ch.codePointAt(0)];
    out += u !== undefined ? u : ch;
  }
  return out;
}

function resolveFont(runXml, rFontsTag, fallbackFont) {
  if (rFontsTag) {
    // Legacy ANSI Tibetan text lives in the ASCII range, so Word stores its font
    // in w:ascii/w:hAnsi while w:cs is often a different default. Prefer whichever
    // slot is actually a known legacy font (ascii/hAnsi first).
    const a = attr(rFontsTag, "w:ascii");
    const h = attr(rFontsTag, "w:hAnsi");
    const c = attr(rFontsTag, "w:cs");
    for (const f of [a, h, c]) if (f && getBudaTable(f)) return f;
    return a || h || c || fallbackFont;
  }
  return fallbackFont;
}

function scaleSizes(runXml, scale) {
  if (!scale || scale === 1) return runXml;
  return runXml.replace(/<w:(sz|szCs) w:val="(\d+)"\/>/g, (m, tag, val) => {
    const v = Math.max(1, Math.round(parseInt(val, 10) * scale));
    return `<w:${tag} w:val="${v}"/>`;
  });
}

function processRun(runXml, unicodeFont, fallbackFont, sizeScale) {
  const rFontsMatch = runXml.match(/<w:rFonts\b[^>]*\/?>/);
  const font = resolveFont(runXml, rFontsMatch && rFontsMatch[0], fallbackFont);
  const table = font && getBudaTable(font);
  if (!table) return runXml; // not a legacy Tibetan run — leave untouched
  runXml = scaleSizes(runXml, sizeScale); // shrink to match the legacy visual size

  // 1) convert the text in each <w:t>
  let out = runXml.replace(
    /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g,
    (m, open, body, close) => {
      const conv = convertText(decodeEntities(body), table);
      // preserve leading/trailing spaces
      if (/^\s|\s$/.test(conv) && !/xml:space=/.test(open)) {
        open = open.replace(/>$/, ' xml:space="preserve">');
      }
      return open + encodeEntities(conv) + close;
    }
  );

  // 2) point the run at the Unicode font (ascii + hAnsi + cs)
  let newFonts;
  if (rFontsMatch) {
    newFonts = rFontsMatch[0];
    for (const a of ["w:ascii", "w:hAnsi", "w:cs"]) newFonts = setAttr(newFonts, a, unicodeFont);
    out = out.replace(rFontsMatch[0], newFonts);
  } else {
    const tag = `<w:rFonts w:ascii="${unicodeFont}" w:hAnsi="${unicodeFont}" w:cs="${unicodeFont}"/>`;
    if (/<w:rPr>/.test(out)) {
      out = out.replace(/<w:rPr>/, "<w:rPr>" + tag); // rFonts must be first in rPr
    } else {
      out = out.replace(/(<w:r\b[^>]*>)/, `$1<w:rPr>${tag}</w:rPr>`);
    }
  }
  return out;
}

function processXml(xml, unicodeFont, fallbackFont, sizeScale) {
  return xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) =>
    processRun(run, unicodeFont, fallbackFont, sizeScale)
  );
}

// Empty paragraphs keep their (large) paragraph-mark size, making blank lines as
// tall as body text. Shrink the mark of empty paragraphs to ~1/3 of the scaled
// body size so blank lines are small.
function shrinkEmptyParagraphs(xml, sizeScale) {
  if (!sizeScale) return xml;
  const f = sizeScale / 3;
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (p) => {
    const tre = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let m;
    while ((m = tre.exec(p))) if (m[1] && m[1].replace(/\s/g, "")) return p; // has text
    const ppr = p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
    if (!ppr) return p;
    const np = ppr[0].replace(
      /<w:(sz|szCs) w:val="(\d+)"\/>/g,
      (mm, t, v) => `<w:${t} w:val="${Math.max(2, Math.round(parseInt(v, 10) * f))}"/>`
    );
    return p.replace(ppr[0], np);
  });
}

// Read the document's default font (docDefaults) so runs without an explicit
// rFonts can still be converted when the default is a legacy font.
function readDefaultFont(stylesXml) {
  if (!stylesXml) return null;
  const dd = stylesXml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/);
  const rf = (dd ? dd[0] : stylesXml).match(/<w:rFonts\b[^>]*\/?>/);
  if (!rf) return null;
  const f = attr(rf[0], "w:cs") || attr(rf[0], "w:ascii") || attr(rf[0], "w:hAnsi");
  return f && getBudaTable(f) ? f : null;
}

// data: ArrayBuffer | Uint8Array | Buffer of the .docx.
// Returns a Uint8Array of the converted .docx.
export async function convertDocxDocument(data, options = {}) {
  const unicodeFont = options.unicodeFont || "Jomolhari";
  const sizeScale = options.sizeScale ?? defaultSizeScale(unicodeFont);
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);

  const stylesFile = zip.file("word/styles.xml");
  const fallbackFont = stylesFile
    ? readDefaultFont(await stylesFile.async("string"))
    : null;

  await Promise.all(
    Object.keys(zip.files)
      .filter((name) => TARGET_XML.test(name))
      .map(async (name) => {
        const xml = await zip.file(name).async("string");
        let processed = processXml(xml, unicodeFont, fallbackFont, sizeScale);
        processed = shrinkEmptyParagraphs(processed, sizeScale);
        zip.file(name, processed);
      })
  );

  return zip.generateAsync({ type: "uint8array" });
}
