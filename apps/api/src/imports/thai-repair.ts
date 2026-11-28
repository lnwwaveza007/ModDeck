// Thai text repair for text taken from slide PDFs (MD-14 §4.2). PowerPoint for Windows breaks the
// vowel SARA AM; old Thai fonts use private-use glyphs. Without this step, words such as ทำ, นำ and
// จำนวน come out wrong, and the search and AI features of Release 2 would miss them.

const CONSONANT = "ก-ฮ";
const TONE = "่-๋";
// Marks that must follow a consonant (or another mark), never a space.
const MARK = "ัิ-ฺ็-๎";
const SARA_AA = "า";
const SARA_AM = "ำ";
const NIKHAHIT = "ํ";

// Legacy "Thai PUA" glyph positions U+F700..U+F71A of old Windows and macOS Thai fonts (shifted
// tone marks and vowels), mapped back to real code points.
const PUA_TARGETS = [
  0x0e10, 0x0e34, 0x0e35, 0x0e36, 0x0e37, 0x0e48, 0x0e49, 0x0e4a, 0x0e4b, 0x0e4c, 0x0e48, 0x0e49,
  0x0e4a, 0x0e4b, 0x0e4c, 0x0e0d, 0x0e31, 0x0e4d, 0x0e47, 0x0e48, 0x0e49, 0x0e4a, 0x0e4b, 0x0e4c,
  0x0e38, 0x0e39, 0x0e3a,
];
const fromPua = (c: string) => String.fromCharCode(PUA_TARGETS[c.charCodeAt(0) - 0xf700]);

// "Consonant, space, optional tone mark, SARA AA": a SARA AM whose NIKHAHIT glyph was mapped to a
// space.
const BROKEN_SARA_AM = `([${CONSONANT}]) ([${TONE}]?)${SARA_AA}`;

export function repairThai(text: string): string {
  return (
    text
      .replace(/[-]/g, fromPua)
      // SARA AM written as NIKHAHIT + SARA AA.
      .replaceAll(NIKHAHIT + SARA_AA, SARA_AM)
      // No Thai word starts with SARA AA, so a space between a consonant and (tone mark +) SARA AA
      // is always the PowerPoint bug: "น้ำ" comes out as "น ้า".
      .replace(new RegExp(BROKEN_SARA_AM, "g"), `$1$2${SARA_AM}`)
  );
}

/**
 * pdf.js getTextContent() drops the space glyph that stands in for NIKHAHIT, so "นำเสนอ" becomes
 * "นาเสนอ" and repairThai cannot see it. The raw glyph runs still have the space. Finds the broken
 * spots there and returns [broken, fixed] pairs, each with a little Thai context on both sides, so
 * the pairs can be replaced in the text content.
 */
export function saraAmFixesFromGlyphRuns(runs: string[]): [string, string][] {
  const fixes = new Map<string, string>();
  for (const run of runs) {
    for (const m of run.matchAll(new RegExp(BROKEN_SARA_AM, "g"))) {
      const at = m.index ?? 0;
      const pre = /[ก-๛]{0,3}$/.exec(run.slice(0, at))?.[0] ?? "";
      const post = /^[ก-๛]{0,3}/.exec(run.slice(at + m[0].length))?.[0] ?? "";
      // Too little context could hit a correct word, for example "น้า".
      if (pre.length + post.length < 2) continue;
      const head = pre + m[1] + m[2];
      fixes.set(head + SARA_AA + post, head + SARA_AM + post);
    }
  }
  return [...fixes];
}

export function applyFixes(text: string, fixes: [string, string][]): string {
  return fixes.reduce((t, [broken, fixed]) => t.replaceAll(broken, fixed), text);
}

/** Quality counters per page. Logged by the importer, so a new export problem shows early. */
export function checkThai(text: string) {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return {
    thaiChars: count(/[฀-๿]/g),
    saraAm: count(/ำ/g),
    // Mark with no consonant before it (broken vowel or tone mark).
    // The class holds Thai combining marks on purpose.
    // eslint-disable-next-line no-misleading-character-class
    orphanMarks: count(new RegExp(`(^|[^${CONSONANT}${MARK}])[${MARK}]`, "gm")),
    puaChars: count(/[-]/g),
    replacementChars: count(/�/g),
    spaceBeforeSaraAa: count(new RegExp(BROKEN_SARA_AM, "g")),
  };
}

// Control characters other than tab and line end. Some PDFs carry NUL in their text, and Postgres
// refuses a text value with NUL in it.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/**
 * Joins the text items of a page, one line per item with a line end, tidies the spaces and drops
 * control characters.
 */
export function tidyText(text: string): string {
  return text
    .replace(CONTROL_CHARS, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
