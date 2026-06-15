// RTF writers emit "smart" punctuation (curly quotes, dashes, bullet) as control
// words rather than \'XX bytes. In a legacy Tibetan font those code points are
// actually Tibetan glyphs, so the control word must be resolved to the ORIGINAL
// font byte — which differs by platform: a \mac document uses MacRoman byte
// values, otherwise Windows-1252. We then feed that byte through the table like
// any \'XX byte. In a non-legacy run the control word keeps its real character.

export function isMacRtf(rtf) {
  return /\\mac\b/.test(String(rtf).slice(0, 600));
}

// control word -> byte value, per platform
const BYTE_MAC = {
  ldblquote: 0xd2, rdblquote: 0xd3, lquote: 0xd4, rquote: 0xd5,
  emdash: 0xd1, endash: 0xd0, bullet: 0xa5,
};
const BYTE_WIN = {
  ldblquote: 0x93, rdblquote: 0x94, lquote: 0x91, rquote: 0x92,
  emdash: 0x97, endash: 0x96, bullet: 0x95,
};

// real Unicode character (for non-legacy text)
export const SYM_CHAR = {
  ldblquote: "“", rdblquote: "”", lquote: "‘", rquote: "’",
  emdash: "—", endash: "–", bullet: "•",
};

export function isSym(word) {
  return Object.prototype.hasOwnProperty.call(SYM_CHAR, word);
}

// The byte character a control word stands for in a legacy run (to be converted).
export function symLegacyChar(word, mac) {
  const b = (mac ? BYTE_MAC : BYTE_WIN)[word];
  return b === undefined ? undefined : String.fromCharCode(b);
}
