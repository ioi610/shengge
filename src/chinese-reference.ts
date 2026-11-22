const words=new Intl.Segmenter('zh',{granularity:'word'});

function referenceWords(part:string,source:string,offset:number){
 const tokens=[...words.segment(part)],result:string[]=[];
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i],next=tokens[i+1],character=token.segment;
  const start=offset+token.index,end=start+character.length*2;
  // Merge only TWO complete single-character words that were contiguous in
  // the picture. Never borrow an edge from a multi-character word, or choose
  // an arbitrary pair inside a longer repetition/stutter.
  if(token.isWordLike&&next?.isWordLike&&/^\p{Script=Han}$/u.test(character)&&
     next.segment===character&&next.index===token.index+character.length&&
     source.slice(Math.max(0,start-character.length),start)!==character&&
     source.slice(end,end+character.length)!==character){
   result.push(character+character);i++;continue;
  }
  if(character.trim())result.push(character.trim());
 }
 return result;
}

/** Add word boundaries for the local reference translator, but keep the
 * contiguous positive-negative question 有没有 intact. Splitting it into
 * 有 没有 made the installed pack assert "has no" instead of asking a question.
 * Split the source first: ICU can also attach its first 有 to a preceding 你.
 * Never join across existing whitespace, punctuation or a separate negation. */
export function chineseReferenceInput(text:string){
 // The local pack treats a detached final 哟/喔 as an English interjection
 // and can drop the entire preceding event ("中奖 了 哟" -> "yo"). Keep a
 // single written predicate with its two particles. Questions, separate
 // words and clauses continue through the ordinary word-boundary logic.
 const phrase=/^(\p{Script=Han}{1,4})了[哟喲喔哦啦呀]([。！!]?)$/u.exec(text.trim());
 if(phrase&&[...words.segment(phrase[1])].length===1)return text.trim();
 let offset=0;
 return text.split(/(有[没沒]有)/u).flatMap(part=>{
  const start=offset;offset+=part.length;
  return /^有[没沒]有$/u.test(part)?[part]:referenceWords(part,text,start);
 }).join(' ');
}
