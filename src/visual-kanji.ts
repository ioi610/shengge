type Glyph={char:string;p:number};
const kanji=/^\p{Script=Han}$/u;
const japanese=new Intl.Segmenter('ja',{granularity:'word'});

export function hasUncertainCompound(letters:Glyph[]){
  return letters.some((g,i)=>g.p<0.8 && kanji.test(g.char) &&
    (kanji.test(letters[i-1]?.char??'') || kanji.test(letters[i+1]?.char??'')));
}

/** Restore a weak glyph in a compound only when raw color independently
 * resolves it, its neighbour agrees, and the result forms a Japanese word. */
export function corroborateCompound(letters:Glyph[],raw:Glyph[]){
  if(letters.length!==raw.length)return letters;
  const text=letters.map(l=>l.char).join('');
  const before=japanese.segment(text);
  let offset=0;
  for(let i=0;i<letters.length;i++){
    const index=offset, g=letters[i], other=raw[i];
    offset+=g.char.length;
    if(g.p>=0.8 || other.p<0.8 || other.p<g.p+0.15 || g.char===other.char ||
        !kanji.test(g.char) || !kanji.test(other.char) || before.containing(index)?.segment!==g.char)continue;
    const replacement=text.slice(0,index)+other.char+text.slice(index+g.char.length);
    const word=japanese.segment(replacement).containing(index);
    if(!word?.isWordLike || !/^\p{Script=Han}{2,}$/u.test(word.segment))continue;
    const neighbour=i+(word.index<index?-1:1);
    if(!letters[neighbour] || letters[neighbour].char!==raw[neighbour]?.char ||
        letters[neighbour].p<0.8 || raw[neighbour].p<0.8)continue;
    return letters.map((letter,j)=>j===i?other:letter);
  }
  return letters;
}
