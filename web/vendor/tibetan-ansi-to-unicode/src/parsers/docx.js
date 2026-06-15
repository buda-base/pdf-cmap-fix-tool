// Parse a .docx into font-tagged runs: [{ text, font }].
//
// .docx is a ZIP; the body lives in word/document.xml. We read each run's font
// from its <w:rFonts> (preferring the complex-script font w:cs, which is what
// Tibetan uses), and the text from <w:t>. Paragraphs become newlines.
//
// JSZip is imported lazily so the core library has no hard dependency for users
// who only convert plain text.

import { convertRuns } from "../runs.js";
import { getBudaTable } from "../fonts.js";

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

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
}

// Turn the body XML string into runs. Exported for testing without a zip.
export function documentXmlToRuns(xml) {
  const runs = [];
  // Split into paragraphs to insert newlines between them.
  const paragraphs = xml.split(/<w:p[ >]/).slice(1);
  for (const para of paragraphs) {
    const body = para.slice(0, para.indexOf("</w:p>") + 1 || undefined);
    // Each run <w:r> ... </w:r>
    const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
    let rm;
    while ((rm = runRe.exec(body))) {
      const inner = rm[1];
      // font: prefer the slot that is a known legacy font (ascii/hAnsi before cs),
      // because legacy ANSI Tibetan text lives in the ASCII range.
      let font = "";
      const rf = inner.match(/<w:rFonts\b[^>]*\/?>/);
      if (rf) {
        const a = attr(rf[0], "w:ascii");
        const h = attr(rf[0], "w:hAnsi");
        const c = attr(rf[0], "w:cs");
        font = [a, h, c].find((f) => f && getBudaTable(f)) || a || h || c || "";
      }
      // text + tabs + breaks, in document order
      let text = "";
      const tokRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>/g;
      let tk;
      while ((tk = tokRe.exec(inner))) {
        if (tk[1] !== undefined) text += decodeEntities(tk[1]);
        else if (tk[0].startsWith("<w:tab")) text += "\t";
        else text += "\n";
      }
      if (text) runs.push({ text, font });
    }
    runs.push({ text: "\n", font: "" });
  }
  return runs;
}

// Accepts an ArrayBuffer / Uint8Array / Node Buffer of the .docx file.
export async function docxToRuns(data) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Not a Word .docx (word/document.xml missing)");
  const xml = await file.async("string");
  return documentXmlToRuns(xml);
}

export async function convertDocx(data, options) {
  return convertRuns(await docxToRuns(data), options);
}
