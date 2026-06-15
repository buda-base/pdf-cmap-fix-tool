// Normalize alternate Unicode code points that different extraction tools
// (e.g. pdfminer vs. clipboard) produce for the SAME font glyph, verified
// against the TibetanChogyal cmap, so the tables match regardless of how the
// legacy text was decoded:
//   U+00B5 (µ micro sign)  -> U+03BC (μ greek mu)  — same glyph (ག)
//   U+0153 (œ oe ligature) -> "oe"                  — for ཧཱུྃ ("oe×ñ")
//   U+0081                 -> U+20AB (₫)            — same glyph (སྤྱ)
//   U+0090                 -> U+20AF (₯)            — same glyph (དྭ)
var normalizeLegacy = function (text) {
  return text
    .replace(/µ/g, "μ")
    .replace(/œ/g, "oe")
    .replace(//g, "₫")
    .replace(//g, "₯");
};

var TibetanUnicodeConverter = function (conversion, options) {
  options = options || {};
  return {
    conversion: conversion,
    charsMap: options.charsMap || charsMap,
    wordsMap: options.wordsMap || wordsMap,
    line: "",
    convert: function () {
      var replaced = normalizeLegacy(this.conversion);
      this.wordsMap.forEach(function (word) {
        replaced = replaced.replace(
          new RegExp(word.encoded, "g"),
          word.tibetan
        );
      });
      var chars = replaced.split("");
      var char;
      while ((char = chars.shift())) {
        this.line += this.convertChar(char);
      }
      return this.line;
    },
    convertChar: function (char) {
      if (char == " ") return char;
      var self = this;
      var match = self.charsMap.find(function (object) {
        return object.encoded.includes(char);
      });
      if (match) return match.tibetan;
      else return char;
    },
    convertToAnsi: function () {
      var replaced = this.conversion;
      var charsMap = this.charsMap;
      var wordsMap = this.wordsMap;

      // Build a set of tibetan sequences that have a direct charsMap entry
      var charsMapTibetans = {};
      charsMap.forEach(function (mapping) {
        charsMapTibetans[mapping.tibetan] = true;
      });

      // Replace words first, but skip if charsMap has a direct mapping
      wordsMap.forEach(function (word) {
        if (charsMapTibetans[word.tibetan]) return; // Skip, charsMap will handle it
        replaced = replaced.replace(
          new RegExp(word.tibetan, "g"),
          word.encoded
        );
      });

      // Sort charsMap by tibetan length descending to match longer sequences first
      var sortedCharsMap = charsMap.slice().sort(function (a, b) {
        return b.tibetan.length - a.tibetan.length;
      });
      // Replace each tibetan character/sequence with its encoded equivalent
      sortedCharsMap.forEach(function (mapping) {
        // Use first encoded character when multiple options exist
        var firstEncoded = mapping.encoded[0];
        replaced = replaced.replace(
          new RegExp(mapping.tibetan, "g"),
          firstEncoded
        );
      });
      return replaced;
    },
  };
};

var charsMap = [
  { tibetan: "༈", encoded: "Ì" },
  { tibetan: "་", encoded: "-Í" },
  { tibetan: "།", encoded: "ÊË" },
  { tibetan: "༔", encoded: "Î" },
  { tibetan: "ཿ", encoded: "ï" },
  { tibetan: "༴", encoded: "Ï" },
  { tibetan: "༄༅", encoded: "É" },
  { tibetan: "༄", encoded: "Ò" },
  { tibetan: "༅", encoded: "È" },
  { tibetan: "ཛྲ", encoded: "‰" }, // Maybe སྨྲ is more frequent
  { tibetan: "སྭ", encoded: "—" },
  { tibetan: "གྲྭ", encoded: "™" },
  { tibetan: "ཏྭ", encoded: "" },
  { tibetan: "ཌ", encoded: "¬" },
  { tibetan: "སྦ", encoded: "]" }, // Maybe also ངྒ, but can it be really?
  { tibetan: "བྷ", encoded: "£" },
  { tibetan: "ཥ", encoded: "®" },
  { tibetan: "ཛྱ", encoded: "ˆ" },
  { tibetan: "ཋ", encoded: "«" },
  { tibetan: "ཀྵ", encoded: "¯" },
  { tibetan: "རྟ", encoded: "½" },
  { tibetan: "ཎྜ", encoded: "¼" },
  { tibetan: "རྒྷ", encoded: "¾" },
  { tibetan: "྄", encoded: "ü" },
  { tibetan: "རྐ", encoded: "?" },
  { tibetan: "ིཾ", encoded: "ó" },
  { tibetan: "ཱུ", encoded: "Õ" },
  { tibetan: "ཻཾ", encoded: "ø" },
  { tibetan: "སྐྲ", encoded: "„" },
  { tibetan: "ཛྭ", encoded: "Š" },
  { tibetan: "ཧྱ", encoded: "ƒ" },
  { tibetan: "རྒ", encoded: "@" },
  { tibetan: "ྭ", encoded: "Ÿ" },
  { tibetan: "ཚྭ", encoded: "’" }, // right single quote glyph (distinct from ' U+0027 = ཇ)
  { tibetan: "ཁྭ", encoded: "‹" },
  { tibetan: "ཤྭ", encoded: "–" },

  { tibetan: "ི", encoded: "ÜÝÞ" },
  { tibetan: "ུ", encoded: "ß¥©°àáâäã³±çå¨²æ§¦" },
  { tibetan: "ེ", encoded: "èé" },
  { tibetan: "ོ", encoded: "ëì" },
  { tibetan: "ཱུ", encoded: "Ø" },
  { tibetan: "ཾ", encoded: "î" },
  { tibetan: "ྃ", encoded: "ñ" },
  { tibetan: "ཱ", encoded: "¡¢Ó" },
  { tibetan: "ཻ", encoded: "ê" },
  { tibetan: "ཱུ", encoded: "Ù" },

  { tibetan: "ཀ", encoded: "!´" },
  { tibetan: "ཁ", encoded: '"' },
  { tibetan: "ག", encoded: "#μ" },
  { tibetan: "ང", encoded: "$" },
  { tibetan: "ཅ", encoded: "%" },
  { tibetan: "ཆ", encoded: "&" },
  { tibetan: "ཇ", encoded: "'" },
  { tibetan: "ཉ", encoded: "(¶" },
  { tibetan: "ཏ", encoded: ")·" },
  { tibetan: "ཐ", encoded: "*" },
  { tibetan: "ད", encoded: "+¸" },
  { tibetan: "ན", encoded: ",¹" },
  { tibetan: "པ", encoded: "ý" },
  { tibetan: "ཕ", encoded: "." },
  { tibetan: "བ", encoded: "/" },
  { tibetan: "མ", encoded: "0" },
  { tibetan: "ཙ", encoded: "1" },
  { tibetan: "ཚ", encoded: "2" },
  { tibetan: "ཛ", encoded: "3" },
  { tibetan: "ཝ", encoded: "4" },
  { tibetan: "ཞ", encoded: "5º" },
  { tibetan: "ཟ", encoded: "6" },
  { tibetan: "འ", encoded: "7" },
  { tibetan: "ཡ", encoded: "8" },
  { tibetan: "ར", encoded: "9" },
  { tibetan: "ལ", encoded: ":" },
  { tibetan: "ཤ", encoded: ";»" },
  { tibetan: "ས", encoded: "<" },
  { tibetan: "ཧ", encoded: "=" },
  { tibetan: "ཨ", encoded: ">" },

  { tibetan: "༠", encoded: "¾" }, // Also taken by རྒྷ, careful !
  { tibetan: "༡", encoded: "¿" },
  { tibetan: "༢", encoded: "À" },
  { tibetan: "༣", encoded: "Á" },
  { tibetan: "༤", encoded: "Â" },
  { tibetan: "༥", encoded: "Ã" },
  { tibetan: "༦", encoded: "Ä" },
  { tibetan: "༧", encoded: "Å" },
  { tibetan: "༨", encoded: "Æ" },
  { tibetan: "༩", encoded: "Ç" },

  { tibetan: "ཊ", encoded: "ª" },

  { tibetan: "ཁྱ", encoded: "a" },
  { tibetan: "གྱ", encoded: "b" },
  { tibetan: "པྱ", encoded: "c" },
  { tibetan: "ཕྱ", encoded: "d" },
  { tibetan: "བྱ", encoded: "e" },
  { tibetan: "མྱ", encoded: "f" },
  { tibetan: "ཀྲ", encoded: "g" },
  { tibetan: "ཁྲ", encoded: "h" },
  { tibetan: "གྲ", encoded: "i" },
  { tibetan: "ཏྲ", encoded: "j" },
  { tibetan: "ཐྲ", encoded: "k" },
  { tibetan: "དྲ", encoded: "l" },
  { tibetan: "པྲ", encoded: "m" },
  { tibetan: "ཕྲ", encoded: "n" },
  { tibetan: "བྲ", encoded: "o" },
  { tibetan: "མྲ", encoded: "p" },
  { tibetan: "ཤྲ", encoded: "q" },
  { tibetan: "སྲ", encoded: "r" },
  { tibetan: "ཧྲ", encoded: "s" },
  { tibetan: "ཀླ", encoded: "t" },
  { tibetan: "གླ", encoded: "u" },
  { tibetan: "བླ", encoded: "v" },
  { tibetan: "ཟླ", encoded: "w" },
  { tibetan: "རླ", encoded: "x" },
  { tibetan: "སླ", encoded: "y" },
  { tibetan: "རྐྱ", encoded: "z" },
  { tibetan: "རྔ", encoded: "A" },
  { tibetan: "རྗ", encoded: "B" },
  { tibetan: "རྙ", encoded: "C" },
  { tibetan: "རྟ", encoded: "D" },
  { tibetan: "རྡ", encoded: "E" },
  { tibetan: "རྣ", encoded: "F" },
  { tibetan: "རྦ", encoded: "G" },
  { tibetan: "རྨ", encoded: "H" },
  { tibetan: "རྩ", encoded: "I" },
  { tibetan: "རྫ", encoded: "J" },
  { tibetan: "ལྐ", encoded: "K" },
  { tibetan: "ལྒ", encoded: "L" },
  { tibetan: "ལྔ", encoded: "M" },
  { tibetan: "ལྕ", encoded: "N" },
  { tibetan: "ལྗ", encoded: "O" },
  { tibetan: "ལྟ", encoded: "P" },
  { tibetan: "ལྡ", encoded: "Q" },
  { tibetan: "ལྤ", encoded: "R" },
  { tibetan: "ལྦ", encoded: "S" },
  { tibetan: "ལྷ", encoded: "T" },
  { tibetan: "སྐ", encoded: "U" },
  { tibetan: "སྒ", encoded: "V" },
  { tibetan: "སྔ", encoded: "W" },
  { tibetan: "སྤ", encoded: "\\" },
  { tibetan: "སྙ", encoded: "X" },
  { tibetan: "སྟ", encoded: "Y" },
  { tibetan: "སྡ", encoded: "Z" },
  { tibetan: "སྒྲ", encoded: "…" },
  { tibetan: "སྣ", encoded: "[" },
  { tibetan: "ཀྱ", encoded: "`" },
  { tibetan: "རྒྱ", encoded: "{" },
  { tibetan: "སྤྱ", encoded: "₫" },
  { tibetan: "སྐྱ", encoded: "þ" },
  { tibetan: "སྒྱ", encoded: "€" },
  { tibetan: "སྤྲ", encoded: "‡" },
  { tibetan: "སྦྱ", encoded: "‚" },
  { tibetan: "སྤྱ", encoded: "" },
  { tibetan: "སྨ", encoded: "^" },
  { tibetan: "སྩ", encoded: "_" },
  { tibetan: "ཏྭ", encoded: "₮" },
  { tibetan: "དྭ", encoded: "₯" }, // U+0090 = real font code (₯/U+20AF not in cmap)
  { tibetan: "དྲྭ", encoded: "š" },
  { tibetan: "༼", encoded: "Ð" },
  { tibetan: "༽", encoded: "Ñ" },
];

var wordsMap = [
  { tibetan: "གྱ", encoded: "μb" },
  { tibetan: "ཧཱུྃ", encoded: "oe×ñ" },
  { tibetan: "སིདྡྷི", encoded: "<ÜKÜ" },
  { tibetan: "སིདྡྷི", encoded: "<Ü-KÜ" },
  { tibetan: "པདྨ", encoded: "ýV" },
  { tibetan: "ཏྤལ", encoded: ",:" },
  { tibetan: "ༀ", encoded: ">ù" },
  { tibetan: "ཊྭཱཾ", encoded: "¤Êî" },
  { tibetan: "ཊྭ", encoded: "¤" },
  { tibetan: "ཧཱ", encoded: "¼Ô" },
  { tibetan: "སམྦྷ", encoded: "<0-£" },
  { tibetan: "ཞྭ", encoded: "\u201C" },
  { tibetan: "པཎ", encoded: "ýC" },
  { tibetan: "བྷ་ནྡྷ", encoded: "£v" },
  { tibetan: "ཌཱུརྻ", encoded: "¬Ù<" },
  { tibetan: "ཌཱུརྻ", encoded: "¬Ù4" },
  { tibetan: "བྷྲཱུྃ", encoded: "¨Ôñ" },
  { tibetan: "ཛྙཱ", encoded: "ƒÉ" },
  { tibetan: "དིཔྟ", encoded: "\\+ÜŠ" },
  { tibetan: "ཤཱུ་ནྱ", encoded: "»Õ-‚" },
  { tibetan: "ཏཱ", encoded: "·Ô" },
  { tibetan: "ཨོཾཿ", encoded: ">ùï" },
  { tibetan: "མངྒ་ལཾ", encoded: "0]-:î" },
];

export { charsMap, wordsMap, normalizeLegacy };
export default TibetanUnicodeConverter;
