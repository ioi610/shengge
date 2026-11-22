import {isDialogueText as isWords,type TextSentence} from './sentence-confirmation';
const terminal=/[。！？.!?؟۔।][”’"」』）)\]]*$/u;

/** ASR rows/punctuation are text chunks. The acoustic pause or speaker change
 * closes the utterance; join the chunks spoken before that boundary. */
export function transcriptForUtterance(rows:TextSentence[],endMs:number,speakerChange=false):TextSentence[]{
 const pieces=rows.filter(row=>row.startMs<endMs+80).map(row=>{
  if(!row.words?.length||row.endMs<=endMs+200)return {...row};
  // A decoder row can contain the next speaker after an already confirmed
  // pause. Split at that real word gap, not at punctuation/confidence. A
  // slightly early acoustic end alone must not cut off the last syllable.
  const gap=row.words.findIndex((word,i)=>i>0&&word.startMs>=endMs-200&&word.startMs-row.words![i-1].endMs>=300);
  const words=speakerChange?row.words.filter(word=>word.startMs<endMs):gap>0?row.words.slice(0,gap):row.words;
  if(words.length===row.words.length)return {...row};
  if(!words.length)return undefined;
  return {...row,startMs:words[0].startMs,endMs:words.at(-1)!.endMs,text:words.map(word=>word.text).join('').trim(),words};
 }).filter((row):row is TextSentence=>Boolean(row));
 if(!pieces.length)return [];
 // Keep non-dialogue markers separate so the existing music/effect filter can
 // discard them without letting them poison a real utterance's text.
 const groups:TextSentence[]=[];
 for(const row of pieces){
  const previous=groups.at(-1);
  const sentencePause=previous&&terminal.test(previous.text.trim())&&row.startMs-previous.endMs>=300;
  if(previous&&!sentencePause&&isWords(previous.text)&&isWords(row.text)){
   const weight=Math.max(1,previous.text.length),nextWeight=Math.max(1,row.text.length);
   const separator=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(previous.text)&&/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(row.text)?'':' ';
   previous.text+=separator+row.text;previous.endMs=Math.max(previous.endMs,row.endMs);
   previous.confidence=((previous.confidence??0)*weight+(row.confidence??0)*nextWeight)/(weight+nextWeight);
   if(previous.timing!==row.timing)delete previous.timing;
   if(previous.words&&row.words)previous.words.push(...row.words);else delete previous.words;
  }else groups.push({...row,words:row.words?.map(word=>({...word}))});
 }
 return groups;
}
