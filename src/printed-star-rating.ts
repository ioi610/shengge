const digits = '一二三四五';
const adjectives = ['one', 'two', 'three', 'four', 'five'];
const numberValue = (s: string) => digits.includes(s) ? digits.indexOf(s) + 1 : Number(s);

// Require a rating and corresponding establishment in both printed rows. A
// bare 三星 may instead name a brand, a person, or a constellation.
export function printedStarRating(japanese: string, reference?: string) {
  if (!reference) return;
  const source = japanese.normalize('NFKC');
  const other = reference.normalize('NFKC').replace(/\s+/gu, '');
  const jp = [...source.matchAll(/(?<![\d一二三四五六七八九十])([一二三四五1-5ミ])[つツ]星(?:の)?(レストラン|料理店|ホテル|旅館)/gu)];
  const zh = [...other.matchAll(/(?<![\d一二三四五六七八九十])([一二三四五1-5])星(?:级|級)?(餐厅|餐廳|餐馆|餐館|饭店|飯店|酒店|旅馆|旅館)/gu)];
  if (jp.length !== 1 || zh.length !== 1) return;
  const [phrase, spelling, place] = jp[0];
  const [gloss, numeral, establishment] = zh[0];
  const count = spelling === 'ミ' ? 3 : numberValue(spelling);
  if (count !== numberValue(numeral)) return;
  const restaurant = place === 'レストラン' || place === '料理店';
  if (!/^[饭飯]店$/u.test(establishment) && restaurant !== establishment.startsWith('餐')) return;
  const noun = restaurant ? 'restaurant' : place === '旅館' ? 'inn' : 'hotel';
  const word = adjectives[count - 1];
  const jpTail = source.slice(phrase.length);
  const zhTail = other.slice(gloss.length);
  const sourceIsBare = jp[0].index === 0 && /^[?!.。]?$/u.test(jpTail);
  const bare = sourceIsBare && zh[0].index === 0 && /^[吗嗎]?[?!.。]?$/u.test(zhTail);
  if (sourceIsBare && !bare) return;
  const question = jpTail === '?' || /[吗嗎?]/u.test(zhTail);
  const punctuation = question ? '?' : jpTail === '!' ? '!' : '.';
  // Keep the rest of a spoken sentence, including any negation or question,
  // for the normal source translator. Only the local model input changes.
  return {
    fragment: bare ? 'A ' + word + '-star ' + noun + punctuation : undefined,
    input: source.replace(phrase, count + 'つ星の' + place),
    ratingInEnglish: new RegExp('\\b(?:' + count + '|' + word + ')[ -]stars?\\s+' + noun + '\\b', 'iu'),
  };
}
