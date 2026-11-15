/* Player-name helpers.
 *
 * GEM hands us the same person under two different spellings: the run page
 * writes "Ironsong, Dorinthea", the coverage CSVs write "Dorinthea Ironsong".
 * On top of that players may add the name they want to be called by:
 * 'Ironsong, Dorinthea "Dori"'. Joining heroes and standings on the raw string
 * therefore misses whenever a gemId is absent.
 *
 * OV.fmtName in public/shared/overlay.js strips the same pattern for display.
 */

/* Nicknames arrive in double quotes (straight, curly or German) or in brackets.
 * Apostrophes are deliberately not delimiters: they belong to O'Brien and
 * D'Angelo, and treating them as quotes would eat half those names. */
const NICK_RE = /\s*["“„«(\[][^"“”„«»()\[\]]*["”“»)\]]\s*/g;

/* Letters NFD cannot take apart, because they are their own character rather
 * than a base plus an accent. Turkish dotless i shows up in German FAB events
 * often enough to matter. */
const FOLD = {
  'ı': 'i', 'İ': 'i',            // ı İ
  'ø': 'o', 'œ': 'oe',           // ø œ
  'æ': 'ae', 'ß': 'ss',          // æ ß
  'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th'
};
const FOLD_RE = new RegExp('[' + Object.keys(FOLD).join('') + ']', 'g');

/* A join key that survives word order, nicknames, punctuation and accents, so
 * 'Ironsong, Dorinthea "Dori"' and "Dorinthea Ironsong" collapse onto one key.
 * Sorting the tokens is what makes the two GEM spellings agree. */
function nameKey(name) {
  return String(name == null ? '' : name)
    .replace(NICK_RE, ' ')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // Müller -> Muller
    .replace(FOLD_RE, c => FOLD[c])                     // Kılıç  -> Kilic
    .replace(/['’ʼ`]/g, '')              // O'Brien stays one word
    .replace(/[^a-z0-9\s]/g, ' ')                       // , . - and quotes split
    .split(/\s+/).filter(Boolean)
    .sort()
    .join(' ');
}

module.exports = { NICK_RE, nameKey };
