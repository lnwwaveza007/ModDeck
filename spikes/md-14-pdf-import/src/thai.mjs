// Thai text repair and quality checks for text extracted from slide PDFs.

const CONSONANT = "\u0E01-\u0E2E";
const TONE = "\u0E48-\u0E4B";
// Marks that must follow a consonant (or another mark), never a space.
const MARK = "\u0E31\u0E34-\u0E3A\u0E47-\u0E4E";
const SARA_AA = "\u0E32";
const SARA_AM = "\u0E33";
const NIKHAHIT = "\u0E4D";

// Legacy "Thai PUA" glyph positions U+F700..U+F71A used by old Windows/macOS
// Thai fonts (shifted tone marks and vowels), mapped back to real code points.
const PUA_TARGETS = [
  0x0e10, 0x0e34, 0x0e35, 0x0e36, 0x0e37, 0x0e48, 0x0e49, 0x0e4a, 0x0e4b, 0x0e4c, 0x0e48, 0x0e49,
  0x0e4a, 0x0e4b, 0x0e4c, 0x0e0d, 0x0e31, 0x0e4d, 0x0e47, 0x0e48, 0x0e49, 0x0e4a, 0x0e4b, 0x0e4c,
  0x0e38, 0x0e39, 0x0e3a,
];
const fromPua = (c) => String.fromCharCode(PUA_TARGETS[c.charCodeAt(0) - 0xf700]);

// "Consonant, space, optional tone mark, SARA AA": a SARA AM whose NIKHAHIT
// glyph was mapped to a space.
const BROKEN_SARA_AM = `([${CONSONANT}]) ([${TONE}]?)${SARA_AA}`;

export function repairThai(text) {
  return (
    text
      .replace(/[\uF700-\uF71A]/g, fromPua)
      // SARA AM written as NIKHAHIT + SARA AA.
      .replaceAll(NIKHAHIT + SARA_AA, SARA_AM)
      // PowerPoint for Windows maps the NIKHAHIT glyph of SARA AM to a space:
      // "น้ำ" comes out as "น ้า". No Thai word starts with SARA AA, so a space
      // between a consonant and (tone mark +) SARA AA is always this bug.
      .replace(new RegExp(BROKEN_SARA_AM, "g"), `$1$2${SARA_AM}`)
  );
}

// pdf.js getTextContent() drops the space glyph that stands in for NIKHAHIT, so
// "นำเสนอ" becomes "นาเสนอ" and repairThai cannot see it. The raw glyph runs
// (from getOperatorList) still have the space. Find the broken spots there and
// return [broken, fixed] pairs with a little Thai context on each side, so the
// pairs can be replaced in the text content.
export function saraAmFixesFromGlyphRuns(runs) {
  const fixes = new Map();
  for (const run of runs) {
    for (const m of run.matchAll(new RegExp(BROKEN_SARA_AM, "g"))) {
      const pre = run.slice(0, m.index).match(/[\u0E01-\u0E5B]{0,3}$/)[0];
      const post = run.slice(m.index + m[0].length).match(/^[\u0E01-\u0E5B]{0,3}/)[0];
      // Too little context could hit a correct word, for example "น้า".
      if (pre.length + post.length < 2) continue;
      const head = pre + m[1] + m[2];
      fixes.set(head + SARA_AA + post, head + SARA_AM + post);
    }
  }
  return [...fixes];
}

export function applyFixes(text, fixes) {
  return fixes.reduce((t, [broken, fixed]) => t.replaceAll(broken, fixed), text);
}

export function checkThai(text) {
  const count = (re) => (text.match(re) || []).length;
  return {
    thaiChars: count(/[\u0E00-\u0E7F]/g),
    saraAm: count(/\u0E33/g),
    // Mark with no consonant before it (broken vowel / tone mark).
    orphanMarks: count(new RegExp(`(^|[^${CONSONANT}${MARK}])[${MARK}]`, "gm")),
    puaChars: count(/[\uE000-\uF8FF]/g),
    replacementChars: count(/\uFFFD/g),
    spaceBeforeSaraAa: count(new RegExp(BROKEN_SARA_AM, "g")),
  };
}
