// These handwritten kana share a left stroke. Accept a second reading only if
// the raw pixels support it and it rejoins an otherwise isolated kana to a word.
const lookalikes = /^[われね]$/u;
const words = new Intl.Segmenter('ja', {granularity:'word'});
const tokens = (text:string) => Array.from(words.segment(text));
export function hasIsolatedKana(text:string) {
  return text.length >= 4 && tokens(text).some(part => lookalikes.test(part.segment));
}
export function corroborateKana(primary:string, raw:string) {
  if(primary.length !== raw.length || primary === raw) return primary;
  const diff = Array.from(primary, (c,i) => c === raw[i] ? -1 : i).filter(i => i >= 0);
  if(diff.length !== 1) return primary;
  const i = diff[0];
  if(!lookalikes.test(primary[i]) || !lookalikes.test(raw[i])) return primary;
  const before = tokens(primary), after = tokens(raw);
  if(after.length >= before.length || !before.some(p => p.index === i && p.segment.length === 1)) return primary;
  return after.some(p => p.isWordLike && p.index <= i && i < p.index+p.segment.length && p.segment.length >= 2) ? raw : primary;
}

type Glyph={char:string;p:number};
const hiragana=/^\p{Script=Hiragana}$/u;
export function hasUncertainKanaGlyph(letters:Glyph[]){
  return letters.some((g,i)=>g.p<.65 && /^\p{Script=Han}$/u.test(g.char) &&
    hiragana.test(letters[i-1]?.char??'') && hiragana.test(letters[i+1]?.char??''));
}

/** The outline mask can turn a rounded kana into a weak isolated kanji.
 * Only replace that one glyph when native pixels read it strongly, both
 * neighbouring glyphs agree, and it rejoins a Japanese word. */
export function corroborateKanaGlyph(letters:Glyph[],raw:Glyph[]){
  if(letters.length!==raw.length)return letters;
  const differences=letters.flatMap((g,i)=>g.char===raw[i].char?[]:[i]);
  if(differences.length!==1)return letters;
  const i=differences[0],g=letters[i],other=raw[i];
  if(!hasUncertainKanaGlyph(letters) || g.p>=.65 || !/^\p{Script=Han}$/u.test(g.char) ||
    !hiragana.test(other.char) || other.p<.98)return letters;
  if(![-1,1].every(d=>letters[i+d]?.p>=.9 && raw[i+d]?.p>=.9 &&
    hiragana.test(letters[i+d]?.char??'')))return letters;
  const before=letters.map(g=>g.char).join(''),after=raw.map(g=>g.char).join('');
  const offset=letters.slice(0,i).reduce((n,g)=>n+g.char.length,0);
  if(words.segment(before).containing(offset)?.segment!==g.char)return letters;
  const word=words.segment(after).containing(offset);
  if(!word?.isWordLike || word.segment.length<2 || !/^\p{Script=Hiragana}+$/u.test(word.segment))return letters;
  return letters.map((g,j)=>j===i?other:g);
}
