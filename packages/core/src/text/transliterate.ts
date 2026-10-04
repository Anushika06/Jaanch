/**
 * Approximate Devanagari → Latin transliteration, used only to compare names written in Hindi
 * with names in English-language registers (e.g. "शर्मा" vs "SHARMA"). It is deliberately simple
 * and is never shown to users; fuzzy token matching absorbs the remaining spelling variation.
 */

const CONSONANTS: Record<string, string> = {
  क: 'k',
  ख: 'kh',
  ग: 'g',
  घ: 'gh',
  ङ: 'n',
  च: 'ch',
  छ: 'chh',
  ज: 'j',
  झ: 'jh',
  ञ: 'n',
  ट: 't',
  ठ: 'th',
  ड: 'd',
  ढ: 'dh',
  ण: 'n',
  त: 't',
  थ: 'th',
  द: 'd',
  ध: 'dh',
  न: 'n',
  प: 'p',
  फ: 'ph',
  ब: 'b',
  भ: 'bh',
  म: 'm',
  य: 'y',
  र: 'r',
  ल: 'l',
  ळ: 'l',
  व: 'v',
  श: 'sh',
  ष: 'sh',
  स: 's',
  ह: 'h',
};

const NUKTA_FORMS: Record<string, string> = {
  क: 'q',
  ख: 'kh',
  ग: 'gh',
  ज: 'z',
  ड: 'r',
  ढ: 'rh',
  फ: 'f',
};

const PRECOMPOSED_NUKTA: Record<string, string> = {
  क़: 'q',
  ख़: 'kh',
  ग़: 'gh',
  ज़: 'z',
  ड़: 'r',
  ढ़: 'rh',
  फ़: 'f',
  य़: 'y',
};

const VOWELS: Record<string, string> = {
  अ: 'a',
  आ: 'a',
  इ: 'i',
  ई: 'i',
  उ: 'u',
  ऊ: 'u',
  ऋ: 'ri',
  ए: 'e',
  ऐ: 'ai',
  ओ: 'o',
  औ: 'au',
  ऑ: 'o',
  ऍ: 'e',
};

const MATRAS: Record<string, string> = {
  'ा': 'a',
  'ि': 'i',
  'ी': 'i',
  'ु': 'u',
  'ू': 'u',
  'ृ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
  'ॉ': 'o',
  'ॅ': 'e',
};

const VIRAMA = '्';
const NUKTA = '़';
const NASALS = new Set(['ं', 'ँ']);
const VISARGA = 'ः';

const DEVANAGARI = /[ऀ-ॿ]/;

export function hasDevanagari(input: string): boolean {
  return DEVANAGARI.test(input);
}

export function transliterateDevanagari(input: string): string {
  const chars = [...input.normalize('NFC')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const next = chars[i + 1];

    const pre = PRECOMPOSED_NUKTA[ch];
    const isConsonant = pre !== undefined || CONSONANTS[ch] !== undefined;
    if (isConsonant) {
      let base = pre ?? CONSONANTS[ch]!;
      let j = i + 1;
      if (chars[j] === NUKTA) {
        base = NUKTA_FORMS[ch] ?? base;
        j++;
      }
      const following = chars[j];
      if (following === VIRAMA) {
        out += base;
        i = j;
        continue;
      }
      if (following !== undefined && MATRAS[following] !== undefined) {
        out += base + MATRAS[following];
        i = j;
        continue;
      }
      // Inherent vowel; dropped at the end of a word (schwa deletion, approximate).
      const atWordEnd = following === undefined || !DEVANAGARI.test(following);
      out += atWordEnd ? base : `${base}a`;
      i = j - 1;
      continue;
    }
    if (VOWELS[ch] !== undefined) {
      out += VOWELS[ch];
      continue;
    }
    if (NASALS.has(ch)) {
      out += next !== undefined && /[पफबभम]/.test(next) ? 'm' : 'n';
      continue;
    }
    if (ch === VISARGA) {
      out += 'h';
      continue;
    }
    if (ch === VIRAMA || ch === NUKTA) continue;
    out += ch;
  }
  return out;
}
