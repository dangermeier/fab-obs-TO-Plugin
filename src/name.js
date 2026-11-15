// GEM spells one person two ways: run page "Ironsong, Dorinthea", coverage CSV
// "Dorinthea Ironsong", plus an optional nickname: 'Ironsong, Dorinthea "Dori"'.
// OV.fmtName in public/shared/overlay.js strips the same pattern for display.

// Nickname in double quotes (straight, curly, German) or brackets.
// Apostrophes are not delimiters, they belong to O'Brien and D'Angelo.
const NICK_RE = /\s*["“„«(\[][^"“”„«»()\[\]]*["”“»)\]]\s*/g;

// Letters NFD cannot decompose. Turkish dotless i is common at German events.
const FOLD = {
  'ı': 'i', 'İ': 'i',            // ı İ
  'ø': 'o', 'œ': 'oe',           // ø œ
  'æ': 'ae', 'ß': 'ss',          // æ ß
  'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th'
};
const FOLD_RE = new RegExp('[' + Object.keys(FOLD).join('') + ']', 'g');

// Join key that ignores word order, nicknames, punctuation and accents.
// The token sort is what makes both GEM spellings match.
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
